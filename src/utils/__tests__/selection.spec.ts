import {
    clickSelection,
    containsRect,
    groupDeltaLimits,
    intersects,
    lassoHits,
    lassoSelection,
    orderSelection,
    pressSelection,
    rectFromPoints
} from "../selection";
import { NO_LIMITS, Rect } from "../geometry";

const box = (left: number, top: number, width = 10, height = 10): Rect => ({ left, top, width, height });

describe("selection", () => {
    it("builds a rubber band from two corners in any direction", () => {
        expect(rectFromPoints({ x: 50, y: 40 }, { x: 10, y: 100 })).toEqual({
            left: 10,
            top: 40,
            width: 40,
            height: 60
        });
    });

    it("tests intersection and containment", () => {
        expect(intersects(box(0, 0), box(10, 10))).toBe(true); // touching corners count
        expect(intersects(box(0, 0), box(11, 0))).toBe(false);
        expect(containsRect(box(0, 0, 100, 100), box(10, 10))).toBe(true);
        expect(containsRect(box(0, 0, 15, 15), box(10, 10))).toBe(false);
    });

    it("picks touched or fully contained items, and ignores a click", () => {
        const items = [box(0, 0), box(30, 0), box(60, 0)];
        expect(lassoHits(box(5, 5, 30, 10), items)).toEqual([0, 1]);
        expect(lassoHits(box(-1, -1, 45, 12), items, "contain")).toEqual([0, 1]);
        expect(lassoHits(box(5, 5, 1, 1), items)).toEqual([]);
    });

    it("replaces the selection, or toggles the lassoed items with a modifier", () => {
        expect(lassoSelection(["a", "b"], ["c"], false)).toEqual(["c"]);
        expect(lassoSelection(["a", "b"], ["b", "c"], true)).toEqual(["a", "c"]);
    });

    it("handles presses like a design tool", () => {
        expect(pressSelection(["a"], "b", false)).toEqual({ next: ["b"], kind: "replace" });
        expect(pressSelection(["a", "b"], "b", false)).toEqual({ next: ["a", "b"], kind: "keep" });
        expect(pressSelection(["a"], "b", true)).toEqual({ next: ["a", "b"], kind: "toggle" });
        expect(pressSelection(["a", "b"], "b", true)).toEqual({ next: ["a"], kind: "toggle" });
        expect(clickSelection(["a", "b"], "b")).toEqual(["b"]);
        expect(clickSelection(["a"], "b")).toEqual(["a"]);
    });

    it("clamps a group move so every member stays inside its own limits", () => {
        const range = groupDeltaLimits([
            { at: { x: 0, y: 0 }, limits: { minX: -10, maxX: 100, minY: 0, maxY: 50 } },
            { at: { x: 80, y: 20 }, limits: { minX: 0, maxX: 120, minY: 0, maxY: 40 } }
        ]);
        expect(range).toEqual({ minX: -10, maxX: 40, minY: 0, maxY: 20 });
        expect(groupDeltaLimits([])).toEqual(NO_LIMITS);
    });

    it("never blocks a group completely when a member is already outside its limits", () => {
        const range = groupDeltaLimits([{ at: { x: 200, y: 0 }, limits: { minX: 0, maxX: 100, minY: 0, maxY: 0 } }]);
        expect(range.minX).toBeLessThanOrEqual(range.maxX);
    });

    it("keeps a selection in document order", () => {
        expect(orderSelection(["c", "a", "x"], ["a", "b", "c"])).toEqual(["a", "c"]);
    });
});
