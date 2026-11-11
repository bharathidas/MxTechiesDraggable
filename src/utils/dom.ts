import { Position, Rect } from "./geometry";

/** CSS classes this widget puts on drop zones (elements it does not own). */
export const ZONE_ARMED = "mxt-drop-zone--armed";
export const ZONE_OVER = "mxt-drop-zone--over";
export const ZONE_DROPPED = "mxt-drop-zone--dropped";

export function toRect(rect: DOMRect | Rect): Rect {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/**
 * Where the node is drawn when its translate equals the committed position. Uses the centre of
 * the bounding box (unchanged by the tilt rotation) and the layout size (unchanged by transforms).
 */
export function layoutRect(node: HTMLElement, visualShift: Position = { x: 0, y: 0 }): Rect {
    const box = node.getBoundingClientRect();
    const width = node.offsetWidth || box.width;
    const height = node.offsetHeight || box.height;
    const cx = box.left + box.width / 2 - visualShift.x;
    const cy = box.top + box.height / 2 - visualShift.y;
    return { left: cx - width / 2, top: cy - height / 2, width, height };
}

/** Inner box (inside border and padding) of the element the widget is bounded by. */
export function contentBox(element: Element): Rect {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const px = (value: string): number => parseFloat(value) || 0;
    const left = px(style.borderLeftWidth) + px(style.paddingLeft);
    const right = px(style.borderRightWidth) + px(style.paddingRight);
    const top = px(style.borderTopWidth) + px(style.paddingTop);
    const bottom = px(style.borderBottomWidth) + px(style.paddingBottom);
    return {
        left: rect.left + left,
        top: rect.top + top,
        width: Math.max(0, rect.width - left - right),
        height: Math.max(0, rect.height - top - bottom)
    };
}

/** The translate react-draggable has on screen right now (differs from state mid-animation). */
export function readVisualTranslate(node: HTMLElement): Position | undefined {
    const transform = window.getComputedStyle(node).transform;
    if (!transform || transform === "none" || typeof DOMMatrixReadOnly === "undefined") {
        return undefined;
    }
    try {
        const matrix = new DOMMatrixReadOnly(transform);
        return { x: matrix.m41, y: matrix.m42 };
    } catch {
        return undefined;
    }
}

/** Pointer position of a mouse or touch event (React synthetic or native). */
export function pointerOf(event: unknown): Position | undefined {
    const touchEvent = event as { changedTouches?: ArrayLike<Touch>; touches?: ArrayLike<Touch> };
    const touch = touchEvent.changedTouches?.[0] ?? touchEvent.touches?.[0];
    if (touch) {
        return { x: touch.clientX, y: touch.clientY };
    }
    const mouse = event as { clientX?: number; clientY?: number };
    if (typeof mouse.clientX === "number" && typeof mouse.clientY === "number") {
        return { x: mouse.clientX, y: mouse.clientY };
    }
    return undefined;
}

/** Timestamp of an event, falling back to performance.now() for synthetic events without one. */
export function timeOf(event: unknown): number {
    const stamp = (event as { timeStamp?: number }).timeStamp;
    return typeof stamp === "number" && stamp > 0 ? stamp : performance.now();
}

export function prefersReducedMotion(): boolean {
    try {
        return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    } catch {
        return false;
    }
}

/** Drop zones matching the selector, excluding the widget itself and anything inside it. */
export function findZones(selector: string, node: HTMLElement): HTMLElement[] {
    if (!selector.trim()) {
        return [];
    }
    try {
        return Array.from(node.ownerDocument.querySelectorAll<HTMLElement>(selector)).filter(
            zone => zone !== node && !node.contains(zone)
        );
    } catch {
        // Invalid selector typed in Studio Pro: drop zones are simply off.
        return [];
    }
}

/** Other draggables that share a container with this one, for snap guides. */
export function findSiblings(node: HTMLElement, container: Element | null): HTMLElement[] {
    const isOther = (el: HTMLElement): boolean => el !== node && !el.contains(node) && !node.contains(el);
    if (container) {
        return Array.from(container.querySelectorAll<HTMLElement>(".mxt-draggable")).filter(isOther);
    }
    // No explicit bounds: walk up a few levels (Mendix wraps widgets in containers and layout grid columns)
    // until a level contains other draggables.
    let level: HTMLElement | null = node.parentElement;
    for (let depth = 0; level && depth < 4; depth++) {
        const found = Array.from(level.querySelectorAll<HTMLElement>(".mxt-draggable")).filter(isOther);
        if (found.length > 0) {
            return found;
        }
        level = level.parentElement;
    }
    return [];
}

/** Expanding ring at the drop point. Lives on <body> so zone layout and overflow are untouched. */
export function spawnRipple(doc: Document, point: Position): void {
    const ripple = doc.createElement("span");
    ripple.className = "mxt-drop-ripple";
    ripple.setAttribute("aria-hidden", "true");
    ripple.style.left = `${point.x}px`;
    ripple.style.top = `${point.y}px`;
    const remove = (): void => ripple.remove();
    ripple.addEventListener("animationend", remove, { once: true });
    window.setTimeout(remove, 1000);
    doc.body.appendChild(ripple);
}

/** Briefly flashes a zone after a successful drop. */
export function flashZone(zone: HTMLElement): void {
    zone.classList.remove(ZONE_DROPPED);
    // Re-add on the next frame so the animation restarts when the same zone is hit twice in a row.
    window.requestAnimationFrame(() => {
        zone.classList.add(ZONE_DROPPED);
        window.setTimeout(() => zone.classList.remove(ZONE_DROPPED), 700);
    });
}
