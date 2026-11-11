/**
 * 2.2 smart guides: equal spacing hints (like design tools). When the moving item sits in a row (or column) with
 * other items, it snaps so that its gaps match a gap that already exists in that row, or so that it sits exactly
 * in the middle between its two neighbours. The hints are the gap segments to draw, with their size in pixels.
 * Pure, so it is unit tested and budgeted.
 */
import { Rect } from "./geometry";

export interface SpacingHint {
    /** "x": a horizontal gap segment between two items on a row; "y": a vertical one in a column. */
    axis: "x" | "y";
    /** Start and end of the gap along the axis. */
    from: number;
    to: number;
    /** Cross-axis position of the segment (y for an "x" hint). */
    at: number;
    /** Gap size in pixels, rounded. */
    gap: number;
}

export interface SpacingResult {
    dx: number;
    dy: number;
    hints: SpacingHint[];
}

interface Span {
    start: number;
    size: number;
    crossStart: number;
    crossSize: number;
}

const EPSILON = 0.5;

function toSpan(rect: Rect, axis: "x" | "y"): Span {
    return axis === "x"
        ? { start: rect.left, size: rect.width, crossStart: rect.top, crossSize: rect.height }
        : { start: rect.top, size: rect.height, crossStart: rect.left, crossSize: rect.width };
}

function crossOverlap(a: Span, b: Span): boolean {
    return a.crossStart < b.crossStart + b.crossSize && b.crossStart < a.crossStart + a.crossSize;
}

function crossMiddle(a: Span, b: Span): number {
    const top = Math.max(a.crossStart, b.crossStart);
    const bottom = Math.min(a.crossStart + a.crossSize, b.crossStart + b.crossSize);
    return (top + bottom) / 2;
}

interface AxisResult {
    delta: number;
    hints: SpacingHint[];
}

function solveAxis(moving: Rect, targets: readonly Rect[], threshold: number, axis: "x" | "y"): AxisResult | undefined {
    const own = toSpan(moving, axis);
    const row = targets.map(t => toSpan(t, axis)).filter(t => crossOverlap(own, t));
    if (row.length === 0) {
        return undefined;
    }
    row.sort((a, b) => a.start - b.start);
    const centre = own.start + own.size / 2;
    let before: Span | undefined;
    let after: Span | undefined;
    for (const span of row) {
        if (span.start + span.size <= centre && (!before || span.start + span.size > before.start + before.size)) {
            before = span;
        }
        if (span.start >= centre && (!after || span.start < after.start)) {
            after = span;
        }
    }
    // Gaps that already exist between neighbouring items of the row.
    const gaps: Array<{ a: Span; b: Span; gap: number }> = [];
    for (let i = 0; i + 1 < row.length; i++) {
        const a = row[i];
        const b = row[i + 1];
        const gap = b.start - (a.start + a.size);
        if (gap > 0 && crossOverlap(a, b)) {
            gaps.push({ a, b, gap });
        }
    }
    let best: { delta: number; gap: number } | undefined;
    const consider = (delta: number, gap: number): void => {
        if (gap > 0 && Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
            best = { delta, gap };
        }
    };
    if (before && after) {
        const free = after.start - (before.start + before.size) - own.size;
        if (free > 0) {
            const wanted = before.start + before.size + free / 2;
            consider(wanted - own.start, free / 2);
        }
    }
    for (const { gap } of gaps) {
        if (before) {
            consider(before.start + before.size + gap - own.start, gap);
        }
        if (after) {
            consider(after.start - gap - own.size - own.start, gap);
        }
    }
    if (!best) {
        return undefined;
    }
    const chosen = best;
    const placed: Span = { ...own, start: own.start + chosen.delta };
    const hints: SpacingHint[] = [];
    const push = (a: Span, b: Span): void => {
        const from = a.start + a.size;
        const gap = b.start - from;
        if (Math.abs(gap - chosen.gap) < EPSILON + 0.01) {
            hints.push({ axis, from, to: b.start, at: crossMiddle(a, b), gap: Math.round(gap) });
        }
    };
    if (before) {
        push(before, placed);
    }
    if (after) {
        push(placed, after);
    }
    gaps.forEach(({ a, b }) => push(a, b));
    return hints.length > 0 ? { delta: chosen.delta, hints } : undefined;
}

/** Equal spacing correction and hints for a moving rect among target rects, per free axis. */
export function computeSpacing(
    moving: Rect,
    targets: readonly Rect[],
    options: { threshold: number; snapX: boolean; snapY: boolean }
): SpacingResult {
    const result: SpacingResult = { dx: 0, dy: 0, hints: [] };
    if (targets.length === 0 || options.threshold <= 0) {
        return result;
    }
    if (options.snapX) {
        const x = solveAxis(moving, targets, options.threshold, "x");
        if (x) {
            result.dx = x.delta;
            result.hints.push(...x.hints);
        }
    }
    if (options.snapY) {
        const y = solveAxis(moving, targets, options.threshold, "y");
        if (y) {
            result.dy = y.delta;
            result.hints.push(...y.hints);
        }
    }
    return result;
}
