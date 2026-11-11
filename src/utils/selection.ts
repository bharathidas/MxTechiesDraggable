/**
 * 2.2 multi-select and lasso logic. Pure, so the rules are unit tested without a DOM.
 */
import { Limits, NO_LIMITS, Position, Rect, clampToLimits } from "./geometry";

/** Normalised rect between two corner points (the rubber band). */
export function rectFromPoints(a: Position, b: Position): Rect {
    const left = Math.min(a.x, b.x);
    const top = Math.min(a.y, b.y);
    return { left, top, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** True when the rects share any area (touching counts, so a thin lasso line still picks an item). */
export function intersects(a: Rect, b: Rect): boolean {
    return (
        a.left <= b.left + b.width &&
        b.left <= a.left + a.width &&
        a.top <= b.top + b.height &&
        b.top <= a.top + a.height
    );
}

/** True when `inner` lies completely inside `outer`. */
export function containsRect(outer: Rect, inner: Rect): boolean {
    return (
        inner.left >= outer.left &&
        inner.top >= outer.top &&
        inner.left + inner.width <= outer.left + outer.width &&
        inner.top + inner.height <= outer.top + outer.height
    );
}

export type LassoMode = "touch" | "contain";

/** Indexes of the items the lasso picks: every item it touches, or only the ones fully inside. */
export function lassoHits(lasso: Rect, items: readonly Rect[], mode: LassoMode = "touch"): number[] {
    const hits: number[] = [];
    // A click without movement is not a lasso.
    if (lasso.width < 2 && lasso.height < 2) {
        return hits;
    }
    items.forEach((rect, index) => {
        if (mode === "contain" ? containsRect(lasso, rect) : intersects(lasso, rect)) {
            hits.push(index);
        }
    });
    return hits;
}

/**
 * The selection after a lasso: replaces the selection, or with Shift/Ctrl toggles the lassoed items on top of the
 * selection that existed when the lasso started (like Figma).
 */
export function lassoSelection(before: readonly string[], lassoed: readonly string[], additive: boolean): string[] {
    if (!additive) {
        return [...lassoed];
    }
    const out = before.filter(id => !lassoed.includes(id));
    lassoed.forEach(id => {
        if (!before.includes(id)) {
            out.push(id);
        }
    });
    return out;
}

export type ClickKind = "replace" | "toggle" | "keep";

/**
 * What a pointer press on an item does to the selection:
 * - Shift, Ctrl or Cmd: toggle the item;
 * - a plain press on an unselected item: select only it;
 * - a plain press on a selected item: keep the group (so it can be dragged together); a click without a drag then
 *   narrows the selection to the item (see `clickSelection`).
 */
export function pressSelection(
    selected: readonly string[],
    id: string,
    additive: boolean
): { next: string[]; kind: ClickKind } {
    if (additive) {
        return {
            next: selected.includes(id) ? selected.filter(other => other !== id) : [...selected, id],
            kind: "toggle"
        };
    }
    if (selected.includes(id)) {
        return { next: [...selected], kind: "keep" };
    }
    return { next: [id], kind: "replace" };
}

/** After a plain click (no drag) on a selected item: only that item stays selected. */
export function clickSelection(selected: readonly string[], id: string): string[] {
    return selected.includes(id) ? [id] : [...selected];
}

/**
 * The translate range that keeps every member of a group inside its own limits when the whole group moves by one
 * delta. `members` are each member's current translate and limits; the result is a range for the delta.
 */
export function groupDeltaLimits(members: ReadonlyArray<{ at: Position; limits: Limits }>): Limits {
    let out: Limits = { ...NO_LIMITS };
    for (const { at, limits } of members) {
        out = {
            minX: Math.max(out.minX, limits.minX - at.x),
            maxX: Math.min(out.maxX, limits.maxX - at.x),
            minY: Math.max(out.minY, limits.minY - at.y),
            maxY: Math.min(out.maxY, limits.maxY - at.y)
        };
    }
    // Members that are already outside their limits must not block the others completely.
    if (out.minX > out.maxX) {
        out.minX = out.maxX = 0;
    }
    if (out.minY > out.maxY) {
        out.minY = out.maxY = 0;
    }
    return out;
}

/** Clamps a group delta to the shared range. */
export function clampGroupDelta(delta: Position, range: Limits): Position {
    return clampToLimits(delta, range);
}

/** Keeps a selection in document order of the given ids, dropping ids that no longer exist. */
export function orderSelection(selection: readonly string[], order: readonly string[]): string[] {
    const set = new Set(selection);
    return order.filter(id => set.has(id));
}
