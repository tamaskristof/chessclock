interface SentinelLike { release(): Promise<void>; }
interface NavigatorWithWakeLock { wakeLock?: { request(type: "screen"): Promise<SentinelLike> }; }

let sentinel: SentinelLike | null = null;

export async function acquireWakeLock(): Promise<void> {
  const nav = navigator as unknown as NavigatorWithWakeLock;
  if (!nav.wakeLock || sentinel) return;
  try {
    sentinel = await nav.wakeLock.request("screen");
  } catch {
    sentinel = null;
  }
}

export async function releaseWakeLock(): Promise<void> {
  const s = sentinel;
  sentinel = null;
  if (s) {
    try { await s.release(); } catch { /* already released */ }
  }
}
