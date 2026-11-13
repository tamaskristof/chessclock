import { AMBIGUITY_RATIO } from "./vision";

export type SignalLevel = 0 | 1 | 2 | 3 | 4 | 5;

/** How clearly the live frame matches one captured position: 0 (no match) to 5 (clear). */
export function signalLevel(dLeft: number, dRight: number): SignalLevel {
  const far = Math.max(dLeft, dRight);
  if (!(far > 0)) return 0;
  const gap = 1 - Math.min(dLeft, dRight) / far; // 0 = equidistant, 1 = identical to one reference
  if (gap < 1 - AMBIGUITY_RATIO) return 0;
  return Math.max(1, Math.min(5, Math.round(gap * 5.5))) as SignalLevel;
}

export function signalLabel(level: SignalLevel): string {
  return level >= 3 ? "Signal clear" : level >= 1 ? "Signal weak" : "No signal";
}
