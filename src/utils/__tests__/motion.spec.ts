import {
    MAX_THROW_DISTANCE,
    TIME_CONSTANT_MS,
    decayDistance,
    decayEasing,
    projectThrow,
    pushSample,
    springCurve,
    springStep,
    tiltFor,
    velocityFromSamples
} from "../motion";

function points(easing: string): number[] {
    return easing
        .replace(/^linear\(|\)$/g, "")
        .split(",")
        .map(Number);
}

describe("velocity tracking", () => {
    it("measures px/ms over the recent window", () => {
        const samples = [
            { x: 0, y: 0, t: 0 },
            { x: 10, y: 0, t: 100 },
            { x: 20, y: 5, t: 150 },
            { x: 40, y: 10, t: 200 }
        ];
        const v = velocityFromSamples(samples);
        expect(v.vx).toBeCloseTo(0.3); // (40 - 10) / (200 - 100)
        expect(v.vy).toBeCloseTo(0.1);
    });

    it("is zero for a single sample or no elapsed time", () => {
        expect(velocityFromSamples([{ x: 5, y: 5, t: 10 }])).toEqual({ vx: 0, vy: 0 });
        const sameTime = [
            { x: 0, y: 0, t: 10 },
            { x: 5, y: 5, t: 10 }
        ];
        expect(velocityFromSamples(sameTime)).toEqual({ vx: 0, vy: 0 });
    });

    it("keeps the buffer small during a long drag", () => {
        let samples = [{ x: 0, y: 0, t: 0 }];
        for (let t = 16; t <= 2000; t += 16) {
            samples = pushSample(samples, { x: t, y: 0, t });
        }
        expect(samples.length).toBeLessThan(10);
        expect(velocityFromSamples(samples).vx).toBeCloseTo(1);
    });
});

describe("momentum decay", () => {
    it("approaches v * timeConstant and never overshoots", () => {
        const v = 1.2;
        let previous = 0;
        for (let t = 0; t <= 3000; t += 100) {
            const d = decayDistance(v, t);
            expect(d).toBeGreaterThanOrEqual(previous);
            expect(d).toBeLessThanOrEqual(v * TIME_CONSTANT_MS);
            previous = d;
        }
        expect(decayDistance(v, 3000)).toBeCloseTo(v * TIME_CONSTANT_MS, 0);
        // About 63% of the distance is covered after one time constant.
        expect(decayDistance(v, TIME_CONSTANT_MS) / (v * TIME_CONSTANT_MS)).toBeCloseTo(1 - Math.exp(-1));
    });

    it("ignores slow releases", () => {
        expect(projectThrow({ x: 0, y: 0 }, { vx: 0.1, vy: 0.1 })).toBeUndefined();
    });

    it("throws v * timeConstant in the release direction", () => {
        const thrown = projectThrow({ x: 10, y: 20 }, { vx: 1, vy: 0 });
        expect(thrown).toBeDefined();
        expect(thrown?.target.x).toBeCloseTo(10 + TIME_CONSTANT_MS);
        expect(thrown?.target.y).toBe(20);
        expect(thrown?.hitBounds).toBe(false);
        expect(thrown?.duration).toBeGreaterThan(500);
        expect(thrown?.duration).toBeLessThanOrEqual(1400);
    });

    it("caps very fast throws", () => {
        const thrown = projectThrow({ x: 0, y: 0 }, { vx: 30, vy: 40 });
        expect(Math.hypot(thrown?.target.x ?? 0, thrown?.target.y ?? 0)).toBeCloseTo(MAX_THROW_DISTANCE);
    });

    it("stops at the bounds and lands on the grid", () => {
        const thrown = projectThrow(
            { x: 0, y: 0 },
            { vx: 2, vy: 0.5 },
            { limits: { minX: -100, maxX: 230, minY: -100, maxY: 100 }, gridX: 50, gridY: 50 }
        );
        expect(thrown?.hitBounds).toBe(true);
        expect(thrown?.target).toEqual({ x: 200, y: 100 });
        expect(thrown?.duration).toBeLessThan(1400);
    });

    it("produces a decay easing that starts at 0, rises monotonically and ends at 1", () => {
        const values = points(decayEasing(800));
        expect(values[0]).toBe(0);
        expect(values[values.length - 1]).toBe(1);
        values.slice(1).forEach((value, i) => expect(value).toBeGreaterThanOrEqual(values[i]));
        // Decelerating: the first step covers more than the last.
        expect(values[1] - values[0]).toBeGreaterThan(values[values.length - 1] - values[values.length - 2]);
    });
});

describe("spring settle", () => {
    it("pulls towards 1", () => {
        const next = springStep({ x: 0, v: 0 }, 1 / 60);
        expect(next.v).toBeGreaterThan(0);
        expect(next.x).toBeGreaterThan(0);
    });

    it("settles at exactly 1 with a little overshoot", () => {
        const curve = springCurve({ stiffness: 170, damping: 19 });
        const values = points(curve.easing);
        expect(values[0]).toBe(0);
        expect(values[values.length - 1]).toBe(1);
        expect(Math.max(...values)).toBeGreaterThan(1);
        expect(Math.max(...values)).toBeLessThan(1.15);
        expect(curve.duration).toBeGreaterThan(200);
        expect(curve.duration).toBeLessThanOrEqual(2000);
    });

    it("does not overshoot when critically damped", () => {
        const values = points(springCurve({ stiffness: 100, damping: 20 }).easing);
        expect(Math.max(...values)).toBeLessThanOrEqual(1);
    });
});

describe("tilt", () => {
    it("leans into the direction of travel and is capped", () => {
        expect(tiltFor(0)).toBe(0);
        expect(tiltFor(0.5)).toBe(2);
        expect(tiltFor(-0.5)).toBe(-2);
        expect(tiltFor(5)).toBe(3);
        expect(tiltFor(-5, 4)).toBe(-4);
    });
});
