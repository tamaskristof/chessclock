export type Side = "left" | "right";
export type ClockStatus = "idle" | "running" | "paused" | "flagged";
export interface TimeControl { baseMs: number; incrementMs: number; }
export interface ClockState {
  status: ClockStatus;
  /** Remaining time per side as of `lastTick` (for the active side) / exact (for the other). */
  remainingMs: Record<Side, number>;
  active: Side | null;
  lastTick: number | null;
  flagged: Side | null;
  lowTimeWarned: Record<Side, boolean>;
}
export type ClockEvent = { type: "lowTime"; side: Side } | { type: "flag"; side: Side };

export const LOW_TIME_MS = 10_000;
export const SIDES: readonly Side[] = ["left", "right"];

export function other(side: Side): Side { return side === "left" ? "right" : "left"; }
/** Board side pressed down -> that player finished their move -> the other clock runs. */
export function boardToActive(boardDown: Side): Side { return other(boardDown); }

function withSide<T>(r: Record<Side, T>, side: Side, value: T): Record<Side, T> {
  const n = { ...r };
  n[side] = value;
  return n;
}

export function createClock(tc: TimeControl): ClockState {
  return {
    status: "idle",
    remainingMs: { left: tc.baseMs, right: tc.baseMs },
    active: null,
    lastTick: null,
    flagged: null,
    lowTimeWarned: { left: false, right: false },
  };
}

export function currentRemaining(s: ClockState, now: number): Record<Side, number> {
  if (s.status !== "running" || s.active === null || s.lastTick === null) return { ...s.remainingMs };
  const elapsed = Math.max(0, now - s.lastTick);
  return withSide(s.remainingMs, s.active, Math.max(0, s.remainingMs[s.active] - elapsed));
}

export function start(s: ClockState, active: Side, now: number): ClockState {
  if (s.status !== "idle") return s;
  return { ...s, status: "running", active, lastTick: now };
}

export function tick(s: ClockState, now: number): ClockState {
  if (s.status !== "running" || s.active === null) return s;
  const a = s.active;
  const live = currentRemaining(s, now);
  if (live[a] <= 0) return { ...s, status: "flagged", flagged: a, remainingMs: live, lastTick: now };
  if (live[a] < LOW_TIME_MS && !s.lowTimeWarned[a]) {
    return { ...s, lowTimeWarned: withSide(s.lowTimeWarned, a, true) };
  }
  return s;
}

/** Board changed at time `at` (may be backdated). Ends the move of the current active side. */
export function switchTo(s: ClockState, active: Side, at: number, tc: TimeControl): ClockState {
  if (s.status !== "running" || s.active === null || s.lastTick === null) return s;
  if (active === s.active) return s;
  const prev = s.active;
  const left = s.remainingMs[prev] - Math.max(0, at - s.lastTick);
  if (left <= 0) {
    return { ...s, status: "flagged", flagged: prev, remainingMs: withSide(s.remainingMs, prev, 0), lastTick: at };
  }
  return {
    ...s,
    active,
    lastTick: Math.max(at, s.lastTick),
    remainingMs: withSide(s.remainingMs, prev, left + tc.incrementMs),
  };
}

export function pause(s: ClockState, now: number): ClockState {
  if (s.status !== "running") return s;
  return { ...s, status: "paused", remainingMs: currentRemaining(s, now), lastTick: null };
}

export function resume(s: ClockState, active: Side, now: number): ClockState {
  if (s.status !== "paused") return s;
  return { ...s, status: "running", active, lastTick: now };
}

export function detectEvents(prev: ClockState, next: ClockState): ClockEvent[] {
  const events: ClockEvent[] = [];
  for (const side of SIDES) {
    if (!prev.lowTimeWarned[side] && next.lowTimeWarned[side]) events.push({ type: "lowTime", side });
  }
  if (prev.status !== "flagged" && next.status === "flagged" && next.flagged !== null) {
    events.push({ type: "flag", side: next.flagged });
  }
  return events;
}
