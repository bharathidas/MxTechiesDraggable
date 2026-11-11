/**
 * Pure geometry helpers shared by drop zones, snapping, momentum and keyboard moves.
 * Everything here works on plain numbers so it can be unit tested without a DOM.
 */

export interface Position {
    x: number;
    y: number;
}

export interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** Allowed range of the widget's translate offset. Infinite when unbounded. */
export interface Limits {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

export const NO_LIMITS: Limits = {
    minX: -Infinity,
    maxX: Infinity,
    minY: -Infinity,
    maxY: Infinity
};

export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

export function clampToLimits(position: Position, limits: Limits): Position {
    return {
        x: clamp(position.x, limits.minX, limits.maxX),
        y: clamp(position.y, limits.minY, limits.maxY)
    };
}

export function rectContains(rect: Rect, point: Position): boolean {
    return (
        point.x >= rect.left &&
        point.x <= rect.left + rect.width &&
        point.y >= rect.top &&
        point.y <= rect.top + rect.height
    );
}

/**
 * Returns the index of the drop zone under the point, or -1. When zones are nested the
 * smallest one wins, so a card list inside a column beats the column itself.
 */
export function pickZone(point: Position, zones: readonly Rect[]): number {
    let best = -1;
    let bestArea = Infinity;
    zones.forEach((rect, index) => {
        const area = rect.width * rect.height;
        if (rectContains(rect, point) && area < bestArea) {
            best = index;
            bestArea = area;
        }
    });
    return best;
}

export interface ZoneIdentity {
    dataDropId?: string | null;
    id?: string | null;
    classNames: readonly string[];
}

/**
 * Works out the target id of a drop zone, in this order:
 * 1. the data-drop-id attribute,
 * 2. a class starting with the prefix ('zone-backlog' gives 'backlog'),
 * 3. the id attribute,
 * 4. Mendix's generated 'mx-name-...' class ('mx-name-backlogContainer' gives 'backlogContainer').
 * Mendix containers can only set a class and style, so option 2 is the one most pages use.
 */
export function resolveTargetId(zone: ZoneIdentity, classPrefix: string): string {
    if (zone.dataDropId) {
        return zone.dataDropId;
    }
    if (classPrefix) {
        const match = zone.classNames.find(name => name.startsWith(classPrefix) && name.length > classPrefix.length);
        if (match) {
            return match.slice(classPrefix.length);
        }
    }
    if (zone.id) {
        return zone.id;
    }
    const mxName = zone.classNames.find(name => name.startsWith("mx-name-"));
    return mxName ? mxName.slice("mx-name-".length) : "";
}

/** Position of the widget's top-left corner relative to a zone's top-left corner, rounded. */
export function relativeTo(rect: Rect, zone: Rect): Position {
    return { x: Math.round(rect.left - zone.left), y: Math.round(rect.top - zone.top) };
}

/**
 * Converts the box the widget must stay inside into translate limits.
 * `nodeRect` is where the widget is drawn while its translate offset equals `position`.
 */
export function limitsFromBox(position: Position, nodeRect: Rect, box: Rect): Limits {
    return {
        minX: position.x - (nodeRect.left - box.left),
        maxX: position.x + (box.left + box.width - (nodeRect.left + nodeRect.width)),
        minY: position.y - (nodeRect.top - box.top),
        maxY: position.y + (box.top + box.height - (nodeRect.top + nodeRect.height))
    };
}

/** Limits for the "Distance from start" bounds option, matching react-draggable's object bounds. */
export function limitsFromOffsets(left: number, top: number, right: number, bottom: number): Limits {
    return { minX: -left, maxX: right, minY: -top, maxY: bottom };
}

/** Rounds to the nearest grid step, stepping back inside the limits when the nearest step is outside. */
export function snapToGrid(position: Position, gridX: number, gridY: number, limits: Limits = NO_LIMITS): Position {
    const snapAxis = (value: number, step: number, min: number, max: number): number => {
        if (step <= 0) {
            return value;
        }
        let snapped = Math.round(value / step) * step;
        if (snapped > max) {
            snapped = Math.floor(max / step) * step;
        }
        if (snapped < min) {
            snapped = Math.ceil(min / step) * step;
        }
        return snapped;
    };
    return {
        x: snapAxis(position.x, gridX, limits.minX, limits.maxX),
        y: snapAxis(position.y, gridY, limits.minY, limits.maxY)
    };
}

/** Moves a rect by a delta. */
export function offsetRect(rect: Rect, dx: number, dy: number): Rect {
    return { left: rect.left + dx, top: rect.top + dy, width: rect.width, height: rect.height };
}
