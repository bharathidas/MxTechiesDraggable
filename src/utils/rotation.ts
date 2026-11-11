/**
 * 2.2 rotation and z-order helpers. Pure, so they are unit tested.
 */
import { Position } from "./geometry";

/** Normalises an angle to (-180, 180], rounded to 0.1 degree. */
export function normaliseAngle(angle: number): number {
    if (!Number.isFinite(angle)) {
        return 0;
    }
    let a = angle % 360;
    if (a > 180) {
        a -= 360;
    } else if (a <= -180) {
        a += 360;
    }
    const rounded = Math.round(a * 10) / 10;
    return Object.is(rounded, -0) ? 0 : rounded;
}

/** Angle in degrees of a point around a centre, 0 pointing up (where the rotate handle sits), clockwise positive. */
export function angleAround(centre: Position, point: Position): number {
    return (Math.atan2(point.x - centre.x, -(point.y - centre.y)) * 180) / Math.PI;
}

/**
 * The rotation while dragging the handle: the start angle plus how far the pointer turned around the centre.
 * With `step` (Shift held) the result snaps to multiples of the step.
 */
export function rotateBy(startAngle: number, centre: Position, from: Position, to: Position, step = 0): number {
    const turned = angleAround(centre, to) - angleAround(centre, from);
    const raw = startAngle + turned;
    return normaliseAngle(step > 0 ? Math.round(raw / step) * step : raw);
}

/** Keyboard rotation: "[" turns left and "]" turns right by the step (Shift: 1 degree). Undefined for other keys. */
export function keyboardRotation(code: string, key: string, shiftKey: boolean, step: number): number | undefined {
    const amount = shiftKey ? 1 : Math.max(1, step);
    if (code === "BracketLeft" || key === "[" || key === "{") {
        return -amount;
    }
    if (code === "BracketRight" || key === "]" || key === "}") {
        return amount;
    }
    return undefined;
}

export type ZOperation = "front" | "forward" | "backward" | "back";

/**
 * Applies a z-order operation to a group. `items` are the members with their current z-index (undefined counts as
 * 0) in document order, which breaks ties like the browser does. Returns every member's new z-index, normalised to
 * 1..n, so values stay small no matter how often items are moved.
 */
export function applyZOrder(
    items: ReadonlyArray<{ id: string; z: number | undefined }>,
    id: string,
    operation: ZOperation
): Map<string, number> {
    const stack = items
        .map((item, index) => ({ id: item.id, z: item.z ?? 0, index }))
        .sort((a, b) => a.z - b.z || a.index - b.index)
        .map(item => item.id);
    const at = stack.indexOf(id);
    if (at >= 0) {
        stack.splice(at, 1);
        let to = at;
        switch (operation) {
            case "front":
                to = stack.length;
                break;
            case "back":
                to = 0;
                break;
            case "forward":
                to = Math.min(stack.length, at + 1);
                break;
            case "backward":
                to = Math.max(0, at - 1);
                break;
        }
        stack.splice(to, 0, id);
    }
    return new Map(stack.map((member, index) => [member, index + 1]));
}

/** Figma-style shortcuts: Ctrl/Cmd + ] forward, + [ backward, with Shift to the front / back. */
export function zShortcut(code: string, key: string, ctrlOrMeta: boolean, shiftKey: boolean): ZOperation | undefined {
    if (!ctrlOrMeta) {
        return undefined;
    }
    if (code === "BracketRight" || key === "]" || key === "}") {
        return shiftKey ? "front" : "forward";
    }
    if (code === "BracketLeft" || key === "[" || key === "{") {
        return shiftKey ? "back" : "backward";
    }
    return undefined;
}
