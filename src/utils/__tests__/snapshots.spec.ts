import {
    MAX_SNAPSHOTS,
    changedFields,
    nextSnapshotName,
    parseCommand,
    parseItemState,
    parseStore,
    roundState,
    serialiseStore,
    snapshotNames,
    withSnapshot,
    withoutSnapshot
} from "../snapshots";

describe("layout snapshots", () => {
    it("parses item states and rejects incomplete ones", () => {
        expect(parseItemState({ x: 1, y: 2, w: 10, h: 20, r: 15, z: 3 })).toEqual({
            x: 1,
            y: 2,
            w: 10,
            h: 20,
            r: 15,
            z: 3
        });
        expect(parseItemState({ x: 1, y: 2, w: 10 })).toEqual({ x: 1, y: 2 });
        expect(parseItemState({ x: 1 })).toBeUndefined();
        expect(parseItemState("nope")).toBeUndefined();
    });

    it("parses a store and survives corrupt or foreign values", () => {
        expect(parseStore("")).toEqual({ store: { version: 1, snapshots: {} } });
        expect(parseStore("{oops").error).toBe("invalid-json");
        expect(parseStore('{"a":1}').error).toBe("no-snapshots");
        const { store } = parseStore(
            JSON.stringify({
                version: 1,
                snapshots: { A: { savedAt: "t", items: { k: { x: 1, y: 2 }, bad: { y: 1 } } } }
            })
        );
        expect(store.snapshots.A).toEqual({ savedAt: "t", items: { k: { x: 1, y: 2 } } });
    });

    it("adds, replaces, caps and deletes snapshots", () => {
        let store = withSnapshot({ version: 1, snapshots: {} }, "A", { k: { x: 1.4, y: 2.6, r: 0 } }, "t1");
        store = withSnapshot(store, "B", { k: { x: 5, y: 5, r: 12.34 } }, "t2");
        store = withSnapshot(store, "A", { k: { x: 9, y: 9 } }, "t3");
        expect(snapshotNames(store)).toEqual(["B", "A"]);
        expect(store.snapshots.B.items.k).toEqual({ x: 5, y: 5, r: 12.3 });
        expect(withoutSnapshot(store, "A").snapshots).not.toHaveProperty("A");
        for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) {
            store = withSnapshot(store, `S${i}`, {}, "t");
        }
        expect(snapshotNames(store)).toHaveLength(MAX_SNAPSHOTS);
        expect(parseStore(serialiseStore(store)).store).toEqual(store);
    });

    it("rounds states for storage", () => {
        expect(roundState({ x: 1.6, y: -0.2, w: 10.4, h: 9.5, r: 0, z: 2.2 })).toEqual({
            x: 2,
            y: -0,
            w: 10,
            h: 10,
            z: 2
        });
    });

    it("finds a free default name", () => {
        const store = withSnapshot({ version: 1, snapshots: {} }, "Snapshot 1", {}, "t");
        expect(nextSnapshotName(store)).toBe("Snapshot 2");
    });

    it("parses layout commands", () => {
        expect(parseCommand("save Morning view")).toEqual({ op: "save", name: "Morning view" });
        expect(parseCommand("RESTORE: Morning")).toEqual({ op: "restore", name: "Morning" });
        expect(parseCommand("load x")).toEqual({ op: "restore", name: "x" });
        expect(parseCommand("delete A")).toEqual({ op: "delete", name: "A" });
        expect(parseCommand("save")).toEqual({ op: "save", name: "Default" });
        expect(parseCommand("reset")).toEqual({ op: "reset" });
        expect(parseCommand("explode")).toBeUndefined();
        expect(parseCommand("   ")).toBeUndefined();
    });

    it("lists the fields an undo must restore", () => {
        expect(changedFields({ x: 1, y: 2, r: 0 }, { x: 1, y: 5, r: 15 })).toEqual({ y: 2, r: 0 });
        expect(changedFields({ x: 1, y: 2 }, { x: 1, y: 2, z: 3 })).toEqual({ z: undefined });
    });
});
