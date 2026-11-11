/**
 * 2.2 layout snapshots for a group: capture, save, restore, delete and reset, stored in the group's snapshot
 * attribute (the first member that has one) or, without one, in the browser under the group name.
 */
import { Handle, HistoryChange, members, pushHistoryEntry } from "./registry";
import {
    ItemState,
    SnapshotStore,
    changedFields,
    parseStore,
    serialiseStore,
    withSnapshot,
    withoutSnapshot
} from "./snapshots";
import { browserStore, storageKey } from "./persistence";

export function snapshotMembers(group: string): Handle[] {
    return members(group, h => h.snapshots());
}

function storeHandle(group: string): Handle | undefined {
    return snapshotMembers(group).find(h => h.hasStore());
}

export interface StoreRead {
    store: SnapshotStore;
    error?: string;
    source: "attribute" | "browser" | "none";
}

export function readStore(group: string): StoreRead {
    const handle = storeHandle(group);
    if (handle) {
        return { ...parseStore(handle.readStore()), source: "attribute" };
    }
    const browser = browserStore();
    if (!browser) {
        return { store: { version: 1, snapshots: {} }, source: "none" };
    }
    try {
        return { ...parseStore(browser.getItem(storageKey(`layout:${group}`))), source: "browser" };
    } catch {
        return { store: { version: 1, snapshots: {} }, source: "none" };
    }
}

/** Writes the store; returns the JSON written, or undefined when nothing could store it. */
export function writeStore(group: string, store: SnapshotStore): string | undefined {
    const json = serialiseStore(store);
    const handle = storeHandle(group);
    if (handle) {
        return handle.writeStore(json) ? json : undefined;
    }
    const browser = browserStore();
    try {
        browser?.setItem(storageKey(`layout:${group}`), json);
        return browser ? json : undefined;
    } catch {
        return undefined;
    }
}

export function captureLayout(group: string): Record<string, ItemState> {
    const items: Record<string, ItemState> = {};
    snapshotMembers(group).forEach(h => {
        items[h.itemKey()] = h.state();
    });
    return items;
}

export function saveSnapshot(group: string, name: string, now = new Date()): string | undefined {
    const { store } = readStore(group);
    return writeStore(group, withSnapshot(store, name, captureLayout(group), now.toISOString()));
}

export function deleteSnapshot(group: string, name: string): string | undefined {
    const { store } = readStore(group);
    return writeStore(group, withoutSnapshot(store, name));
}

/**
 * Applies states to the members (by item key) as one undoable step. Returns the number of items that changed.
 */
export function applyLayout(
    group: string,
    states: Record<string, Partial<ItemState>>,
    animate: boolean,
    historyScope: string,
    cap: number
): number {
    const changes: HistoryChange[] = [];
    snapshotMembers(group).forEach(h => {
        const wanted = states[h.itemKey()];
        if (!wanted) {
            return;
        }
        const before = h.state();
        const after: ItemState = { ...before, ...wanted };
        const diff = changedFields(before, after);
        if (Object.keys(diff).length > 0) {
            changes.push({ id: h.id, before: diff });
            h.apply(wanted, animate);
        }
    });
    pushHistoryEntry(historyScope, { changes }, cap);
    return changes.length;
}

/** Restores a named snapshot; undefined when it does not exist. */
export function restoreSnapshot(
    group: string,
    name: string,
    animate: boolean,
    historyScope: string,
    cap: number
): number | undefined {
    const { store } = readStore(group);
    const snapshot = store.snapshots[name];
    if (!snapshot) {
        return undefined;
    }
    return applyLayout(group, snapshot.items, animate, historyScope, cap);
}
