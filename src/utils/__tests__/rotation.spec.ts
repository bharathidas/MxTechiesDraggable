import { angleAround, applyZOrder, keyboardRotation, normaliseAngle, rotateBy, zShortcut } from "../rotation";

describe("rotation", () => {
    it("normalises angles to -180..180", () => {
        expect(normaliseAngle(190)).toBe(-170);
        expect(normaliseAngle(-190)).toBe(170);
        expect(normaliseAngle(180)).toBe(180);
        expect(normaliseAngle(-180)).toBe(180);
        expect(normaliseAngle(720.04)).toBe(0);
        expect(normaliseAngle(Number.NaN)).toBe(0);
    });

    it("measures angles clockwise from 12 o'clock", () => {
        const c = { x: 0, y: 0 };
        expect(angleAround(c, { x: 0, y: -10 })).toBeCloseTo(0);
        expect(angleAround(c, { x: 10, y: 0 })).toBeCloseTo(90);
        expect(angleAround(c, { x: -10, y: 0 })).toBeCloseTo(-90);
    });

    it("rotates by how far the pointer turned, snapping with a step", () => {
        const c = { x: 0, y: 0 };
        expect(rotateBy(10, c, { x: 0, y: -10 }, { x: 10, y: 0 })).toBeCloseTo(100);
        expect(rotateBy(0, c, { x: 0, y: -10 }, { x: 10, y: -9 }, 15)).toBe(45);
    });

    it("maps [ and ] to rotation steps", () => {
        expect(keyboardRotation("BracketLeft", "[", false, 15)).toBe(-15);
        expect(keyboardRotation("BracketRight", "}", true, 15)).toBe(1);
        expect(keyboardRotation("KeyA", "a", false, 15)).toBeUndefined();
    });
});

describe("z-order", () => {
    const items = [
        { id: "a", z: undefined },
        { id: "b", z: 3 },
        { id: "c", z: 1 }
    ];

    it("brings an item to the front and normalises to 1..n", () => {
        const next = applyZOrder(items, "a", "front");
        expect([...next.entries()]).toEqual([
            ["c", 1],
            ["b", 2],
            ["a", 3]
        ]);
    });

    it("sends back, forward and backward one layer at a time", () => {
        expect(applyZOrder(items, "b", "back").get("b")).toBe(1);
        expect(applyZOrder(items, "a", "forward").get("a")).toBe(2);
        expect(applyZOrder(items, "c", "backward").get("c")).toBe(1); // stack a, c, b -> c, a, b
        expect(applyZOrder(items, "a", "backward").get("a")).toBe(1);
    });

    it("breaks ties by document order", () => {
        const tied = applyZOrder(
            [
                { id: "x", z: 0 },
                { id: "y", z: 0 }
            ],
            "x",
            "forward"
        );
        expect(tied.get("x")).toBe(2);
        expect(tied.get("y")).toBe(1);
    });

    it("maps the design tool shortcuts", () => {
        expect(zShortcut("BracketRight", "]", true, false)).toBe("forward");
        expect(zShortcut("BracketRight", "}", true, true)).toBe("front");
        expect(zShortcut("BracketLeft", "[", true, false)).toBe("backward");
        expect(zShortcut("BracketLeft", "{", true, true)).toBe("back");
        expect(zShortcut("BracketLeft", "[", false, false)).toBeUndefined();
    });
});
