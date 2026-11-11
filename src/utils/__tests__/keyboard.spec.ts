import { FAST_MULTIPLIER, KeyboardStepOptions, isGrabKey, keyboardDelta, keyboardMove } from "../keyboard";

const free: KeyboardStepOptions = { axis: "both", gridX: 0, gridY: 0, step: 10 };

describe("keyboard moves", () => {
    it("moves by the keyboard step without a grid", () => {
        expect(keyboardDelta("ArrowRight", false, free)).toEqual({ x: 10, y: 0 });
        expect(keyboardDelta("ArrowUp", false, free)).toEqual({ x: 0, y: -10 });
    });

    it("moves by one grid step when a grid is set", () => {
        const grid = { ...free, gridX: 25, gridY: 40 };
        expect(keyboardDelta("ArrowLeft", false, grid)).toEqual({ x: -25, y: 0 });
        expect(keyboardDelta("ArrowDown", false, grid)).toEqual({ x: 0, y: 40 });
    });

    it("moves ten times as far with Shift", () => {
        expect(keyboardDelta("ArrowRight", true, free)).toEqual({ x: 10 * FAST_MULTIPLIER, y: 0 });
        expect(keyboardDelta("ArrowDown", true, { ...free, gridY: 20 })).toEqual({ x: 0, y: 200 });
    });

    it("ignores locked axes and other keys", () => {
        expect(keyboardDelta("ArrowUp", false, { ...free, axis: "x" })).toBeUndefined();
        expect(keyboardDelta("ArrowLeft", false, { ...free, axis: "y" })).toBeUndefined();
        expect(keyboardDelta("ArrowLeft", false, { ...free, axis: "none" })).toBeUndefined();
        expect(keyboardDelta("a", false, free)).toBeUndefined();
    });

    it("never uses a step below one pixel", () => {
        expect(keyboardDelta("ArrowRight", false, { ...free, step: 0 })).toEqual({ x: 1, y: 0 });
    });

    it("stays inside the bounds and reports when nothing moves", () => {
        const limits = { minX: -15, maxX: 15, minY: 0, maxY: 0 };
        expect(keyboardMove({ x: 10, y: 0 }, "ArrowRight", false, free, limits)).toEqual({ x: 15, y: 0 });
        expect(keyboardMove({ x: 15, y: 0 }, "ArrowRight", false, free, limits)).toBeUndefined();
        expect(keyboardMove({ x: 0, y: 0 }, "ArrowDown", false, free, limits)).toBeUndefined();
        expect(keyboardMove({ x: 0, y: 0 }, "ArrowLeft", true, free, limits)).toEqual({ x: -15, y: 0 });
    });

    it("recognises Enter and Space as pick-up keys", () => {
        expect(isGrabKey("Enter")).toBe(true);
        expect(isGrabKey(" ")).toBe(true);
        expect(isGrabKey("Escape")).toBe(false);
    });
});
