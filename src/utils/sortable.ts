/**
 * 2.2 sortable list and grid mode: slot layout, target index, keyboard steps. Pure, so every rule is unit tested.
 *
 * Terms: the "frame" of a container is the rects of its items at rest, in DOM order. A logical order lists the
 * items as the user wants them; each item is drawn at the slot of its logical index (by a translate), so the DOM is
 * never reordered by the widget - the Mendix data source does that after On reorder.
 */
import { Position, Rect } from "./geometry";

export type SortAxis = "list" | "horizontal" | "grid";

export interface Size2 {
    w: number;
    h: number;
}

const ROW_TOLERANCE = 2;

/** Moves one entry of an array (returns a new array). */
export function moveIndex<T>(items: readonly T[], from: number, to: number): T[] {
    const out = [...items];
    if (from < 0 || from >= out.length) {
        return out;
    }
    const [moved] = out.splice(from, 1);
    out.splice(Math.max(0, Math.min(to, out.length)), 0, moved);
    return out;
}

/** Number of grid columns: the cells on the first row. */
export function columnsOf(cells: readonly Rect[]): number {
    if (cells.length === 0) {
        return 1;
    }
    const top = cells[0].top;
    let count = 0;
    for (const cell of cells) {
        if (Math.abs(cell.top - top) <= ROW_TOLERANCE) {
            count++;
        } else {
            break;
        }
    }
    return Math.max(1, count);
}

/** Gaps between consecutive cells along the main axis (bottom of one to top of the next). */
function gapsOf(cells: readonly Rect[], horizontal: boolean): number[] {
    const gaps: number[] = [];
    for (let i = 0; i + 1 < cells.length; i++) {
        const a = cells[i];
        const b = cells[i + 1];
        gaps.push(horizontal ? b.left - (a.left + a.width) : b.top - (a.top + a.height));
    }
    return gaps;
}

/**
 * The extra cell after the last one of a grid: next to the last cell on its row, or the start of a new row when the
 * row is full (judged by the container's right edge when known, else by the column count).
 */
export function nextGridCell(cells: readonly Rect[], container?: Rect): Rect | undefined {
    const n = cells.length;
    if (n === 0) {
        return undefined;
    }
    const last = cells[n - 1];
    const columns = columnsOf(cells);
    const stepX = columns > 1 ? cells[1].left - cells[0].left : last.width;
    const rowStep = n > columns ? cells[columns].top - cells[0].top : last.height;
    const sameRowCount = cells.filter(cell => Math.abs(cell.top - last.top) <= ROW_TOLERANCE).length;
    const fitsByEdge = container ? last.left + stepX + last.width <= container.left + container.width + 0.5 : undefined;
    const fits = fitsByEdge ?? sameRowCount < columns;
    if (fits) {
        return { left: last.left + stepX, top: last.top, width: last.width, height: last.height };
    }
    return { left: cells[0].left, top: last.top + rowStep, width: last.width, height: last.height };
}

/**
 * Top-left positions of the items of a logical order.
 * - `cells`: the container's frame (rects at rest, DOM order). Lists keep its first corner and its gaps.
 * - `sizes`: the sizes of the items in the new logical order (one more than the frame when an item is moved in from
 *   another container, one less when one is moved out).
 * - `empty`: where the first item goes in an empty container.
 */
export function slotPositions(
    axis: SortAxis,
    cells: readonly Rect[],
    sizes: readonly Size2[],
    empty: Position = { x: 0, y: 0 },
    container?: Rect
): Position[] {
    if (sizes.length === 0) {
        return [];
    }
    if (axis === "grid") {
        const out: Position[] = [];
        const frame = [...cells];
        for (let i = 0; i < sizes.length; i++) {
            if (i >= frame.length) {
                const next = nextGridCell(frame, container);
                frame.push(next ?? { left: empty.x, top: empty.y, width: sizes[i].w, height: sizes[i].h });
            }
            out.push({ x: frame[i].left, y: frame[i].top });
        }
        return out;
    }
    const horizontal = axis === "horizontal";
    const origin = cells.length > 0 ? { x: cells[0].left, y: cells[0].top } : empty;
    const gaps = gapsOf(cells, horizontal);
    const lastGap = gaps.length > 0 ? gaps[gaps.length - 1] : 0;
    const out: Position[] = [];
    let cursor = horizontal ? origin.x : origin.y;
    for (let i = 0; i < sizes.length; i++) {
        out.push(horizontal ? { x: cursor, y: origin.y } : { x: origin.x, y: cursor });
        cursor += (horizontal ? sizes[i].w : sizes[i].h) + (i < gaps.length ? gaps[i] : lastGap);
    }
    return out;
}

/**
 * Where a dragged item would be inserted among `others` (rects at rest of the other items, in their order):
 * lists count the items whose middle lies before the dragged item's centre; grids take the nearest slot.
 * `slots` (grids only) are the candidate cells, one more than `others`.
 */
export function targetIndex(
    axis: SortAxis,
    centre: Position,
    others: readonly Rect[],
    slots?: readonly Rect[]
): number {
    if (axis === "grid") {
        const candidates = slots ?? others;
        let best = 0;
        let bestDistance = Infinity;
        candidates.forEach((cell, index) => {
            const dx = cell.left + cell.width / 2 - centre.x;
            const dy = cell.top + cell.height / 2 - centre.y;
            const distance = dx * dx + dy * dy;
            if (distance < bestDistance) {
                best = index;
                bestDistance = distance;
            }
        });
        return best;
    }
    const horizontal = axis === "horizontal";
    let index = 0;
    for (const rect of others) {
        const middle = horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
        if (middle < (horizontal ? centre.x : centre.y)) {
            index++;
        }
    }
    return index;
}

/**
 * Keyboard reorder: the new index for a key, or undefined when the key does nothing. Lists use Up/Down (Left/Right
 * too), horizontal lists Left/Right (mirrored in right-to-left pages), grids move by one cell or one row.
 * Home/End go to the first/last position.
 */
export function keyboardSortIndex(
    axis: SortAxis,
    key: string,
    index: number,
    count: number,
    columns = 1,
    rtl = false
): number | undefined {
    if (count <= 0) {
        return undefined;
    }
    const last = count - 1;
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const backward = rtl ? "ArrowRight" : "ArrowLeft";
    let next: number | undefined;
    switch (key) {
        case "Home":
            next = 0;
            break;
        case "End":
            next = last;
            break;
        case "ArrowUp":
            next = axis === "grid" ? index - Math.max(1, columns) : axis === "list" ? index - 1 : undefined;
            break;
        case "ArrowDown":
            next = axis === "grid" ? index + Math.max(1, columns) : axis === "list" ? index + 1 : undefined;
            break;
        default:
            if (key === forward) {
                next = index + 1;
            } else if (key === backward) {
                next = index - 1;
            }
    }
    if (next === undefined) {
        return undefined;
    }
    return Math.max(0, Math.min(last, next));
}

/** True when two id lists are equal. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Changed indexes after a reorder: [id, newIndex] for every id whose index differs from `before`. */
export function changedIndexes(before: readonly string[], after: readonly string[]): Array<[string, number]> {
    const out: Array<[string, number]> = [];
    after.forEach((id, index) => {
        if (before.indexOf(id) !== index) {
            out.push([id, index]);
        }
    });
    return out;
}
