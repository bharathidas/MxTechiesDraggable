/**
 * 2.2 layout snapshots: a JSON document with named snapshots of the positions, sizes, rotation and z-index of the
 * draggables in a group. Pure parsing, so corrupt or foreign values never break a page.
 *
 * Format (version 1):
 * { "version": 1, "snapshots": { "<name>": { "savedAt": "<ISO date>", "items": { "<item key>": { "x": 0, "y": 0,
 *   "w": 120, "h": 60, "r": 15, "z": 2 } } } } }
 * w, h, r and z are optional.
 */
import { Position } from "./geometry";

export interface ItemState {
    x: number;
    y: number;
    w?: number;
    h?: number;
    r?: number;
    z?: number;
}

export interface Snapshot {
    savedAt: string;
    items: Record<string, ItemState>;
}

export interface SnapshotStore {
    version: 1;
    snapshots: Record<string, Snapshot>;
}

export const EMPTY_STORE: SnapshotStore = { version: 1, snapshots: {} };
/** Snapshots kept per group; the oldest is dropped beyond this. */
export const MAX_SNAPSHOTS = 50;

function finite(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

/** Validates one item entry; undefined when x or y is missing. */
export function parseItemState(value: unknown): ItemState | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const v = value as Record<string, unknown>;
    if (!finite(v.x) || !finite(v.y)) {
        return undefined;
    }
    const out: ItemState = { x: v.x, y: v.y };
    if (finite(v.w) && v.w > 0 && finite(v.h) && v.h > 0) {
        out.w = v.w;
        out.h = v.h;
    }
    if (finite(v.r)) {
        out.r = v.r;
    }
    if (finite(v.z)) {
        out.z = v.z;
    }
    return out;
}

/** Parses a stored document; anything unreadable gives an empty store (the error is reported by the caller). */
export function parseStore(raw: string | null | undefined): { store: SnapshotStore; error?: string } {
    if (!raw || !raw.trim()) {
        return { store: { version: 1, snapshots: {} } };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { store: { version: 1, snapshots: {} }, error: "invalid-json" };
    }
    const snapshots: Record<string, Snapshot> = {};
    const source = (parsed as { snapshots?: unknown })?.snapshots;
    if (!source || typeof source !== "object") {
        return { store: { version: 1, snapshots }, error: "no-snapshots" };
    }
    for (const [name, entry] of Object.entries(source as Record<string, unknown>)) {
        const items: Record<string, ItemState> = {};
        const rawItems = (entry as { items?: unknown })?.items;
        if (rawItems && typeof rawItems === "object") {
            for (const [key, state] of Object.entries(rawItems as Record<string, unknown>)) {
                const item = parseItemState(state);
                if (item) {
                    items[key] = item;
                }
            }
        }
        const savedAt = (entry as { savedAt?: unknown })?.savedAt;
        snapshots[name] = { savedAt: typeof savedAt === "string" ? savedAt : "", items };
    }
    return { store: { version: 1, snapshots } };
}

export function serialiseStore(store: SnapshotStore): string {
    return JSON.stringify(store);
}

/** Rounds a state for storage (whole pixels, 0.1 degree). */
export function roundState(state: ItemState): ItemState {
    const out: ItemState = { x: Math.round(state.x), y: Math.round(state.y) };
    if (state.w !== undefined && state.h !== undefined) {
        out.w = Math.round(state.w);
        out.h = Math.round(state.h);
    }
    if (state.r !== undefined && state.r !== 0) {
        out.r = Math.round(state.r * 10) / 10;
    }
    if (state.z !== undefined) {
        out.z = Math.round(state.z);
    }
    return out;
}

/** Adds or replaces a snapshot (moved to the end, so the newest is last); drops the oldest beyond the cap. */
export function withSnapshot(
    store: SnapshotStore,
    name: string,
    items: Record<string, ItemState>,
    savedAt: string
): SnapshotStore {
    const rest = Object.entries(store.snapshots).filter(([key]) => key !== name);
    const rounded: Record<string, ItemState> = {};
    Object.entries(items).forEach(([key, state]) => {
        rounded[key] = roundState(state);
    });
    const all = [...rest, [name, { savedAt, items: rounded }] as [string, Snapshot]].slice(-MAX_SNAPSHOTS);
    return { version: 1, snapshots: Object.fromEntries(all) };
}

export function withoutSnapshot(store: SnapshotStore, name: string): SnapshotStore {
    return {
        version: 1,
        snapshots: Object.fromEntries(Object.entries(store.snapshots).filter(([key]) => key !== name))
    };
}

export function snapshotNames(store: SnapshotStore): string[] {
    return Object.keys(store.snapshots);
}

/** A free default name: "Snapshot 1", "Snapshot 2", ... */
export function nextSnapshotName(store: SnapshotStore, base = "Snapshot"): string {
    let n = 1;
    while (Object.prototype.hasOwnProperty.call(store.snapshots, `${base} ${n}`)) {
        n++;
    }
    return `${base} ${n}`;
}

export type LayoutCommand =
    | { op: "save"; name: string }
    | { op: "restore"; name: string }
    | { op: "delete"; name: string }
    | { op: "reset" };

/**
 * Parses a command written to the Layout command attribute: "save Morning", "restore Morning", "delete Morning",
 * "reset". The name may contain spaces; "save" without a name uses "Default". Case-insensitive verbs.
 */
export function parseCommand(raw: string | undefined): LayoutCommand | undefined {
    const text = (raw ?? "").trim();
    if (!text) {
        return undefined;
    }
    const match = /^(\w+)(?:[\s:]+(.*))?$/.exec(text);
    if (!match) {
        return undefined;
    }
    const verb = match[1].toLowerCase();
    const name = (match[2] ?? "").trim() || "Default";
    switch (verb) {
        case "save":
            return { op: "save", name };
        case "restore":
        case "load":
            return { op: "restore", name };
        case "delete":
        case "remove":
            return { op: "delete", name };
        case "reset":
            return { op: "reset" };
        default:
            return undefined;
    }
}

/** Fields of `after` that differ from `before` - what an undo entry has to restore. */
export function changedFields(before: ItemState, after: ItemState): Partial<ItemState> {
    const out: Partial<ItemState> = {};
    (["x", "y", "w", "h", "r", "z"] as const).forEach(key => {
        if (before[key] !== after[key]) {
            out[key] = before[key];
        }
    });
    return out;
}

export function positionOf(state: ItemState): Position {
    return { x: state.x, y: state.y };
}
