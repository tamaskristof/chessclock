let ctx: AudioContext | null = null;

/** Must be called from a user-gesture handler (iOS). Safe to call repeatedly. */
export function unlockAudio(): void {
  if (!ctx) {
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
}

export function beep(frequencyHz: number, durationMs: number, volume = 0.2): void {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const t1 = t0 + durationMs / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = frequencyHz;
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t1);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t1);
}

export function vibrate(pattern: number | number[]): void {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}

export function switchClick(): void { beep(1500, 25, 0.08); }
export function lowTimeAlert(): void { beep(880, 150); vibrate(200); }
export function flagAlert(): void { beep(440, 900, 0.3); vibrate([300, 100, 300, 100, 300]); }
