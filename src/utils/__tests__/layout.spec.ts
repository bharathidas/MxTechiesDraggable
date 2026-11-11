import {
    edgeScrollSpeed,
    keyboardResize,
    overlaps,
    pushHistory,
    resizeTo,
    resolveCollision,
    sizeLimits,
    zoneAccepts
} from "../layout";

const NO = sizeLimits(0, 0, 0, 0);
const rect = (
    left: number,
    top: number,
    width = 100,
    height = 50
): { left: number; top: number; width: number; height: number } => ({
    left,
    top,
    width,
    height
});

describe("resize", () => {
    it("moves only the dragged edges", () => {
        expect(resizeTo({ w: 100, h: 50 }, { x: 20, y: 30 }, "e", NO)).toEqual({ w: 120, h: 50 });
        expect(resizeTo({ w: 100, h: 50 }, { x: 20, y: 30 }, "s", NO)).toEqual({ w: 100, h: 80 });
        expect(resizeTo({ w: 100, h: 50 }, { x: 20, y: 30 }, "se", NO)).toEqual({ w: 120, h: 80 });
    });

    it("respects minimum and maximum sizes", () => {
        const limits = sizeLimits(60, 40, 150, 90);
        expect(resizeTo({ w: 100, h: 50 }, { x: -80, y: -40 }, "se", limits)).toEqual({ w: 60, h: 40 });
        expect(resizeTo({ w: 100, h: 50 }, { x: 200, y: 200 }, "se", limits)).toEqual({ w: 150, h: 90 });
        expect(resizeTo({ w: 10, h: 10 }, { x: -50, y: -50 }, "se", NO)).toEqual({ w: 1, h: 1 });
    });

    it("snaps to the grid and keeps the aspect ratio when asked", () => {
        expect(resizeTo({ w: 100, h: 50 }, { x: 13, y: 7 }, "se", NO, [25, 25])).toEqual({ w: 125, h: 50 });
        expect(resizeTo({ w: 100, h: 50 }, { x: 100, y: 0 }, "se", NO, undefined, true)).toEqual({ w: 200, h: 100 });
        expect(resizeTo({ w: 100, h: 50 }, { x: 0, y: 50 }, "s", NO, undefined, true)).toEqual({ w: 200, h: 100 });
    });

    it("normalises limits", () => {
        expect(sizeLimits(100, -5, 50, NaN)).toEqual({ minW: 100, minH: 0, maxW: 100, maxH: 0 });
    });

    it("maps Alt + arrows to size changes", () => {
        expect(keyboardResize("ArrowRight", false, 10)).toEqual({ x: 10, y: 0 });
        expect(keyboardResize("ArrowUp", true, 10)).toEqual({ x: 0, y: -100 });
        expect(keyboardResize("Enter", false, 10)).toBeUndefined();
    });
});

describe("collision", () => {
    it("detects overlap but not touching edges", () => {
        expect(overlaps(rect(0, 0), rect(50, 25))).toBe(true);
        expect(overlaps(rect(0, 0), rect(100, 0))).toBe(false);
        expect(overlaps(rect(0, 0), rect(0, 50))).toBe(false);
    });

    it("leaves free targets alone", () => {
        const result = resolveCollision("revert", {
            target: { x: 10, y: 10 },
            rect: rect(10, 10),
            obstacles: [rect(300, 300)],
            start: { x: 0, y: 0 }
        });
        expect(result).toEqual({ position: { x: 10, y: 10 }, outcome: "free" });
    });

    it("reverts an overlapping drop", () => {
        const result = resolveCollision("revert", {
            target: { x: 10, y: 10 },
            rect: rect(10, 10),
            obstacles: [rect(40, 20)],
            start: { x: -200, y: 0 }
        });
        expect(result).toEqual({ position: { x: -200, y: 0 }, outcome: "reverted" });
    });

    it("nudges to the nearest free spot", () => {
        const result = resolveCollision("nudge", {
            target: { x: 0, y: 0 },
            rect: rect(0, 0),
            obstacles: [rect(90, 0)],
            start: { x: 500, y: 500 },
            step: 10
        });
        expect(result.outcome).toBe("nudged");
        expect(overlaps(rect(result.position.x, result.position.y), rect(90, 0))).toBe(false);
        // Ten pixels left frees it; nothing farther is chosen.
        expect(result.position).toEqual({ x: -10, y: 0 });
    });

    it("nudges along the free axis only and reverts when nothing fits", () => {
        const along = resolveCollision("nudge", {
            target: { x: 0, y: 0 },
            rect: rect(0, 0),
            obstacles: [rect(0, 30)],
            start: { x: 0, y: 500 },
            step: 10,
            canMoveX: false
        });
        expect(along.position).toEqual({ x: 0, y: -20 });
        const boxed = resolveCollision("nudge", {
            target: { x: 0, y: 0 },
            rect: rect(0, 0),
            obstacles: [rect(-1000, -1000, 3000, 3000)],
            start: { x: 7, y: 7 },
            step: 10,
            rings: 3
        });
        expect(boxed).toEqual({ position: { x: 7, y: 7 }, outcome: "reverted" });
    });

    it("stays inside the limits when nudging", () => {
        const result = resolveCollision("nudge", {
            target: { x: 0, y: 0 },
            rect: rect(0, 0),
            obstacles: [rect(90, 0)],
            start: { x: 0, y: 0 },
            step: 10,
            limits: { minX: 0, maxX: 1000, minY: 0, maxY: 1000 }
        });
        expect(result.position.x).toBeGreaterThanOrEqual(0);
        expect(result.position.y).toBeGreaterThanOrEqual(0);
        expect(result.outcome).toBe("nudged");
    });
});

describe("drop zone accept rules", () => {
    it("accepts everything without a list or with *", () => {
        expect(zoneAccepts(null, "task")).toBe(true);
        expect(zoneAccepts("", undefined)).toBe(true);
        expect(zoneAccepts("bug *", "anything")).toBe(true);
    });

    it("matches types case-insensitively, space or comma separated", () => {
        expect(zoneAccepts("task, bug", "Task")).toBe(true);
        expect(zoneAccepts("task bug", "invoice")).toBe(false);
        expect(zoneAccepts("invoice", "task invoice")).toBe(true);
        expect(zoneAccepts("invoice", "")).toBe(false);
    });
});

describe("auto-scroll and history", () => {
    const view = { left: 0, top: 0, width: 1000, height: 800 };

    it("does not scroll away from the edges", () => {
        expect(edgeScrollSpeed({ x: 500, y: 400 }, view)).toEqual({ x: 0, y: 0 });
    });

    it("scrolls faster closer to an edge, in its direction", () => {
        const near = edgeScrollSpeed({ x: 500, y: 770 }, view);
        const nearer = edgeScrollSpeed({ x: 500, y: 799 }, view);
        expect(near.y).toBeGreaterThan(0);
        expect(nearer.y).toBeGreaterThan(near.y);
        expect(edgeScrollSpeed({ x: 2, y: 400 }, view).x).toBeLessThan(0);
        expect(edgeScrollSpeed({ x: -50, y: 400 }, view).x).toBe(-20);
    });

    it("keeps a capped history without repeated positions", () => {
        let history = pushHistory([], { x: 0, y: 0 });
        history = pushHistory(history, { x: 0, y: 0 });
        expect(history).toHaveLength(1);
        for (let i = 1; i <= 30; i++) {
            history = pushHistory(history, { x: i, y: 0 }, 20);
        }
        expect(history).toHaveLength(20);
        expect(history[19]).toEqual({ x: 30, y: 0 });
    });
});
