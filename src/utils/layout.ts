/**
 * 2.1 logic: resizing, collision avoidance, drop-zone accept rules, auto-scroll speed and the move history.
 * Pure, so every rule is unit tested.
 */
import { Limits, NO_LIMITS, Position, Rect, clampToLimits, offsetRect } from "./geometry";

export interface Size {
    w: number;
    h: number;
}

export interface SizeLimits {
    minW: number;
    minH: number;
    /** 0 or less means no maximum. */
    maxW: number;
    maxH: number;
}

export type ResizeEdge = "e" | "s" | "se";

/**
 * The size after dragging a resize handle by `delta`. Only the east and south edges move, so the content's
 * position never changes while resizing. Applies min/max limits, an optional grid and an optional aspect ratio.
 */
export function resizeTo(
    start: Size,
    delta: Position,
    edge: ResizeEdge,
    limits: SizeLimits,
    grid: [number, number] | undefined = undefined,
    keepAspect = false
): Size {
    let w = edge === "s" ? start.w : start.w + delta.x;
    let h = edge === "e" ? start.h : start.h + delta.y;
    if (grid) {
        if (grid[0] > 0 && edge !== "s") {
            w = Math.round(w / grid[0]) * grid[0];
        }
        if (grid[1] > 0 && edge !== "e") {
            h = Math.round(h / grid[1]) * grid[1];
        }
    }
    if (keepAspect && start.w > 0 && start.h > 0) {
        const ratio = start.w / start.h;
        if (edge === "s") {
            w = h * ratio;
        } else {
            h = w / ratio;
        }
    }
    const clampSide = (value: number, min: number, max: number): number =>
        Math.max(Math.max(1, min), max > 0 ? Math.min(max, value) : value);
    return {
        w: Math.round(clampSide(w, limits.minW, limits.maxW)),
        h: Math.round(clampSide(h, limits.minH, limits.maxH))
    };
}

/** Normalises the Studio Pro size limits (min above max is resolved in favour of the minimum). */
export function sizeLimits(minW: number, minH: number, maxW: number, maxH: number): SizeLimits {
    const lo = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);
    const out = { minW: lo(minW), minH: lo(minH), maxW: lo(maxW), maxH: lo(maxH) };
    if (out.maxW > 0 && out.maxW < out.minW) {
        out.maxW = out.minW;
    }
    if (out.maxH > 0 && out.maxH < out.minH) {
        out.maxH = out.minH;
    }
    return out;
}

/** True when two rects overlap by more than `tolerance` pixels on both axes (touching edges do not count). */
export function overlaps(a: Rect, b: Rect, tolerance = 0.5): boolean {
    return (
        a.left + tolerance < b.left + b.width &&
        b.left + tolerance < a.left + a.width &&
        a.top + tolerance < b.top + b.height &&
        b.top + tolerance < a.top + a.height
    );
}

export type CollisionMode = "none" | "revert" | "nudge";

export interface CollisionInput {
    /** Translate the content would land at. */
    target: Position;
    /** The content's rect at that translate. */
    rect: Rect;
    /** Rects of the other draggables. */
    obstacles: readonly Rect[];
    /** Where the drag started (for revert). */
    start: Position;
    limits?: Limits;
    /** Search step in pixels for nudge (the grid step when there is one). */
    step?: number;
    /** Search radius in steps. */
    rings?: number;
    canMoveX?: boolean;
    canMoveY?: boolean;
}

export interface CollisionResult {
    position: Position;
    /** "free" when the target was free, "nudged" or "reverted" otherwise. */
    outcome: "free" | "nudged" | "reverted";
}

/**
 * Keeps draggables from landing on each other. Revert returns to the start; nudge searches rings of candidate
 * positions around the target (nearest first, inside the limits, along the free axes) and reverts when none fits.
 */
export function resolveCollision(mode: CollisionMode, input: CollisionInput): CollisionResult {
    const { target, rect, obstacles } = input;
    const hits = (r: Rect): boolean => obstacles.some(o => overlaps(r, o));
    if (mode === "none" || !hits(rect)) {
        return { position: target, outcome: "free" };
    }
    if (mode === "nudge") {
        const step = Math.max(1, input.step ?? 8);
        const rings = Math.max(1, input.rings ?? 40);
        const limits = input.limits ?? NO_LIMITS;
        const canX = input.canMoveX !== false;
        const canY = input.canMoveY !== false;
        let best: { position: Position; distance: number } | undefined;
        for (let ring = 1; ring <= rings && !best; ring++) {
            for (let i = -ring; i <= ring; i++) {
                for (let j = -ring; j <= ring; j++) {
                    if (Math.max(Math.abs(i), Math.abs(j)) !== ring || (!canX && i !== 0) || (!canY && j !== 0)) {
                        continue;
                    }
                    const wanted = { x: target.x + i * step, y: target.y + j * step };
                    const candidate = clampToLimits(wanted, limits);
                    if (candidate.x !== wanted.x || candidate.y !== wanted.y) {
                        continue;
                    }
                    const moved = offsetRect(rect, candidate.x - target.x, candidate.y - target.y);
                    if (!hits(moved)) {
                        const distance = Math.hypot(i, j);
                        if (!best || distance < best.distance) {
                            best = { position: candidate, distance };
                        }
                    }
                }
            }
        }
        if (best) {
            return { position: best.position, outcome: "nudged" };
        }
    }
    return { position: input.start, outcome: "reverted" };
}

/**
 * Whether a drop zone accepts this draggable. Zones without an accept list take everything; otherwise the
 * draggable's type must be one of the space or comma separated entries ("*" accepts all types).
 */
export function zoneAccepts(accept: string | null | undefined, type: string | undefined): boolean {
    const list = (accept ?? "")
        .split(/[\s,]+/)
        .map(entry => entry.trim().toLowerCase())
        .filter(Boolean);
    if (list.length === 0 || list.includes("*")) {
        return true;
    }
    const own = (type ?? "")
        .split(/[\s,]+/)
        .map(entry => entry.trim().toLowerCase())
        .filter(Boolean);
    return own.some(entry => list.includes(entry));
}

/**
 * Auto-scroll speed in px per frame for a pointer near the edge of a viewport: zero outside the edge band,
 * growing quadratically to `max` at the very edge.
 */
export function edgeScrollSpeed(
    pointer: Position,
    view: { left: number; top: number; width: number; height: number },
    band = 48,
    max = 20
): Position {
    const axis = (value: number, start: number, size: number): number => {
        const fromStart = value - start;
        const fromEnd = start + size - value;
        if (fromStart < band) {
            const t = 1 - Math.max(0, fromStart) / band;
            return -Math.round(max * t * t);
        }
        if (fromEnd < band) {
            const t = 1 - Math.max(0, fromEnd) / band;
            return Math.round(max * t * t);
        }
        return 0;
    };
    return { x: axis(pointer.x, view.left, view.width), y: axis(pointer.y, view.top, view.height) };
}

/** Adds a position to the undo history (no duplicates in a row, capped length). */
export function pushHistory(history: readonly Position[], position: Position, cap = 20): Position[] {
    const last = history[history.length - 1];
    if (last && last.x === position.x && last.y === position.y) {
        return [...history];
    }
    return [...history, { x: position.x, y: position.y }].slice(-cap);
}

/** Keyboard resize: Alt + arrow keys; Shift makes the step ten times larger. Undefined for other keys. */
export function keyboardResize(key: string, shiftKey: boolean, step: number): Position | undefined {
    const amount = Math.max(1, step) * (shiftKey ? 10 : 1);
    switch (key) {
        case "ArrowRight":
            return { x: amount, y: 0 };
        case "ArrowLeft":
            return { x: -amount, y: 0 };
        case "ArrowDown":
            return { x: 0, y: amount };
        case "ArrowUp":
            return { x: 0, y: -amount };
        default:
            return undefined;
    }
}
