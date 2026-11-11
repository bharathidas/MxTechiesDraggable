/**
 * 2.2 sortable controller: measures the containers, works out the displaced positions while an item is dragged or
 * moved with the keyboard, and holds the new order on screen until the Mendix data source shows it (the widget
 * never reorders the DOM itself). When On reorder does not lead to the new order within the timeout, the order is
 * rolled back on screen and in the order attributes, and the dragged item shows a retry message.
 */
import { Position, Rect } from "./geometry";
import { Handle, getHandle, handlesIn } from "./registry";
import { Size2, SortAxis, columnsOf, moveIndex, sameOrder, slotPositions, targetIndex } from "./sortable";
import { contentBox, toRect } from "./dom";

/** Containers Mendix renders lists in; used when no sort container selector is set. */
export const DEFAULT_SORT_CONTAINER = ".mx-listview, .mx-templategrid, .widget-gallery, [data-sort-container]";

export function containerOf(node: HTMLElement, selector: string): HTMLElement | null {
    const sel = selector.trim() || DEFAULT_SORT_CONTAINER;
    try {
        const parent = node.parentElement?.closest<HTMLElement>(sel);
        if (parent) {
            return parent;
        }
    } catch {
        // Invalid selector typed in Studio Pro: fall back to the parent element.
    }
    return selector.trim() ? null : node.parentElement;
}

/** Containers an item can be moved to: its own, plus every container matching the selector when cross moves are on. */
export function candidateContainers(node: HTMLElement, selector: string, cross: boolean): HTMLElement[] {
    const own = containerOf(node, selector);
    const out = own ? [own] : [];
    if (cross && selector.trim()) {
        try {
            node.ownerDocument.querySelectorAll<HTMLElement>(selector).forEach(el => {
                if (!out.includes(el) && !el.contains(node.parentElement) && !node.contains(el)) {
                    out.push(el);
                }
            });
        } catch {
            // Invalid selector: own container only.
        }
    }
    return out;
}

/** Sortable members of a container (items of nested containers excluded), in DOM order. */
export function membersOf(container: HTMLElement, selector: string): Handle[] {
    return handlesIn(container, h => {
        const node = h.node();
        return h.sortAxis() !== undefined && !!node && containerOf(node, selector) === container;
    });
}

interface Frame {
    container: HTMLElement;
    /** Logical order before this interaction. */
    order: string[];
    /** Rest rects in DOM order. */
    cells: Rect[];
    box: Rect;
}

interface Held {
    order: string[];
    previous: string[];
    domAtCommit: string[];
    expectedKeys: string[];
    previousKeys: string[];
    observer?: MutationObserver;
    timer?: number;
    selector: string;
    axis: SortAxis;
    onFailed?: () => void;
}

const held = new Map<HTMLElement, Held>();

/** Logical order of a container: the held order (filtered to live items) or the DOM order. */
export function logicalOrder(container: HTMLElement, selector: string): string[] {
    const dom = membersOf(container, selector).map(h => h.id);
    const hold = held.get(container);
    if (!hold) {
        return dom;
    }
    const live = hold.order.filter(id => dom.includes(id));
    const missing = dom.filter(id => !live.includes(id));
    return [...live, ...missing];
}

export function isHeld(container: HTMLElement): boolean {
    return held.has(container);
}

function rectOf(id: string, rests: Map<string, Rect>): Rect {
    return rests.get(id) ?? getHandle(id)?.restRect() ?? { left: 0, top: 0, width: 0, height: 0 };
}

export interface SortTarget {
    container: HTMLElement;
    index: number;
}

export interface SortResult {
    changed: boolean;
    fromContainer: HTMLElement;
    toContainer: HTMLElement;
    fromIndex: number;
    toIndex: number;
    orders: Map<HTMLElement, { before: string[]; after: string[] }>;
}

/** One drag (pointer or keyboard) of one item. */
export class SortSession {
    readonly fromContainer: HTMLElement;
    readonly fromIndex: number;
    target: SortTarget;
    private readonly frames = new Map<HTMLElement, Frame>();
    private readonly rests = new Map<string, Rect>();
    private readonly size: Size2;
    private readonly draggedRest: Rect;

    constructor(
        private readonly dragged: Handle,
        public readonly axis: SortAxis,
        containers: HTMLElement[],
        selector: string
    ) {
        this.fromContainer = containers[0];
        containers.forEach(container => {
            const handles = membersOf(container, selector);
            handles.forEach(h => this.rests.set(h.id, h.restRect()));
            this.frames.set(container, {
                container,
                order: logicalOrder(container, selector),
                cells: handles.map(h => this.rests.get(h.id) as Rect),
                box: contentBox(container)
            });
        });
        this.draggedRest = rectOf(dragged.id, this.rests);
        this.size = { w: this.draggedRest.width, h: this.draggedRest.height };
        const own = this.frames.get(this.fromContainer);
        this.fromIndex = Math.max(0, own ? own.order.indexOf(dragged.id) : 0);
        this.target = { container: this.fromContainer, index: this.fromIndex };
    }

    get containers(): HTMLElement[] {
        return [...this.frames.keys()];
    }

    /** Number of positions in a container for the dragged item. */
    countIn(container: HTMLElement): number {
        const frame = this.frames.get(container);
        if (!frame) {
            return 0;
        }
        const others = frame.order.filter(id => id !== this.dragged.id).length;
        return others + 1;
    }

    /** Grid columns of a container (1 for lists). */
    columnsIn(container: HTMLElement): number {
        const frame = this.frames.get(container);
        return frame && this.axis === "grid" ? columnsOf(frame.cells) : 1;
    }

    /** Rest rects of the items of a container in the given order, at their slot positions. */
    private slotRects(frame: Frame, order: string[]): Rect[] {
        const sizes = order.map(id => (id === this.dragged.id ? this.size : sizeOf(rectOf(id, this.rests))));
        const positions = slotPositions(
            this.axis,
            frame.cells,
            sizes,
            { x: frame.box.left, y: frame.box.top },
            frame.box
        );
        return positions.map((p, i) => ({ left: p.x, top: p.y, width: sizes[i].w, height: sizes[i].h }));
    }

    /** The container under a point (cross-container moves), or undefined. */
    containerAt(point: Position): HTMLElement | undefined {
        let best: HTMLElement | undefined;
        let bestArea = Infinity;
        this.frames.forEach((_frame, container) => {
            const r = toRect(container.getBoundingClientRect());
            const inside =
                point.x >= r.left && point.x <= r.left + r.width && point.y >= r.top && point.y <= r.top + r.height;
            if (inside && r.width * r.height < bestArea) {
                best = container;
                bestArea = r.width * r.height;
            }
        });
        return best;
    }

    /** Pointer drag: the target for the dragged item's centre (and the pointer for picking a container). */
    targetFor(centre: Position, pointer?: Position): SortTarget {
        const container = (pointer && this.containerAt(pointer)) || this.target.container;
        const frame = this.frames.get(container) as Frame;
        const others = frame.order.filter(id => id !== this.dragged.id);
        const otherRects = this.slotRects(frame, frame.order).filter((_, i) => frame.order[i] !== this.dragged.id);
        let index: number;
        if (this.axis === "grid") {
            const slots = this.slotRects(frame, [...others, this.dragged.id]);
            index = targetIndex("grid", centre, otherRects, slots);
        } else {
            index = targetIndex(this.axis, centre, otherRects);
        }
        return { container, index: Math.max(0, Math.min(index, others.length)) };
    }

    /** New logical orders for a target. */
    ordersFor(target: SortTarget): Map<HTMLElement, { before: string[]; after: string[] }> {
        const out = new Map<HTMLElement, { before: string[]; after: string[] }>();
        this.frames.forEach((frame, container) => {
            const without = frame.order.filter(id => id !== this.dragged.id);
            let after = frame.order;
            if (container === target.container) {
                after = [...without];
                after.splice(target.index, 0, this.dragged.id);
            } else if (container === this.fromContainer) {
                after = without;
            }
            if (container === this.fromContainer && container === target.container) {
                after = moveIndex(frame.order, frame.order.indexOf(this.dragged.id), target.index);
            }
            out.set(container, { before: frame.order, after });
        });
        return out;
    }

    /** Draws every displaced item at its slot; returns the dragged item's landing rect (the placeholder). */
    show(target: SortTarget, animate: boolean): Rect {
        this.target = target;
        let landing = this.draggedRest;
        this.ordersFor(target).forEach(({ after }, container) => {
            const frame = this.frames.get(container) as Frame;
            const rects = this.slotRects(frame, after);
            after.forEach((id, i) => {
                const rect = rects[i];
                if (id === this.dragged.id) {
                    landing = rect;
                    return;
                }
                const rest = rectOf(id, this.rests);
                getHandle(id)?.setSortOffset({ x: rect.left - rest.left, y: rect.top - rest.top }, animate);
            });
        });
        return landing;
    }

    /** Offset of the dragged item at the current target, relative to its rest position. */
    landingOffset(landing: Rect): Position {
        return { x: landing.left - this.draggedRest.left, y: landing.top - this.draggedRest.top };
    }

    /** Puts every item back where it was before this interaction. */
    cancel(animate: boolean): Position {
        this.frames.forEach(frame => {
            const rects = this.slotRects(frame, frame.order);
            frame.order.forEach((id, i) => {
                if (id !== this.dragged.id) {
                    const rest = rectOf(id, this.rests);
                    getHandle(id)?.setSortOffset({ x: rects[i].left - rest.left, y: rects[i].top - rest.top }, animate);
                }
            });
        });
        const own = this.frames.get(this.fromContainer) as Frame;
        const rect = this.slotRects(own, own.order)[this.fromIndex] ?? this.draggedRest;
        return { x: rect.left - this.draggedRest.left, y: rect.top - this.draggedRest.top };
    }

    result(): SortResult {
        const orders = this.ordersFor(this.target);
        const changed = this.target.container !== this.fromContainer || this.target.index !== this.fromIndex;
        return {
            changed,
            fromContainer: this.fromContainer,
            toContainer: this.target.container,
            fromIndex: this.fromIndex,
            toIndex: this.target.index,
            orders
        };
    }
}

function sizeOf(rect: Rect): Size2 {
    return { w: rect.width, h: rect.height };
}

/** Writes the order attribute of every item whose index changed; returns false when one could not be written. */
export function writeOrders(
    orders: Map<HTMLElement, { before: string[]; after: string[] }>,
    useAfter: boolean
): boolean {
    let ok = true;
    orders.forEach(({ before, after }) => {
        const now = useAfter ? after : before;
        const was = useAfter ? before : after;
        now.forEach((id, index) => {
            if (was.indexOf(id) !== index || !was.includes(id)) {
                const handle = getHandle(id);
                if (handle && !handle.writeOrder(index)) {
                    ok = false;
                }
            }
        });
    });
    return ok;
}

function domIds(container: HTMLElement, selector: string): string[] {
    return membersOf(container, selector).map(h => h.id);
}

function keysOf(ids: readonly string[]): string[] {
    return ids.map(id => getHandle(id)?.itemKey() ?? "");
}

function release(container: HTMLElement): void {
    const hold = held.get(container);
    held.delete(container);
    if (!hold) {
        return;
    }
    hold.observer?.disconnect();
    window.clearTimeout(hold.timer);
    const handles = membersOf(container, hold.selector);
    handles.forEach(h => h.release(h.node()?.getBoundingClientRect()));
    // Keys are known (for example the object id) and the data came back in the old order: the save failed.
    const keys = handles.map(h => h.itemKey());
    const unique = keys.every(k => k) && new Set(keys).size === keys.length;
    if (
        unique &&
        hold.onFailed &&
        sameOrder(keys, hold.previousKeys) &&
        !sameOrder(hold.previousKeys, hold.expectedKeys) &&
        hold.previousKeys.length === hold.expectedKeys.length
    ) {
        hold.onFailed();
    }
}

/** Shows `order` (logical) for a container: every item drawn at its slot. */
function showOrder(container: HTMLElement, order: string[], axis: SortAxis, selector: string, animate: boolean): void {
    const handles = membersOf(container, selector);
    const rests = new Map(handles.map(h => [h.id, h.restRect()]));
    const cells = handles.map(h => rests.get(h.id) as Rect);
    const live = order.filter(id => rests.has(id));
    const sizes = live.map(id => sizeOf(rests.get(id) as Rect));
    const box = contentBox(container);
    const positions = slotPositions(axis, cells, sizes, { x: box.left, y: box.top }, box);
    live.forEach((id, i) => {
        const rest = rests.get(id) as Rect;
        getHandle(id)?.setSortOffset({ x: positions[i].x - rest.left, y: positions[i].y - rest.top }, animate);
    });
}

export interface HoldOptions {
    selector: string;
    axis: SortAxis;
    /** Wait this long for the data source to show the new order (0: hold until it does, no rollback). */
    timeout: number;
    animate: () => boolean;
    /** True while the reorder action still runs; the rollback waits for it. */
    busy: () => boolean;
    /** Called after a rollback or when the data came back in the old order. */
    onFailed: () => void;
}

/** Longest the rollback waits for a running action. */
const MAX_WAIT_MS = 60000;

/**
 * Keeps the new order on screen until the data source re-renders the containers. With a timeout, a container whose
 * DOM did not change in time is rolled back (screen and order attributes) and `onFailed` runs.
 */
export function hold(result: SortResult, options: HoldOptions): void {
    const started = Date.now();
    result.orders.forEach(({ before, after }, container) => {
        if (sameOrder(before, after)) {
            return;
        }
        const previousHold = held.get(container);
        previousHold?.observer?.disconnect();
        window.clearTimeout(previousHold?.timer);
        const entry: Held = {
            order: after,
            previous: before,
            domAtCommit: domIds(container, options.selector),
            expectedKeys: keysOf(after),
            previousKeys: keysOf(before),
            selector: options.selector,
            axis: options.axis,
            onFailed: options.onFailed
        };
        held.set(container, entry);
        if (typeof MutationObserver !== "undefined") {
            entry.observer = new MutationObserver(() => {
                const current = held.get(container);
                if (current === entry && !sameOrder(domIds(container, options.selector), entry.domAtCommit)) {
                    release(container);
                }
            });
            entry.observer.observe(container, { childList: true, subtree: true });
        }
        if (options.timeout > 0) {
            const check = (): void => {
                if (held.get(container) !== entry) {
                    return;
                }
                if (options.busy() && Date.now() - started < MAX_WAIT_MS) {
                    entry.timer = window.setTimeout(check, 500);
                    return;
                }
                rollback(container, options.animate(), true);
            };
            entry.timer = window.setTimeout(check, options.timeout);
        }
    });
}

/** Rolls a held container back to its previous order (screen and order attributes). */
export function rollback(container: HTMLElement, animate: boolean, notify: boolean): void {
    const hold = held.get(container);
    if (!hold) {
        return;
    }
    held.delete(container);
    hold.observer?.disconnect();
    window.clearTimeout(hold.timer);
    const live = domIds(container, hold.selector);
    const previous = hold.previous.filter(id => live.includes(id));
    // The DOM order is the truth; drawing it means every offset goes back to 0.
    showOrder(container, live, hold.axis, hold.selector, animate);
    writeOrders(new Map([[container, { before: previous, after: hold.order.filter(id => live.includes(id)) }]]), false);
    if (notify) {
        hold.onFailed?.();
    }
}

/** Test and unmount helper: forget every held order. */
export function resetHeld(): void {
    held.forEach(hold => {
        hold.observer?.disconnect();
        window.clearTimeout(hold.timer);
    });
    held.clear();
}

export function heldCount(): number {
    return held.size;
}

/** Forgets held orders of containers that left the page (navigation), so nothing keeps them alive. */
export function pruneHeld(): void {
    held.forEach((hold, container) => {
        if (!container.isConnected) {
            hold.observer?.disconnect();
            window.clearTimeout(hold.timer);
            held.delete(container);
        }
    });
}
