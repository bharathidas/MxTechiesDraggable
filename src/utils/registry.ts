/**
 * 2.2 page-wide registry of the mounted draggables. Every widget instance on a page shares this module, so groups
 * (multi-select, lasso, group moves, z-order, shared undo history and layout snapshots) work across instances
 * without any global state outside the widget bundle. Instances unregister on unmount, so the registry never
 * keeps nodes alive (checked by the harness memory test).
 */
import { Limits, Position, Rect } from "./geometry";
import { ItemState } from "./snapshots";
import { SortAxis } from "./sortable";

export interface FollowStart {
    at: Position;
    limits: Limits;
}

export interface Handle {
    readonly id: string;
    node(): HTMLElement | null;
    /** Group name, or undefined when the instance takes part in no group feature. */
    group(): string | undefined;
    selectable(): boolean;
    zOrder(): boolean;
    snapshots(): boolean;
    sortAxis(): SortAxis | undefined;
    itemKey(): string;
    state(): ItemState;
    /** Applies a state (from undo, a snapshot or a reset) and commits it like a user move. */
    apply(state: Partial<ItemState>, animate: boolean): void;
    setSelected(on: boolean): void;
    /** Group drag: the follower's current translate and limits. */
    followStart(): FollowStart;
    /** Group drag: preview offset (null clears it). */
    follow(delta: Position | null): void;
    /** Group drag end: commit the move by `delta` (undefined cancels). */
    followEnd(delta: Position | undefined, zone?: HTMLElement): void;
    /** Sortable: draw the item at an offset from its rest position. */
    setSortOffset(offset: Position, animate: boolean): void;
    /** Sortable: back to the rest position after the DOM was reordered, animated from `from` (FLIP). */
    release(from: Rect | undefined): void;
    /** Sortable: rest rect (layout position without the sort offset). */
    restRect(): Rect;
    /** Sortable: writes the order attribute; returns false when it is not writable. */
    writeOrder(order: number): boolean;
    /** True while one of the instance's actions is running. */
    busy(): boolean;
    /** True when this instance has a snapshot attribute (the group's snapshot store). */
    hasStore(): boolean;
    readStore(): string | undefined;
    writeStore(json: string): boolean;
    /** The state Reset goes back to (Default X / Y or the reset snapshot). */
    defaultState(): Partial<ItemState>;
    /** Screen reader announcement on this instance. */
    announce(text: string): void;
    /** Shows a notice (failure + optional retry) on this instance. */
    notify(message: string, retry?: () => void): void;
    /** Texts this instance uses for group-level announcements. */
    selectedCountText(count: number): string;
}

export interface HistoryChange {
    id: string;
    before: Partial<ItemState>;
}

export interface HistoryEntry {
    changes: HistoryChange[];
}

const handles = new Map<string, Handle>();
const selections = new Map<string, Set<string>>();
const histories = new Map<string, HistoryEntry[]>();
let counter = 0;

export function nextInstanceId(): string {
    counter += 1;
    return `mxt-d-${counter}`;
}

export function register(handle: Handle): () => void {
    handles.set(handle.id, handle);
    return () => {
        handles.delete(handle.id);
        selections.forEach(set => set.delete(handle.id));
        histories.delete(handle.id);
    };
}

export function getHandle(id: string): Handle | undefined {
    return handles.get(id);
}

/** Number of registered instances (tests and the harness memory check). */
export function registrySize(): number {
    return handles.size;
}

function byDocumentOrder(a: Handle, b: Handle): number {
    const na = a.node();
    const nb = b.node();
    if (!na || !nb || na === nb) {
        return 0;
    }
    // eslint-disable-next-line no-bitwise
    return na.compareDocumentPosition(nb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

/** Members of a group in document order, optionally filtered. */
export function members(group: string, filter: (handle: Handle) => boolean = () => true): Handle[] {
    return [...handles.values()].filter(h => h.group() === group && h.node() && filter(h)).sort(byDocumentOrder);
}

/** Registered instances whose node is inside `container`, in document order. */
export function handlesIn(container: Element, filter: (handle: Handle) => boolean = () => true): Handle[] {
    return [...handles.values()]
        .filter(h => {
            const node = h.node();
            return !!node && container.contains(node) && filter(h);
        })
        .sort(byDocumentOrder);
}

// ---- Selection -------------------------------------------------------------------------------------------

export function selectionOf(group: string): string[] {
    const set = selections.get(group);
    if (!set) {
        return [];
    }
    // Drop ids of unmounted instances and keep document order.
    return members(group)
        .map(h => h.id)
        .filter(id => set.has(id));
}

export function isSelected(group: string, id: string): boolean {
    return selections.get(group)?.has(id) === true;
}

/** Replaces a group's selection and tells every member whose state changed. Returns true when anything changed. */
export function setSelection(group: string, ids: readonly string[]): boolean {
    const before = selections.get(group) ?? new Set<string>();
    const after = new Set(ids);
    // Stored first, so members that read the selection while being told about it see the new one.
    selections.set(group, after);
    let changed = false;
    members(group).forEach(handle => {
        const was = before.has(handle.id);
        const is = after.has(handle.id);
        if (was !== is) {
            changed = true;
            handle.setSelected(is);
        }
    });
    return changed;
}

// ---- Undo history ----------------------------------------------------------------------------------------

export function pushHistoryEntry(scope: string, entry: HistoryEntry, cap = 20): void {
    if (entry.changes.length === 0) {
        return;
    }
    const list = histories.get(scope) ?? [];
    list.push(entry);
    while (list.length > cap) {
        list.shift();
    }
    histories.set(scope, list);
}

export function popHistoryEntry(scope: string): HistoryEntry | undefined {
    const list = histories.get(scope);
    const entry = list?.pop();
    return entry;
}

export function historyLength(scope: string): number {
    return histories.get(scope)?.length ?? 0;
}

export function clearHistory(scope: string): void {
    histories.delete(scope);
}

/** Applies an undo entry; returns the handles that were changed. */
export function applyHistoryEntry(entry: HistoryEntry, animate: boolean): Handle[] {
    const changed: Handle[] = [];
    entry.changes.forEach(change => {
        const handle = handles.get(change.id);
        if (handle) {
            handle.apply(change.before, animate);
            changed.push(handle);
        }
    });
    return changed;
}
