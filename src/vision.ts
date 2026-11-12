export const FEATURE_SIZE = 32;
export const FEATURE_LENGTH = FEATURE_SIZE * FEATURE_SIZE;
export const AMBIGUITY_RATIO = 0.8;
export const MIN_REF_SEPARATION = 0.15;
export const DEBOUNCE_FRAMES = 3;
export const MAX_PENDING_MS = 1000;

export type BoardState = "left" | "right";
export type Feature = Float32Array;
export interface References { left: Feature; right: Feature; }
export interface Classification { candidate: BoardState | null; dLeft: number; dRight: number; }

/** RGBA bytes -> grayscale, z-score normalised (mean 0, std 1). Uniform image -> all zeros. */
export function toFeature(rgba: ArrayLike<number>): Feature {
  const n = Math.floor(rgba.length / 4);
  const out = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const g = 0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2];
    out[i] = g;
    sum += g;
  }
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    out[i] -= mean;
    sq += out[i] * out[i];
  }
  const std = Math.sqrt(sq / n);
  if (std < 1e-3) {
    out.fill(0);
    return out;
  }
  for (let i = 0; i < n; i++) out[i] /= std;
  return out;
}

/** Mean absolute difference. Throws Error("Feature length mismatch") if lengths differ. */
export function distance(a: Feature, b: Feature): number {
  if (a.length !== b.length) throw new Error("Feature length mismatch");
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/** Element-wise mean. Throws Error("No features to average") on empty input. */
export function averageFeatures(features: Feature[]): Feature {
  if (features.length === 0) throw new Error("No features to average");
  const out = new Float32Array(features[0].length);
  for (const f of features) for (let i = 0; i < out.length; i++) out[i] += f[i];
  for (let i = 0; i < out.length; i++) out[i] /= features.length;
  return out;
}

export function classify(f: Feature, refs: References, ratio = AMBIGUITY_RATIO): Classification {
  const dLeft = distance(f, refs.left);
  const dRight = distance(f, refs.right);
  const lo = Math.min(dLeft, dRight);
  const hi = Math.max(dLeft, dRight);
  if (hi === 0 || lo / hi > ratio) return { candidate: null, dLeft, dRight };
  return { candidate: dLeft < dRight ? "left" : "right", dLeft, dRight };
}

export interface DebounceResult { state: BoardState | null; changedAt: number | null; }

/**
 * Confirms a new board state after `required` matching candidates.
 * null candidates (ambiguous frames) neither count nor reset.
 * A candidate equal to the stable state resets the pending one.
 * A pending state older than maxPendingMs restarts at the current frame.
 * changedAt = timestamp of the FIRST frame of the confirmed state (backdating).
 */
export class StateDebouncer {
  private stable: BoardState | null = null;
  private pending: BoardState | null = null;
  private pendingSince = 0;
  private count = 0;

  constructor(
    private readonly required: number = DEBOUNCE_FRAMES,
    private readonly maxPendingMs: number = MAX_PENDING_MS,
  ) {}

  get state(): BoardState | null { return this.stable; }

  reset(): void {
    this.stable = null;
    this.clearPending();
  }

  push(candidate: BoardState | null, t: number): DebounceResult {
    if (candidate === null) return { state: this.stable, changedAt: null };
    if (candidate === this.stable) {
      this.clearPending();
      return { state: this.stable, changedAt: null };
    }
    if (candidate !== this.pending || t - this.pendingSince > this.maxPendingMs) {
      this.pending = candidate;
      this.pendingSince = t;
      this.count = 1;
    } else {
      this.count += 1;
    }
    if (this.count >= this.required) {
      const changedAt = this.pendingSince;
      this.stable = candidate;
      this.clearPending();
      return { state: this.stable, changedAt };
    }
    return { state: this.stable, changedAt: null };
  }

  private clearPending(): void {
    this.pending = null;
    this.pendingSince = 0;
    this.count = 0;
  }
}
