import { Rect } from "./geometry";

/** A guide line in viewport coordinates. Vertical guides have a fixed x, horizontal ones a fixed y. */
export interface Guide {
    orientation: "vertical" | "horizontal";
    /** x for vertical guides, y for horizontal ones. */
    at: number;
    /** Start and end along the line, so the guide spans exactly the aligned boxes. */
    from: number;
    to: number;
}

export interface SnapResult {
    dx: number;
    dy: number;
    guides: Guide[];
}

export interface SnapOptions {
    threshold: number;
    snapX: boolean;
    snapY: boolean;
}

const EPSILON = 0.5;

/** Left edge, centre and right edge of a rect. */
function xLines(rect: Rect): number[] {
    return [rect.left, rect.left + rect.width / 2, rect.left + rect.width];
}

/** Top edge, middle and bottom edge of a rect. */
function yLines(rect: Rect): number[] {
    return [rect.top, rect.top + rect.height / 2, rect.top + rect.height];
}

/**
 * Smallest correction that lines up one of `own` with one of the target lines, within the threshold.
 * Allocation-free (2.2 performance budget: 1,000 siblings per pointer move); same order and ties as 2.0.
 */
function bestDelta(own: number[], targets: readonly Rect[], vertical: boolean, threshold: number): number | undefined {
    let best: number | undefined;
    let bestAbs = Infinity;
    const o0 = own[0];
    const o1 = own[1];
    const o2 = own[2];
    for (const t of targets) {
        const start = vertical ? t.left : t.top;
        const size = vertical ? t.width : t.height;
        for (let k = 0; k < 3; k++) {
            const target = k === 0 ? start : k === 1 ? start + size / 2 : start + size;
            // Cheap reject: no own line can be within the threshold of this target line.
            if (target < o0 - threshold || target > o2 + threshold) {
                continue;
            }
            for (let j = 0; j < 3; j++) {
                const delta = target - (j === 0 ? o0 : j === 1 ? o1 : o2);
                const abs = Math.abs(delta);
                if (abs <= threshold && abs < bestAbs) {
                    best = delta;
                    bestAbs = abs;
                }
            }
        }
    }
    return best;
}

/**
 * Snaps a moving rect to the edges and centres of the target rects (other draggables and,
 * optionally, the container). Returns the correction to apply plus the guides to draw for
 * every line that is aligned after the correction.
 */
export function computeSnap(moving: Rect, targets: readonly Rect[], options: SnapOptions): SnapResult {
    if (targets.length === 0 || options.threshold <= 0) {
        return { dx: 0, dy: 0, guides: [] };
    }
    const dx = options.snapX ? bestDelta(xLines(moving), targets, true, options.threshold) ?? 0 : 0;
    const dy = options.snapY ? bestDelta(yLines(moving), targets, false, options.threshold) ?? 0 : 0;

    const snapped: Rect = { left: moving.left + dx, top: moving.top + dy, width: moving.width, height: moving.height };
    const guides: Guide[] = [];

    // Every aligned line gets a guide, including lines that were already aligned without a correction.
    if (options.snapX) {
        collectGuides(snapped, targets, "vertical", guides);
    }
    if (options.snapY) {
        collectGuides(snapped, targets, "horizontal", guides);
    }
    return { dx, dy, guides };
}

function collectGuides(moving: Rect, targets: readonly Rect[], orientation: Guide["orientation"], out: Guide[]): void {
    const vertical = orientation === "vertical";
    const ownLines = vertical ? xLines(moving) : yLines(moving);
    for (const target of targets) {
        const start = vertical ? target.left : target.top;
        const size = vertical ? target.width : target.height;
        const t0 = start;
        const t1 = start + size / 2;
        const t2 = start + size;
        for (const line of ownLines) {
            if (Math.abs(t0 - line) < EPSILON || Math.abs(t1 - line) < EPSILON || Math.abs(t2 - line) < EPSILON) {
                const from = vertical ? Math.min(moving.top, target.top) : Math.min(moving.left, target.left);
                const to = vertical
                    ? Math.max(moving.top + moving.height, target.top + target.height)
                    : Math.max(moving.left + moving.width, target.left + target.width);
                const existing = out.find(g => g.orientation === orientation && Math.abs(g.at - line) < EPSILON);
                if (existing) {
                    existing.from = Math.min(existing.from, from);
                    existing.to = Math.max(existing.to, to);
                } else {
                    out.push({ orientation, at: line, from, to });
                }
            }
        }
    }
}
