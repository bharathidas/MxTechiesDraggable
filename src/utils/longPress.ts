/**
 * 2.2 touch long-press gate: a touch only starts a drag after the finger rests for `delay` ms. Moving more than the
 * tolerance first (a scroll) or lifting the finger cancels it, so the page keeps scrolling normally on phones.
 * Timer-driven but DOM-free, so it is unit tested with fake timers.
 */
import { Position } from "./geometry";

export const LONG_PRESS_TOLERANCE_PX = 8;

export interface LongPressCallbacks {
    /** The finger rested long enough: start the drag now. */
    onArm: () => void;
    /** The press ended or turned into a scroll before arming. */
    onCancel?: () => void;
}

export class LongPressGate {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private origin: Position | undefined;
    private armed = false;

    constructor(
        private readonly delay: number,
        private readonly callbacks: LongPressCallbacks,
        private readonly tolerance = LONG_PRESS_TOLERANCE_PX
    ) {}

    get isPending(): boolean {
        return this.timer !== undefined;
    }

    get isArmed(): boolean {
        return this.armed;
    }

    /** A finger went down at `point`. */
    start(point: Position): void {
        this.clear();
        this.armed = false;
        this.origin = point;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.armed = true;
            this.callbacks.onArm();
        }, Math.max(0, this.delay));
    }

    /** The finger moved; cancels when it moved further than the tolerance before arming. Returns true when cancelled. */
    move(point: Position): boolean {
        if (!this.timer || !this.origin) {
            return false;
        }
        if (Math.hypot(point.x - this.origin.x, point.y - this.origin.y) > this.tolerance) {
            this.cancel();
            return true;
        }
        return false;
    }

    /** Finger lifted or the gesture was cancelled by the browser. */
    end(): void {
        const wasPending = this.timer !== undefined;
        this.clear();
        this.armed = false;
        if (wasPending) {
            this.callbacks.onCancel?.();
        }
    }

    cancel(): void {
        this.end();
    }

    /** Consumes the armed state (the drag has started). */
    consume(): boolean {
        const was = this.armed;
        this.armed = false;
        return was;
    }

    dispose(): void {
        this.clear();
        this.armed = false;
    }

    private clear(): void {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.origin = undefined;
    }
}

/** Short vibration where the browser supports it (Android Chrome); silently nothing elsewhere. */
export function haptic(pattern: number | number[] = 12): boolean {
    try {
        const nav =
            typeof navigator !== "undefined"
                ? (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean })
                : undefined;
        return typeof nav?.vibrate === "function" ? nav.vibrate(pattern) : false;
    } catch {
        return false;
    }
}
