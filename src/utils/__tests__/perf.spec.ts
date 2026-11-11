/**
 * Performance budgets for the per-move work of 2.2 (jest, Node). Budgets are about 5x above the measured numbers
 * on a mid-range laptop so they only fail on real regressions; the measured numbers are printed and recorded in
 * the CHANGELOG.
 */
import { computeSnap } from "../snapping";
import { computeSpacing } from "../spacing";
import { lassoHits } from "../selection";
import { slotPositions, targetIndex } from "../sortable";
import { applyZOrder } from "../rotation";
import { resolveCollision } from "../layout";
import { parseStore, serialiseStore, withSnapshot } from "../snapshots";
import { Rect } from "../geometry";

function time(run: () => void, repeat = 1): number {
    run(); // warm-up
    const start = performance.now();
    for (let i = 0; i < repeat; i++) {
        run();
    }
    return (performance.now() - start) / repeat;
}

const results: Record<string, string> = {};
/** `npm test` instruments the code for coverage, which makes it several times slower: budgets scale with it. */
const COVERAGE_FACTOR = (globalThis as { __coverage__?: unknown }).__coverage__ ? 10 : 1;

function report(name: string, ms: number, budget: number): void {
    const limit = budget * COVERAGE_FACTOR;
    results[name] = `${ms.toFixed(2)} ms (budget ${limit} ms${COVERAGE_FACTOR > 1 ? ", coverage on" : ""})`;
    expect(ms).toBeLessThan(limit);
}

const grid = (n: number, columns = 100): Rect[] =>
    Array.from({ length: n }, (_, i) => ({
        left: (i % columns) * 60,
        top: Math.floor(i / columns) * 60,
        width: 50,
        height: 50
    }));

describe("performance budgets", () => {
    afterAll(() => {
        // eslint-disable-next-line no-console
        console.log(
            "Performance (per call):\n" +
                Object.entries(results)
                    .map(([k, v]) => `  ${k}: ${v}`)
                    .join("\n")
        );
    });

    it("snaps against 1,000 siblings within a frame", () => {
        const targets = grid(1000);
        const ms = time(
            () =>
                computeSnap({ left: 333, top: 222, width: 50, height: 50 }, targets, {
                    threshold: 8,
                    snapX: true,
                    snapY: true
                }),
            50
        );
        report("edge/centre snap, 1,000 siblings", ms, 8);
    });

    it("finds equal spacing among 1,000 siblings within a frame", () => {
        const targets = grid(1000);
        const ms = time(
            () =>
                computeSpacing({ left: 333, top: 245, width: 50, height: 50 }, targets, {
                    threshold: 8,
                    snapX: true,
                    snapY: true
                }),
            50
        );
        report("equal spacing, 1,000 siblings", ms, 8);
    });

    it("hit-tests a lasso over 10,000 items", () => {
        const items = grid(10000);
        const ms = time(() => lassoHits({ left: 100, top: 100, width: 2000, height: 1500 }, items), 50);
        report("lasso hit test, 10,000 items", ms, 10);
    });

    it("lays out and targets a 10,000 item sortable list", () => {
        const cells = Array.from({ length: 10000 }, (_, i) => ({ left: 0, top: i * 40, width: 300, height: 36 }));
        const sizes = cells.map(c => ({ w: c.width, h: c.height }));
        const layout = time(() => slotPositions("list", cells, sizes), 20);
        report("sortable list slots, 10,000 items", layout, 15);
        const target = time(() => targetIndex("list", { x: 10, y: 200000 }, cells), 50);
        report("sortable list target index, 10,000 items", target, 5);
        const gridCells = grid(10000);
        const gridTarget = time(() => targetIndex("grid", { x: 1234, y: 2345 }, gridCells), 50);
        report("sortable grid target index, 10,000 cells", gridTarget, 8);
    });

    it("reorders 10,000 layers", () => {
        const items = Array.from({ length: 10000 }, (_, i) => ({ id: `i${i}`, z: i % 7 }));
        const ms = time(() => applyZOrder(items, "i5000", "front"), 10);
        report("z-order, 10,000 items", ms, 40);
    });

    it("finds a free spot among 200 obstacles", () => {
        const obstacles = grid(200, 20);
        const ms = time(
            () =>
                resolveCollision("nudge", {
                    target: { x: 0, y: 0 },
                    rect: { left: 60, top: 60, width: 50, height: 50 },
                    obstacles,
                    start: { x: 0, y: 0 },
                    step: 10
                }),
            5
        );
        report("collision nudge, 200 obstacles", ms, 250);
    });

    it("saves and parses a 10,000 item snapshot", () => {
        const items: Record<string, { x: number; y: number; w: number; h: number; r: number; z: number }> = {};
        for (let i = 0; i < 10000; i++) {
            items[`item-${i}`] = { x: i, y: i * 2, w: 100, h: 50, r: 15, z: i };
        }
        let json = "";
        const save = time(() => {
            json = serialiseStore(withSnapshot({ version: 1, snapshots: {} }, "Big", items, "now"));
        }, 5);
        report("snapshot save, 10,000 items", save, 150);
        const parse = time(() => parseStore(json), 5);
        report("snapshot parse, 10,000 items", parse, 150);
        expect(Object.keys(parseStore(json).store.snapshots.Big.items)).toHaveLength(10000);
    });
});
