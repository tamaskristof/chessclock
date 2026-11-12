/** Formats remaining clock time with hundredths (floored): "S.cc", "M:SS.cc" or "H:MM:SS.cc". */
export function formatTime(ms: number): string {
  const v = Math.max(0, Math.floor(ms / 10));
  const cs = v % 100;
  const total = Math.floor(v / 100);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const frac = String(cs).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${frac}`;
  if (m > 0) return `${m}:${String(s).padStart(2, "0")}.${frac}`;
  return `${s}.${frac}`;
}
