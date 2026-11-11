import { computeSpacing } from "../spacing";
import { Rect } from "../geometry";

const box = (left: number, top: number, width = 50, height = 50): Rect => ({ left, top, width, height });
const options = { threshold: 8, snapX: true, snapY: true };

describe("equal spacing", () => {
    it("snaps into the middle between two neighbours and shows both gaps", () => {
        // a: 0-50, b: 200-250; moving 50 wide: centred at left 100 (gaps 50 / 50)
        const result = computeSpacing(box(104, 0), [box(0, 0), box(200, 0)], options);
        expect(result.dx).toBe(-4);
        expect(result.hints.filter(h => h.axis === "x").map(h => h.gap)).toEqual([50, 50]);
    });

    it("repeats a gap that exists in the row", () => {
        // a: 0-50, b: 80-130 (gap 30); moving right of b: wanted left 160
        const result = computeSpacing(box(165, 0), [box(0, 0), box(80, 0)], options);
        expect(result.dx).toBe(-5);
        const gaps = result.hints.map(h => h.gap);
        expect(gaps).toEqual([30, 30]);
    });

    it("works on columns too", () => {
        const result = computeSpacing(box(0, 163), [box(0, 0), box(0, 80)], options);
        expect(result.dy).toBe(-3);
        expect(result.hints.every(h => h.axis === "y")).toBe(true);
    });

    it("ignores items outside the row and corrections beyond the threshold", () => {
        expect(computeSpacing(box(165, 300), [box(0, 0), box(80, 0)], options)).toEqual({ dx: 0, dy: 0, hints: [] });
        expect(computeSpacing(box(190, 0), [box(0, 0), box(80, 0)], options).dx).toBe(0);
        expect(computeSpacing(box(0, 0), [], options).hints).toEqual([]);
    });

    it("respects locked axes", () => {
        const result = computeSpacing(box(165, 0), [box(0, 0), box(80, 0)], { ...options, snapX: false });
        expect(result.dx).toBe(0);
    });
});
