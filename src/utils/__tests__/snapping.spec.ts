import { computeSnap } from "../snapping";

const sibling = { left: 100, top: 100, width: 100, height: 50 };
const both = { threshold: 8, snapX: true, snapY: true };

describe("snap guides", () => {
    it("snaps a left edge to a sibling's left edge within the threshold", () => {
        const result = computeSnap({ left: 105, top: 300, width: 60, height: 40 }, [sibling], both);
        expect(result.dx).toBe(-5);
        expect(result.dy).toBe(0);
        expect(result.guides).toContainEqual({ orientation: "vertical", at: 100, from: 100, to: 340 });
    });

    it("snaps centres to centres", () => {
        // Moving centre = 123 + 30 = 153, sibling centre = 150.
        const result = computeSnap({ left: 123, top: 300, width: 60, height: 40 }, [sibling], both);
        expect(result.dx).toBe(-3);
        expect(result.guides).toContainEqual(expect.objectContaining({ orientation: "vertical", at: 150 }));
    });

    it("snaps a right edge to a sibling's left edge (side by side)", () => {
        const result = computeSnap({ left: 36, top: 100, width: 60, height: 50 }, [sibling], both);
        expect(result.dx).toBe(4);
        expect(result.dy).toBe(0);
        // Top, middle and bottom were already aligned, so they get guides without a correction.
        expect(result.guides.filter(g => g.orientation === "horizontal")).toHaveLength(3);
    });

    it("picks the closest candidate", () => {
        const small = { left: 0, top: 102, width: 10, height: 10 };
        const result = computeSnap({ left: 0, top: 104, width: 40, height: 10 }, [sibling, small], both);
        expect(result.dy).toBe(-2);
    });

    it("does nothing beyond the threshold", () => {
        const result = computeSnap({ left: 400, top: 400, width: 10, height: 10 }, [sibling], both);
        expect(result).toEqual({ dx: 0, dy: 0, guides: [] });
    });

    it("respects axis locking", () => {
        const result = computeSnap({ left: 105, top: 103, width: 60, height: 10 }, [sibling], {
            threshold: 8,
            snapX: false,
            snapY: true
        });
        expect(result.dx).toBe(0);
        expect(result.dy).toBe(-3);
        expect(result.guides.every(g => g.orientation === "horizontal")).toBe(true);
    });

    it("is off without targets or with a zero threshold", () => {
        expect(computeSnap(sibling, [], both).dx).toBe(0);
        expect(computeSnap({ ...sibling, left: 101 }, [sibling], { ...both, threshold: 0 }).dx).toBe(0);
    });

    it("merges guides for several aligned siblings into one line", () => {
        const a = { left: 100, top: 0, width: 50, height: 50 };
        const b = { left: 100, top: 400, width: 50, height: 50 };
        const result = computeSnap({ left: 102, top: 200, width: 50, height: 50 }, [a, b], { ...both, snapY: false });
        const atLeft = result.guides.filter(g => g.at === 100);
        expect(atLeft).toHaveLength(1);
        expect(atLeft[0]).toMatchObject({ from: 0, to: 450 });
    });
});
