import { PositionStore, loadPosition, parseStoredPosition, savePosition, storageKey } from "../persistence";

function fakeStore(): PositionStore & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
        data,
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => {
            data.set(key, value);
        }
    };
}

describe("browser persistence", () => {
    it("round-trips a rounded position under a prefixed key", () => {
        const store = fakeStore();
        savePosition("notes", { x: 10.6, y: -3.2 }, store);
        expect(store.data.get(storageKey("notes"))).toBe('{"x":11,"y":-3}');
        expect(loadPosition("notes", store)).toEqual({ x: 11, y: -3 });
    });

    it("does nothing without a key", () => {
        const store = fakeStore();
        savePosition(undefined, { x: 1, y: 1 }, store);
        expect(store.data.size).toBe(0);
        expect(loadPosition("", store)).toBeUndefined();
    });

    it("rejects corrupt entries", () => {
        expect(parseStoredPosition("not json")).toBeUndefined();
        expect(parseStoredPosition('{"x":"1","y":2}')).toBeUndefined();
        expect(parseStoredPosition("null")).toBeUndefined();
        expect(parseStoredPosition('{"x":1,"y":2}')).toEqual({ x: 1, y: 2 });
    });

    it("survives a store that throws", () => {
        const broken: PositionStore = {
            getItem: () => {
                throw new Error("blocked");
            },
            setItem: () => {
                throw new Error("quota");
            }
        };
        expect(() => savePosition("k", { x: 1, y: 1 }, broken)).not.toThrow();
        expect(loadPosition("k", broken)).toBeUndefined();
    });
});
