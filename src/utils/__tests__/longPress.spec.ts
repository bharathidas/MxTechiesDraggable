import { LongPressGate, haptic } from "../longPress";

describe("touch long-press gate", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("arms after the delay when the finger rests", () => {
        const onArm = jest.fn();
        const gate = new LongPressGate(300, { onArm });
        gate.start({ x: 10, y: 10 });
        expect(gate.isPending).toBe(true);
        jest.advanceTimersByTime(299);
        expect(onArm).not.toHaveBeenCalled();
        gate.move({ x: 14, y: 13 }); // within the tolerance
        jest.advanceTimersByTime(1);
        expect(onArm).toHaveBeenCalledTimes(1);
        expect(gate.consume()).toBe(true);
        expect(gate.consume()).toBe(false);
    });

    it("cancels when the finger moves like a scroll or lifts early", () => {
        const onArm = jest.fn();
        const onCancel = jest.fn();
        const gate = new LongPressGate(300, { onArm, onCancel });
        gate.start({ x: 0, y: 0 });
        expect(gate.move({ x: 0, y: 20 })).toBe(true);
        jest.advanceTimersByTime(500);
        expect(onArm).not.toHaveBeenCalled();
        expect(onCancel).toHaveBeenCalledTimes(1);

        gate.start({ x: 0, y: 0 });
        gate.end();
        jest.advanceTimersByTime(500);
        expect(onArm).not.toHaveBeenCalled();
        expect(onCancel).toHaveBeenCalledTimes(2);
        expect(gate.move({ x: 50, y: 50 })).toBe(false);
    });

    it("disposes without firing", () => {
        const onArm = jest.fn();
        const gate = new LongPressGate(100, { onArm });
        gate.start({ x: 0, y: 0 });
        gate.dispose();
        jest.advanceTimersByTime(200);
        expect(onArm).not.toHaveBeenCalled();
        expect(gate.isArmed).toBe(false);
    });

    it("vibrates only where the browser supports it", () => {
        const nav = navigator as Navigator & { vibrate?: unknown };
        const original = nav.vibrate;
        Object.defineProperty(nav, "vibrate", { value: undefined, configurable: true });
        expect(haptic()).toBe(false);
        const vibrate = jest.fn(() => true);
        Object.defineProperty(nav, "vibrate", { value: vibrate, configurable: true });
        expect(haptic(20)).toBe(true);
        expect(vibrate).toHaveBeenCalledWith(20);
        Object.defineProperty(nav, "vibrate", { value: original, configurable: true });
    });
});
