/**
 * 2.2 rubber-band (lasso) selection on a container. One controller per container element, shared by every
 * draggable of the group inside it (reference counted, so the listener goes away with the last draggable).
 * Mouse and pen only: a finger on the background keeps scrolling the page.
 */
import { Position } from "./geometry";
import { members, selectionOf, setSelection } from "./registry";
import { lassoHits, lassoSelection, rectFromPoints } from "./selection";
import { toRect } from "./dom";

interface Controller {
    refs: number;
    group: string;
    dispose: () => void;
}

const controllers = new Map<HTMLElement, Controller>();

/** Elements a press on must never start a lasso. */
const INTERACTIVE =
    "input, textarea, select, button, a[href], [contenteditable=''], [contenteditable='true'], .mxt-draggable, .mxt-menu";

/** Announces the new selection size through the first mounted member (resolved at call time). */
function announceCount(group: string, count: number): void {
    const first = members(group)[0];
    first?.announce(first.selectedCountText(count));
}

function start(container: HTMLElement, group: string): () => void {
    const doc = container.ownerDocument;
    let origin: Position | undefined;
    let band: HTMLDivElement | undefined;
    let before: string[] = [];
    let additive = false;
    let pointerId = -1;

    const finish = (): void => {
        doc.removeEventListener("pointermove", onMove, true);
        doc.removeEventListener("pointerup", onUp, true);
        doc.removeEventListener("pointercancel", onUp, true);
        band?.remove();
        band = undefined;
        origin = undefined;
    };

    const onMove = (event: PointerEvent): void => {
        if (!origin || event.pointerId !== pointerId) {
            return;
        }
        const rect = rectFromPoints(origin, { x: event.clientX, y: event.clientY });
        if (!band && rect.width < 3 && rect.height < 3) {
            return;
        }
        event.preventDefault();
        if (!band) {
            band = doc.createElement("div");
            band.className = "mxt-lasso";
            band.setAttribute("aria-hidden", "true");
            doc.body.appendChild(band);
        }
        band.style.left = `${rect.left}px`;
        band.style.top = `${rect.top}px`;
        band.style.width = `${rect.width}px`;
        band.style.height = `${rect.height}px`;
        const inside = members(group, h => h.selectable() && container.contains(h.node()));
        const hits = lassoHits(
            rect,
            inside.map(h => toRect((h.node() as HTMLElement).getBoundingClientRect()))
        ).map(i => inside[i].id);
        setSelection(group, lassoSelection(before, hits, additive));
    };

    const onUp = (event: PointerEvent): void => {
        if (event.pointerId !== pointerId) {
            return;
        }
        const dragged = !!band;
        finish();
        if (!dragged && !additive) {
            // A plain click on the background clears the selection.
            if (selectionOf(group).length > 0) {
                setSelection(group, []);
                announceCount(group, 0);
            }
            return;
        }
        if (dragged) {
            announceCount(group, selectionOf(group).length);
        }
    };

    const onDown = (event: PointerEvent): void => {
        if (event.button !== 0 || event.pointerType === "touch" || origin) {
            return;
        }
        const target = event.target as Element | null;
        if (target && target !== container && target.closest?.(INTERACTIVE)) {
            return;
        }
        origin = { x: event.clientX, y: event.clientY };
        pointerId = event.pointerId;
        additive = event.shiftKey || event.ctrlKey || event.metaKey;
        before = selectionOf(group);
        doc.addEventListener("pointermove", onMove, true);
        doc.addEventListener("pointerup", onUp, true);
        doc.addEventListener("pointercancel", onUp, true);
    };

    container.addEventListener("pointerdown", onDown);
    container.classList.add("mxt-lasso-area");
    return () => {
        finish();
        container.removeEventListener("pointerdown", onDown);
        container.classList.remove("mxt-lasso-area");
    };
}

/** Attaches the lasso to a container for a group; returns the detach function. */
export function attachLasso(container: HTMLElement, group: string): () => void {
    let controller = controllers.get(container);
    if (!controller) {
        controller = { refs: 0, group, dispose: start(container, group) };
        controllers.set(container, controller);
    }
    controller.refs += 1;
    const own = controller;
    return () => {
        own.refs -= 1;
        if (own.refs <= 0) {
            own.dispose();
            controllers.delete(container);
        }
    };
}

export function lassoControllerCount(): number {
    return controllers.size;
}
