import { describe, expect, it } from "vitest";
import {
  averageFeatures, classify, distance, FEATURE_LENGTH, FEATURE_SIZE, MIN_REF_SEPARATION, StateDebouncer, toFeature,
} from "./vision";

function img(f: (x: number, y: number) => number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(FEATURE_LENGTH * 4);
  for (let y = 0; y < FEATURE_SIZE; y++)
    for (let x = 0; x < FEATURE_SIZE; x++) {
      const i = (y * FEATURE_SIZE + x) * 4;
      const g = f(x, y);
      d[i] = g; d[i + 1] = g; d[i + 2] = g; d[i + 3] = 255;
    }
  return d;
}
const leftPx = (x: number, y: number) => (y > x ? 200 : 50);
const rightPx = (x: number, y: number) => (y > 31 - x ? 200 : 50);
const refs = { left: toFeature(img(leftPx)), right: toFeature(img(rightPx)) };

describe("features", () => {
  it("uniform image gives zeros", () => {
    const f = toFeature(img(() => 128));
    expect(Array.from(f).every((v) => v === 0)).toBe(true);
  });

  it("is z-score normalised", () => {
    const f = toFeature(img(leftPx));
    let sum = 0;
    let sq = 0;
    for (const v of f) { sum += v; sq += v * v; }
    expect(Math.abs(sum / f.length)).toBeLessThan(1e-5);
    expect(Math.sqrt(sq / f.length)).toBeCloseTo(1, 4);
  });

  it("is brightness/contrast invariant", () => {
    const a = toFeature(img(leftPx));
    const b = toFeature(img((x, y) => leftPx(x, y) * 0.5 + 20));
    expect(distance(a, b)).toBeLessThan(1e-5);
  });

  it("distance basics", () => {
    expect(distance(refs.left, refs.left)).toBe(0);
    expect(() => distance(new Float32Array(3), new Float32Array(4))).toThrow("Feature length mismatch");
  });

  it("averageFeatures", () => {
    const avg = averageFeatures([refs.left, refs.left]);
    for (let i = 0; i < avg.length; i++) expect(Math.abs(avg[i] - refs.left[i])).toBeLessThan(1e-6);
    expect(() => averageFeatures([])).toThrow("No features to average");
  });

  it("references are separable", () => {
    expect(distance(refs.left, refs.right)).toBeGreaterThan(MIN_REF_SEPARATION);
  });

  it("classifies noisy images", () => {
    const noise = (x: number, y: number) => ((x * 7 + y * 13) % 11) - 5;
    expect(classify(toFeature(img((x, y) => leftPx(x, y) + noise(x, y))), refs).candidate).toBe("left");
    expect(classify(toFeature(img((x, y) => rightPx(x, y) + noise(x, y))), refs).candidate).toBe("right");
  });

  it("ambiguous blend gives null", () => {
    const f = toFeature(img((x, y) => (leftPx(x, y) + rightPx(x, y)) / 2));
    expect(classify(f, refs).candidate).toBeNull();
  });

  it("all-zero feature gives null", () => {
    const z = () => new Float32Array(FEATURE_LENGTH);
    expect(classify(z(), { left: z(), right: z() }).candidate).toBeNull();
  });
});

describe("StateDebouncer", () => {
  function confirmedLeft(): StateDebouncer {
    const d = new StateDebouncer();
    d.push("left", 0);
    d.push("left", 100);
    d.push("left", 200);
    return d;
  }

  it("initial confirmation is backdated", () => {
    const d = new StateDebouncer();
    expect(d.push("left", 0).changedAt).toBeNull();
    expect(d.push("left", 100).changedAt).toBeNull();
    expect(d.push("left", 200)).toEqual({ state: "left", changedAt: 0 });
  });

  it("nulls do not reset", () => {
    const d = confirmedLeft();
    expect(d.push("right", 1000).changedAt).toBeNull();
    expect(d.push(null, 1100).changedAt).toBeNull();
    expect(d.push("right", 1200).changedAt).toBeNull();
    expect(d.push("right", 1300)).toEqual({ state: "right", changedAt: 1000 });
  });

  it("stable candidate resets pending", () => {
    const d = confirmedLeft();
    d.push("right", 1000);
    d.push("left", 1100);
    d.push("right", 1200);
    d.push("right", 1300);
    expect(d.push("right", 1400).changedAt).toBe(1200);
  });

  it("stale pending restarts", () => {
    const d = confirmedLeft();
    expect(d.push("right", 1000).changedAt).toBeNull();
    expect(d.push("right", 2500).changedAt).toBeNull();
    expect(d.push("right", 2600).changedAt).toBeNull();
    expect(d.push("right", 2700)).toEqual({ state: "right", changedAt: 2500 });
  });

  it("same as stable", () => {
    const d = confirmedLeft();
    expect(d.push("left", 300)).toEqual({ state: "left", changedAt: null });
  });

  it("reset()", () => {
    const d = confirmedLeft();
    d.reset();
    expect(d.state).toBeNull();
    d.push("left", 1000);
    d.push("left", 1100);
    expect(d.push("left", 1200).changedAt).toBe(1000);
  });
});
