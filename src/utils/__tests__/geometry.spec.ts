import {
    NO_LIMITS,
    clampToLimits,
    limitsFromBox,
    limitsFromOffsets,
    pickZone,
    relativeTo,
    resolveTargetId,
    snapToGrid
} from "../geometry";

describe("drop zone hit testing", () => {
    const backlog = { left: 0, top: 0, width: 200, height: 400 };
    const doing = { left: 220, top: 0, width: 200, height: 400 };
    const nested = { left: 20, top: 50, width: 100, height: 100 };

    it("finds the zone under the pointer", () => {
        expect(pickZone({ x: 300, y: 100 }, [backlog, doing])).toBe(1);
        expect(pickZone({ x: 10, y: 10 }, [backlog, doing])).toBe(0);
    });

    it("returns -1 between and outside zones", () => {
        expect(pickZone({ x: 210, y: 100 }, [backlog, doing])).toBe(-1);
        expect(pickZone({ x: 10, y: 500 }, [backlog, doing])).toBe(-1);
        expect(pickZone({ x: 10, y: 10 }, [])).toBe(-1);
    });

    it("counts the edges as inside", () => {
        expect(pickZone({ x: 200, y: 400 }, [backlog])).toBe(0);
    });

    it("prefers the smallest zone when zones are nested", () => {
        expect(pickZone({ x: 50, y: 80 }, [backlog, nested])).toBe(1);
        expect(pickZone({ x: 50, y: 80 }, [nested, backlog])).toBe(0);
        expect(pickZone({ x: 150, y: 300 }, [backlog, nested])).toBe(0);
    });
});

describe("target id resolution", () => {
    it("uses data-drop-id first", () => {
        expect(resolveTargetId({ dataDropId: "done", id: "x", classNames: ["zone-backlog"] }, "zone-")).toBe("done");
    });

    it("derives the id from a prefixed class", () => {
        expect(resolveTargetId({ classNames: ["drop-zone", "zone-backlog"] }, "zone-")).toBe("backlog");
        expect(resolveTargetId({ classNames: ["drop-zone", "col-in-progress"] }, "col-")).toBe("in-progress");
    });

    it("does not treat the bare prefix as an id", () => {
        expect(resolveTargetId({ classNames: ["zone-"], id: "fallback" }, "zone-")).toBe("fallback");
    });

    it("falls back to the id attribute, then the mx-name class", () => {
        expect(resolveTargetId({ id: "trash", classNames: ["drop-zone", "mx-name-c1"] }, "zone-")).toBe("trash");
        expect(resolveTargetId({ id: "", classNames: ["drop-zone", "mx-name-containerDone"] }, "zone-")).toBe(
            "containerDone"
        );
        expect(resolveTargetId({ classNames: ["drop-zone"] }, "zone-")).toBe("");
    });

    it("skips the class lookup when the prefix is empty", () => {
        expect(resolveTargetId({ classNames: ["zone-a"], id: "b" }, "")).toBe("b");
    });
});

describe("relative drop coordinates", () => {
    it("measures the content's top-left corner from the zone's top-left corner", () => {
        const content = { left: 130.4, top: 75.6, width: 50, height: 20 };
        const zone = { left: 100, top: 50, width: 300, height: 300 };
        expect(relativeTo(content, zone)).toEqual({ x: 30, y: 26 });
    });
});

describe("limits", () => {
    it("converts a bounding box into translate limits", () => {
        // Content 100x50 drawn at (50, 20) with translate (10, 0), inside a 400x300 box at the origin.
        const content = { left: 50, top: 20, width: 100, height: 50 };
        const box = { left: 0, top: 0, width: 400, height: 300 };
        expect(limitsFromBox({ x: 10, y: 0 }, content, box)).toEqual({ minX: -40, maxX: 260, minY: -20, maxY: 230 });
    });

    it("matches react-draggable's offset bounds", () => {
        expect(limitsFromOffsets(100, 50, 80, 30)).toEqual({ minX: -100, maxX: 80, minY: -50, maxY: 30 });
    });

    it("clamps positions", () => {
        const limits = { minX: -10, maxX: 10, minY: 0, maxY: 5 };
        expect(clampToLimits({ x: 50, y: -3 }, limits)).toEqual({ x: 10, y: 0 });
        expect(clampToLimits({ x: 50, y: -3 }, NO_LIMITS)).toEqual({ x: 50, y: -3 });
    });
});

describe("grid snapping", () => {
    it("rounds to the nearest step", () => {
        expect(snapToGrid({ x: 37, y: 12 }, 25, 25)).toEqual({ x: 25, y: 0 });
        expect(snapToGrid({ x: 38, y: 13 }, 25, 25)).toEqual({ x: 50, y: 25 });
    });

    it("leaves an axis alone when its step is 0", () => {
        expect(snapToGrid({ x: 37, y: 12 }, 0, 10)).toEqual({ x: 37, y: 10 });
    });

    it("steps back inside the limits", () => {
        const limits = { minX: -90, maxX: 90, minY: -90, maxY: 90 };
        expect(snapToGrid({ x: 95, y: -95 }, 25, 25, limits)).toEqual({ x: 75, y: -75 });
    });
});
