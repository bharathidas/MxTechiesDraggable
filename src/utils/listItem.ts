/**
 * Free dragging inside a list view, template grid or gallery (2.0): every item is its own row in the
 * page flow, so a moved item is painted under the rows that follow it and can be clipped by the
 * row's overflow. While an item is dragged, or rests away from its slot, its row is lifted above the
 * other rows: the row gets position: relative and a z-index (a row with a hover transform is its own stacking
 * context, so the draggable's z-index alone is not enough), the draggable gets a z-index as well, and the row stops
 * clipping it. This is safe mid-drag only because the widget pins react-draggable's offsetParent to the page body.
 * Inline styles that were there before are put back exactly.
 */

/** The rows of the Mendix list widgets (and anything marked with data-mxt-list-item). */
export const LIST_ITEM_SELECTOR =
    ".mx-listview-item, .mx-listview > ul > li, .mx-templategrid-item, .widget-gallery-item, [data-mxt-list-item]";

/** Class on a lifted row; the widget CSS keeps it visible and above its neighbours. */
export const LIST_ITEM_RAISED = "mxt-list-item--raised";
export const LIST_ITEM_DRAGGING = "mxt-list-item--dragging";

/** z-index of a draggable in a list that rests away from its slot, and of one being dragged. */
export const RESTING_Z = 2;
export const DRAGGING_Z = 1000;

export type ListLift = "none" | "resting" | "dragging";

interface Saved {
    position: string;
    zIndex: string;
    overflow: string;
}

const saved = new WeakMap<HTMLElement, Saved>();
const owners = new WeakMap<HTMLElement, Map<string, ListLift>>();

/** The list row that holds the node, or null when the widget is not inside a list. */
export function listItemOf(node: Element | null): HTMLElement | null {
    const row = node?.parentElement?.closest(LIST_ITEM_SELECTOR);
    return row instanceof HTMLElement ? row : null;
}

function strongest(lifts: Iterable<ListLift>): ListLift {
    let result: ListLift = "none";
    for (const lift of lifts) {
        if (lift === "dragging") {
            return "dragging";
        }
        if (lift === "resting") {
            result = "resting";
        }
    }
    return result;
}

function apply(row: HTMLElement, lift: ListLift): void {
    if (lift === "none") {
        const before = saved.get(row);
        if (before) {
            row.style.position = before.position;
            row.style.zIndex = before.zIndex;
            row.style.overflow = before.overflow;
            saved.delete(row);
        }
        row.classList.remove(LIST_ITEM_RAISED, LIST_ITEM_DRAGGING);
        return;
    }
    if (!saved.has(row)) {
        saved.set(row, { position: row.style.position, zIndex: row.style.zIndex, overflow: row.style.overflow });
    }
    const view = row.ownerDocument.defaultView;
    const position = view ? view.getComputedStyle(row).position : "";
    if (!position || position === "static") {
        row.style.position = "relative";
    }
    row.style.zIndex = String(lift === "dragging" ? DRAGGING_Z : RESTING_Z);
    row.style.overflow = "visible";
    row.classList.add(LIST_ITEM_RAISED);
    row.classList.toggle(LIST_ITEM_DRAGGING, lift === "dragging");
}

/**
 * Sets how far one widget instance (owner) wants its row lifted. A row can hold several draggables;
 * it keeps the strongest request of all of them.
 */
export function liftListItem(row: HTMLElement | null, owner: string, lift: ListLift): void {
    if (!row) {
        return;
    }
    let requests = owners.get(row);
    if (!requests) {
        if (lift === "none") {
            return;
        }
        requests = new Map();
        owners.set(row, requests);
    }
    if (lift === "none") {
        requests.delete(owner);
    } else {
        requests.set(owner, lift);
    }
    apply(row, strongest(requests.values()));
    if (requests.size === 0) {
        owners.delete(row);
    }
}

/** The z-index the draggable gets for a lift, combined with its own z-order value. */
export function liftZIndex(lift: ListLift, own: number | undefined): number | undefined {
    if (lift === "dragging") {
        return Math.max(DRAGGING_Z, own ?? 0);
    }
    if (lift === "resting") {
        return Math.max(RESTING_Z, own ?? 0);
    }
    return own;
}
