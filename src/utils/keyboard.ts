import { Limits, NO_LIMITS, Position, clampToLimits } from "./geometry";

export type AxisMode = "both" | "x" | "y" | "none";

export interface KeyboardStepOptions {
    axis: AxisMode;
    gridX: number;
    gridY: number;
    /** Step used when there is no grid on that axis. */
    step: number;
}

/** Multiplier applied while Shift is held. */
export const FAST_MULTIPLIER = 10;

/**
 * Translates an arrow key into a move. One press moves one grid step (or `step` pixels
 * without a grid); Shift moves ten times as far. Returns undefined for other keys and for
 * arrows along a locked axis.
 */
export function keyboardDelta(key: string, shiftKey: boolean, options: KeyboardStepOptions): Position | undefined {
    const factor = shiftKey ? FAST_MULTIPLIER : 1;
    const stepX = (options.gridX > 0 ? options.gridX : Math.max(1, options.step)) * factor;
    const stepY = (options.gridY > 0 ? options.gridY : Math.max(1, options.step)) * factor;
    const canX = options.axis === "both" || options.axis === "x";
    const canY = options.axis === "both" || options.axis === "y";
    switch (key) {
        case "ArrowLeft":
            return canX ? { x: -stepX, y: 0 } : undefined;
        case "ArrowRight":
            return canX ? { x: stepX, y: 0 } : undefined;
        case "ArrowUp":
            return canY ? { x: 0, y: -stepY } : undefined;
        case "ArrowDown":
            return canY ? { x: 0, y: stepY } : undefined;
        default:
            return undefined;
    }
}

/** Applies an arrow key to a position, respecting the bounds. Undefined when nothing moves. */
export function keyboardMove(
    position: Position,
    key: string,
    shiftKey: boolean,
    options: KeyboardStepOptions,
    limits: Limits = NO_LIMITS
): Position | undefined {
    const delta = keyboardDelta(key, shiftKey, options);
    if (!delta) {
        return undefined;
    }
    const next = clampToLimits({ x: position.x + delta.x, y: position.y + delta.y }, limits);
    return next.x === position.x && next.y === position.y ? undefined : next;
}

/** Keys that pick the content up and put it down again (for drop zones). */
export function isGrabKey(key: string): boolean {
    return key === "Enter" || key === " " || key === "Spacebar";
}
