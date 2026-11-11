import {
    changedIndexes,
    columnsOf,
    keyboardSortIndex,
    moveIndex,
    nextGridCell,
    sameOrder,
    slotPositions,
    targetIndex
} from "../sortable";
import { Rect } from "../geometry";

const row = (n: number, size = 50, gap = 10): Rect[] =>
    Array.from({ length: n }, (_, i) => ({ left: 0, top: i * (size + gap), width: 200, height: size }));
const grid = (n: number, columns: number): Rect[] =>
    Array.from({ length: n }, (_, i) => ({
        left: (i % columns) * 110,
        top: Math.floor(i / columns) * 60,
        width: 100,
        height: 50
    }));

describe("sortable", () => {
    it("moves entries", () => {
        expect(moveIndex(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
        expect(moveIndex(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
        expect(moveIndex(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    });

    it("counts grid columns from the first row", () => {
        expect(columnsOf(grid(7, 3))).toBe(3);
        expect(columnsOf(row(4))).toBe(1);
        expect(columnsOf([])).toBe(1);
    });

    it("lays out a list with the frame's gaps and the items' own sizes", () => {
        const cells = row(3); // tops 0, 60, 120
        const sizes = [
            { w: 200, h: 80 },
            { w: 200, h: 50 },
            { w: 200, h: 50 }
        ];
        expect(slotPositions("list", cells, sizes).map(p => p.y)).toEqual([0, 90, 150]);
    });

    it("lays out a list that received an extra item, using the last gap", () => {
        const sizes = Array.from({ length: 4 }, () => ({ w: 200, h: 50 }));
        expect(slotPositions("list", row(3), sizes).map(p => p.y)).toEqual([0, 60, 120, 180]);
    });

    it("lays out a horizontal list along x", () => {
        const cells = [0, 1, 2].map(i => ({ left: i * 70, top: 5, width: 60, height: 30 }));
        const sizes = [60, 100, 60].map(w => ({ w, h: 30 }));
        expect(slotPositions("horizontal", cells, sizes)).toEqual([
            { x: 0, y: 5 },
            { x: 70, y: 5 },
            { x: 180, y: 5 }
        ]);
    });

    it("puts the first item of an empty list at the given corner", () => {
        expect(slotPositions("list", [], [{ w: 10, h: 10 }], { x: 7, y: 9 })).toEqual([{ x: 7, y: 9 }]);
        expect(slotPositions("grid", [], [{ w: 10, h: 10 }], { x: 7, y: 9 })).toEqual([{ x: 7, y: 9 }]);
        expect(slotPositions("list", row(2), [])).toEqual([]);
    });

    it("uses the grid cells and extends the grid after the last cell", () => {
        const cells = grid(5, 3);
        const sizes = Array.from({ length: 6 }, () => ({ w: 100, h: 50 }));
        const positions = slotPositions("grid", cells, sizes);
        expect(positions[4]).toEqual({ x: 110, y: 60 });
        expect(positions[5]).toEqual({ x: 220, y: 60 });
    });

    it("wraps the extra grid cell to a new row when the row is full", () => {
        expect(nextGridCell(grid(3, 3))).toEqual({ left: 0, top: 50, width: 100, height: 50 });
        expect(nextGridCell(grid(6, 3))).toEqual({ left: 0, top: 120, width: 100, height: 50 });
        // With the container's edge known, a row that still has room continues.
        expect(nextGridCell(grid(3, 3), { left: 0, top: 0, width: 500, height: 300 })?.left).toBe(330);
        expect(nextGridCell([])).toBeUndefined();
    });

    it("finds the insertion index in a list from the dragged centre", () => {
        const others = row(3); // middles 25, 85, 145
        expect(targetIndex("list", { x: 10, y: 0 }, others)).toBe(0);
        expect(targetIndex("list", { x: 10, y: 90 }, others)).toBe(2);
        expect(targetIndex("list", { x: 10, y: 999 }, others)).toBe(3);
        const across = [0, 1].map(i => ({ left: i * 70, top: 0, width: 60, height: 30 }));
        expect(targetIndex("horizontal", { x: 75, y: 0 }, across)).toBe(1);
    });

    it("takes the nearest cell in a grid", () => {
        const cells = grid(6, 3);
        expect(targetIndex("grid", { x: 230, y: 70 }, cells, cells)).toBe(5);
        expect(targetIndex("grid", { x: 0, y: 0 }, cells)).toBe(0);
    });

    it("steps with the keyboard in lists, horizontal lists and grids", () => {
        expect(keyboardSortIndex("list", "ArrowDown", 0, 4)).toBe(1);
        expect(keyboardSortIndex("list", "ArrowUp", 0, 4)).toBe(0);
        expect(keyboardSortIndex("list", "End", 1, 4)).toBe(3);
        expect(keyboardSortIndex("list", "Home", 3, 4)).toBe(0);
        expect(keyboardSortIndex("horizontal", "ArrowRight", 1, 4)).toBe(2);
        expect(keyboardSortIndex("horizontal", "ArrowUp", 1, 4)).toBeUndefined();
        expect(keyboardSortIndex("horizontal", "ArrowRight", 1, 4, 1, true)).toBe(0);
        expect(keyboardSortIndex("grid", "ArrowDown", 1, 9, 3)).toBe(4);
        expect(keyboardSortIndex("grid", "ArrowDown", 7, 9, 3)).toBe(8);
        expect(keyboardSortIndex("grid", "ArrowUp", 4, 9, 3)).toBe(1);
        expect(keyboardSortIndex("list", "x", 0, 4)).toBeUndefined();
        expect(keyboardSortIndex("list", "ArrowDown", 0, 0)).toBeUndefined();
    });

    it("compares orders and lists changed indexes", () => {
        expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true);
        expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false);
        expect(changedIndexes(["a", "b", "c"], ["b", "a", "c"])).toEqual([
            ["b", 0],
            ["a", 1]
        ]);
    });
});
