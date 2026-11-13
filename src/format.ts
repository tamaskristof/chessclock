/** Hundredths appear only below this many milliseconds. Matches the clock's low-time threshold. */
export const HUNDREDTHS_BELOW_MS = 20_000;

export interface ClockText {
  /** "H:MM:SS", "M:SS", or whole seconds under 20 s. */
  main: string;
  /** ".cc" under 20 s, otherwise null. */
  frac: string | null;
}

/** Splits remaining time into display parts. Floors: the clock never shows time the player does not have. */
export function formatClock(ms: number): ClockText {
  const t = Math.max(0, ms);
  if (t < HUNDREDTHS_BELOW_MS) {
    const v = Math.floor(t / 10);
    return { main: String(Math.floor(v / 100)), frac: `.${String(v % 100).padStart(2, "0")}` };
  }
  const total = Math.floor(t / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  if (h > 0) return { main: `${h}:${String(m).padStart(2, "0")}:${s}`, frac: null };
  return { main: `${m}:${s}`, frac: null };
}

/** Rough text width in em (digits 0.5, separators 0.26, hundredths at half size) to fit digits to their half. */
export function clockWidthEm(text: ClockText): number {
  const w = (s: string): number => [...s].reduce((a, c) => a + (c >= "0" && c <= "9" ? 0.5 : 0.26), 0);
  return w(text.main) + (text.frac ? w(text.frac) / 2 : 0);
}

export function formatTime(ms: number): string {
  const { main, frac } = formatClock(ms);
  return main + (frac ?? "");
}
