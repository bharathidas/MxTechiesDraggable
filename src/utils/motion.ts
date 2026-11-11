import { Limits, NO_LIMITS, Position, clampToLimits, snapToGrid } from "./geometry";

/** One pointer sample: translate offset and timestamp in milliseconds. */
export interface Sample {
    x: number;
    y: number;
    t: number;
}

export interface Velocity {
    vx: number;
    vy: number;
}

/** Only the last few samples matter for the release velocity. */
export const VELOCITY_WINDOW_MS = 100;
/** Exponential decay time constant of a throw, in ms (iOS-like scrolling feel). */
export const TIME_CONSTANT_MS = 325;
/** Releases slower than this (px/ms) are treated as a plain drop, not a throw. */
export const MIN_THROW_SPEED = 0.3;
/** Caps a single throw so a flick cannot send the content off into the distance. */
export const MAX_THROW_DISTANCE = 600;

/** Keeps the samples from the last window, so the buffer never grows during a long drag. */
export function pushSample(samples: Sample[], sample: Sample, windowMs = VELOCITY_WINDOW_MS): Sample[] {
    const next = [...samples, sample];
    const cutoff = sample.t - windowMs;
    const firstRecent = next.findIndex(s => s.t >= cutoff);
    // Keep one older sample so a slow final move still has a baseline.
    return next.slice(Math.max(0, firstRecent - 1));
}

/** Release velocity in px/ms from the samples within the window before the last sample. */
export function velocityFromSamples(samples: readonly Sample[], windowMs = VELOCITY_WINDOW_MS): Velocity {
    if (samples.length < 2) {
        return { vx: 0, vy: 0 };
    }
    const last = samples[samples.length - 1];
    let first = samples[0];
    for (const sample of samples) {
        if (last.t - sample.t <= windowMs) {
            first = sample;
            break;
        }
    }
    if (first === last) {
        first = samples[samples.length - 2];
    }
    const dt = last.t - first.t;
    if (dt <= 0) {
        return { vx: 0, vy: 0 };
    }
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

/** Distance travelled after `t` ms by a throw with initial speed `v` px/ms decaying exponentially. */
export function decayDistance(v: number, t: number, timeConstant = TIME_CONSTANT_MS): number {
    return v * timeConstant * (1 - Math.exp(-t / timeConstant));
}

export interface Throw {
    target: Position;
    duration: number;
    /** CSS easing that follows the decay curve exactly. */
    easing: string;
    /** True when bounds stopped the throw early. */
    hitBounds: boolean;
}

export interface ThrowOptions {
    limits?: Limits;
    gridX?: number;
    gridY?: number;
    timeConstant?: number;
}

/**
 * Projects where a throw comes to rest: the decay distance (v * timeConstant), capped,
 * clamped to the limits and rounded to the grid. Returns undefined for slow releases.
 */
export function projectThrow(start: Position, velocity: Velocity, options: ThrowOptions = {}): Throw | undefined {
    const timeConstant = options.timeConstant ?? TIME_CONSTANT_MS;
    const limits = options.limits ?? NO_LIMITS;
    const speed = Math.hypot(velocity.vx, velocity.vy);
    if (speed < MIN_THROW_SPEED) {
        return undefined;
    }
    let amplitude = speed * timeConstant;
    const scale = amplitude > MAX_THROW_DISTANCE ? MAX_THROW_DISTANCE / amplitude : 1;
    amplitude *= scale;

    const free: Position = {
        x: start.x + velocity.vx * timeConstant * scale,
        y: start.y + velocity.vy * timeConstant * scale
    };
    const clamped = clampToLimits(free, limits);
    const snapped = snapToGrid(clamped, options.gridX ?? 0, options.gridY ?? 0, limits);
    // Whole pixels, so the attributes written at the end match the drawn position.
    const target = { x: Math.round(snapped.x), y: Math.round(snapped.y) };
    const travelled = Math.hypot(target.x - start.x, target.y - start.y);
    if (travelled < 1) {
        return undefined;
    }
    const hitBounds = clamped.x !== free.x || clamped.y !== free.y;

    // Time until the decay has covered the travelled share of the full amplitude.
    const share = Math.min(travelled / amplitude, 0.995);
    const fullTime = timeConstant * Math.log(Math.max(amplitude, 1) / 0.5);
    const time = hitBounds ? -timeConstant * Math.log(1 - share) : fullTime;
    const duration = Math.round(clampNumber(time, 160, 1400));
    return { target, duration, easing: decayEasing(duration, timeConstant), hitBounds };
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function formatPoints(points: number[]): string {
    return `linear(${points.map(p => Number(p.toFixed(4))).join(", ")})`;
}

/** CSS linear() easing that follows an exponential decay over `duration` ms, normalised to end at 1. */
export function decayEasing(duration: number, timeConstant = TIME_CONSTANT_MS, steps = 20): string {
    const end = 1 - Math.exp(-duration / timeConstant);
    const points: number[] = [];
    for (let i = 0; i <= steps; i++) {
        const t = (duration * i) / steps;
        points.push(end > 0 ? (1 - Math.exp(-t / timeConstant)) / end : i / steps);
    }
    points[points.length - 1] = 1;
    return formatPoints(points);
}

export interface SpringOptions {
    stiffness?: number;
    damping?: number;
    mass?: number;
}

export interface SpringCurve {
    /** CSS linear() easing, overshoot included. */
    easing: string;
    /** Settle time in ms. */
    duration: number;
}

/** One semi-implicit Euler step of a damped spring pulling `x` towards 1. Exposed for tests. */
export function springStep(
    state: { x: number; v: number },
    dt: number,
    { stiffness = 170, damping = 18, mass = 1 }: SpringOptions = {}
): { x: number; v: number } {
    const force = -stiffness * (state.x - 1) - damping * state.v;
    const v = state.v + (force / mass) * dt;
    return { x: state.x + v * dt, v };
}

/**
 * Simulates a damped spring from 0 to 1 and returns it as a CSS linear() easing, so the
 * browser plays the settle on the compositor while react-draggable keeps owning the transform.
 */
export function springCurve(options: SpringOptions = {}): SpringCurve {
    const dt = 1 / 120;
    const sampleEvery = 2; // 60 points per second is plenty for linear()
    let state = { x: 0, v: 0 };
    const points = [0];
    let step = 0;
    const maxSteps = 240; // 2 s
    while (step < maxSteps) {
        state = springStep(state, dt, options);
        step++;
        if (step % sampleEvery === 0) {
            points.push(state.x);
        }
        if (Math.abs(1 - state.x) < 0.001 && Math.abs(state.v) < 0.01) {
            break;
        }
    }
    points[points.length - 1] = 1;
    if (points.length < 2) {
        points.push(1);
    }
    return { easing: formatPoints(points), duration: Math.round(step * dt * 1000) };
}

/** Tilt in degrees for a horizontal speed in px/ms: leans into the direction of travel, capped. */
export function tiltFor(vx: number, maxDegrees = 3): number {
    const tilt = vx * 4;
    return Math.round(clampNumber(tilt, -maxDegrees, maxDegrees) * 10) / 10;
}
