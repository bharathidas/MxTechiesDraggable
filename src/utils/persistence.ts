import { Position } from "./geometry";

const PREFIX = "mxt-draggable:";

/** Minimal Storage shape, so tests can pass a fake. */
export type PositionStore = Pick<Storage, "getItem" | "setItem">;

export function storageKey(persistKey: string): string {
    return PREFIX + persistKey;
}

/** Parses a stored position, rejecting anything that is not two finite numbers. */
export function parseStoredPosition(raw: string | null | undefined): Position | undefined {
    if (!raw) {
        return undefined;
    }
    try {
        const value = JSON.parse(raw) as Partial<Position> | null;
        if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) {
            return { x: value.x as number, y: value.y as number };
        }
    } catch {
        // Corrupt entry: ignore it and fall back to the defaults.
    }
    return undefined;
}

/** The browser's localStorage, or undefined when it is blocked (private mode, sandboxed iframe). */
export function browserStore(): PositionStore | undefined {
    try {
        return typeof window !== "undefined" ? window.localStorage : undefined;
    } catch {
        return undefined;
    }
}

export function loadPosition(persistKey: string | undefined, store = browserStore()): Position | undefined {
    if (!persistKey || !store) {
        return undefined;
    }
    try {
        return parseStoredPosition(store.getItem(storageKey(persistKey)));
    } catch {
        return undefined;
    }
}

export function savePosition(persistKey: string | undefined, position: Position, store = browserStore()): void {
    if (!persistKey || !store) {
        return;
    }
    try {
        store.setItem(storageKey(persistKey), JSON.stringify({ x: Math.round(position.x), y: Math.round(position.y) }));
    } catch {
        // Quota exceeded or storage blocked: persistence is best effort.
    }
}

/** A stored size (2.1), under its own key so the 2.0 position entries keep their format. */
export function loadSize(persistKey: string | undefined, store = browserStore()): { w: number; h: number } | undefined {
    if (!persistKey || !store) {
        return undefined;
    }
    try {
        const raw = store.getItem(storageKey(persistKey) + ":size");
        const value = raw ? (JSON.parse(raw) as { w?: unknown; h?: unknown } | null) : null;
        if (value && typeof value.w === "number" && typeof value.h === "number" && value.w > 0 && value.h > 0) {
            return { w: value.w, h: value.h };
        }
    } catch {
        // Corrupt entry or blocked storage: use the natural size.
    }
    return undefined;
}

export function saveSize(persistKey: string | undefined, size: { w: number; h: number }, store = browserStore()): void {
    if (!persistKey || !store) {
        return;
    }
    try {
        store.setItem(
            storageKey(persistKey) + ":size",
            JSON.stringify({ w: Math.round(size.w), h: Math.round(size.h) })
        );
    } catch {
        // Best effort.
    }
}

/** A stored number (2.2: rotation and z-index) under its own suffix, so older entries keep their format. */
export function loadNumber(persistKey: string | undefined, suffix: string, store = browserStore()): number | undefined {
    if (!persistKey || !store) {
        return undefined;
    }
    try {
        const raw = store.getItem(`${storageKey(persistKey)}:${suffix}`);
        const value = raw === null ? NaN : Number(raw);
        return raw !== null && raw.trim() !== "" && Number.isFinite(value) ? value : undefined;
    } catch {
        return undefined;
    }
}

export function saveNumber(
    persistKey: string | undefined,
    suffix: string,
    value: number,
    store = browserStore()
): void {
    if (!persistKey || !store) {
        return;
    }
    try {
        store.setItem(`${storageKey(persistKey)}:${suffix}`, String(Math.round(value * 10) / 10));
    } catch {
        // Best effort.
    }
}
