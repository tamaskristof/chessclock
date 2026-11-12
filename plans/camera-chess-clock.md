# Plan: Camera Chess Clock (PWA)

Discovery: `plans/discovery/camera-chess-clock.md`

## Context

**Goal.** An offline-capable PWA that turns a phone into a chess clock. The back camera watches a wooden board resting on a wedge (a seesaw). A player finishes a move by pressing their side of the board down. The app detects which side is down and runs the two clocks: fixed time plus optional Fischer increment, with sound and vibration alerts.

**Non-goals (do NOT implement):** native wrappers, marker/sticker detection, ML, Delay/Bronstein modes, move counting, game history, backend, any UI framework, any dependency not listed in Step 2, motion gating, `requestVideoFrameCallback`, Web Workers.

**Changes from the discovery doc (decided):**
- *Motion gating is dropped.* Classification costs only two 1024-element distance computations per sample. The real cost is the camera and the canvas readback, which gating does not reduce.
- *The camera is not stopped on pause.* It keeps running, but sampling drops from 10 Hz (running) to 4 Hz (idle, paused or flagged). The camera is stopped only when the page is hidden. This keeps the board state known when the game resumes.

**Architecture.** Plain TypeScript and Vite, with `vite-plugin-pwa` (generateSW) for offline use. There is one HTML page with three screens (`start`, `setup`, `game`), toggled via the `hidden` attribute.
- Pure, DOM-free logic modules (unit tested with Vitest in Node): `format.ts`, `clock.ts`, `vision.ts`, `geometry.ts`, `storage.ts`.
- Thin browser modules (not unit tested): `camera.ts`, `alerts.ts`, `wakelock.ts`.
- The single controller `main.ts` wires the DOM, the camera sampling loop, the clock and rendering.

**Detection pipeline.**
1. The camera runs at 320×240@15fps (ideal constraints).
2. Every 100 ms (running) or 250 ms (otherwise), the ROI of the video is drawn into a 32×32 canvas.
3. The pixels are converted to grayscale and z-score normalised (mean 0, std 1), which makes the feature invariant to brightness and contrast.
4. The feature is compared to the two calibrated references by mean absolute difference.
5. A frame counts as ambiguous (`null`) if `min/max > 0.8`.
6. A 3-frame debouncer confirms a change. The change is timestamped at the **first** frame of the new state, so the switch is backdated.

**Board → clock mapping.** Board state `"left"` means the left side of the board is pressed down, i.e. the left player just finished a move, so the **right** clock runs: `boardToActive(board) = other(board)`. Left and right are as seen in the (unmirrored) camera image, and on screen the left clock is on the left.

**Repository state.** The repo is empty. Branch `master` has no commits, and only `plans/` exists. Node v24.15.0 is installed locally.

### Files created by this plan
```
.gitignore
package.json / package-lock.json
tsconfig.json
vitest.config.ts
vite.config.ts
index.html
public/favicon.svg
public/pwa-192.png, public/pwa-512.png, public/apple-touch-icon.png   (generated)
scripts/gen-icons.mjs
src/format.ts        src/format.test.ts
src/clock.ts         src/clock.test.ts
src/vision.ts        src/vision.test.ts
src/geometry.ts      src/geometry.test.ts
src/storage.ts       src/storage.test.ts
src/alerts.ts
src/wakelock.ts
src/camera.ts
src/styles.css
src/main.ts
.github/workflows/deploy.yml
README.md
```

## Gotchas / invariants (read before starting)

1. **Timing:** use only `performance.now()` for game timing. Never use `Date.now()` and never count frames.
2. **Pure modules:** `format.ts`, `clock.ts`, `vision.ts`, `geometry.ts` and `storage.ts` must NOT reference `window`, `document`, `navigator` or `localStorage`. Tests run in the Node environment.
3. **Clock immutability:** all clock functions return a new `ClockState` object, or the *same* object when nothing changes. Tests rely on `toBe` identity for the no-op cases.
4. **Base path:** Vite `base` is `"/chessclock/"`, matching the GitHub repo name `chessclock`. The dev URL is therefore `http://localhost:5173/chessclock/`.
5. **Video element:** do NOT mirror it (no `scaleX(-1)`). It needs the attributes `playsinline muted autoplay`, otherwise iOS will not play it inline.
6. **Video display:** use `object-fit: contain`. The ROI math in `geometry.ts` assumes contain; cover would break it.
7. **Audio:** iOS only allows audio after a user gesture. `unlockAudio()` must be called inside the click handlers of "Start camera" and "Start".
8. **Hiding the video:** hide it with `opacity: 0`, never with `display: none` (iOS may stop updating hidden videos).
9. **Unchecked index access:** `noUncheckedIndexedAccess` stays off. Do not add tsconfig options beyond those listed.
10. **Running tests:** run them with `vitest run` (never watch mode).
11. **Commits:** after each step passes its verification, commit with message `step N: <step title>`.

---

## Implementation Steps

### Step 1 — Initialise branches and .gitignore
- Run: `git branch -m main`
- Create `.gitignore`:
  ```
  node_modules/
  dist/
  *.log
  .DS_Store
  ```
- Run: `git add .gitignore plans && git commit -m "chore: initial commit with plans"`
- Run: `git checkout -b feature/camera-chess-clock`
- **Verify:** `git branch --show-current` → `feature/camera-chess-clock`; `git log --oneline` shows 1 commit.

### Step 2 — package.json and dependencies
- Create `package.json`:
  ```json
  {
    "name": "chessclock",
    "private": true,
    "version": "0.1.0",
    "type": "module",
    "scripts": {
      "dev": "vite",
      "build": "tsc --noEmit && vite build",
      "preview": "vite preview",
      "test": "vitest run",
      "typecheck": "tsc --noEmit",
      "check": "npm run typecheck && npm run test",
      "icons": "node scripts/gen-icons.mjs"
    }
  }
  ```
- Run: `npm install -D vite@^8 vite-plugin-pwa@^1.3 vitest@^5 typescript@~5.9`
- **Verify:** `npm ls vite vite-plugin-pwa vitest typescript` lists all four with no `UNMET PEER` or `invalid` lines. (If a peer conflict occurs → see "If blocked".)

### Step 3 — tsconfig.json and vitest.config.ts
- Create `tsconfig.json`:
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "bundler",
      "lib": ["ES2022", "DOM", "DOM.Iterable"],
      "types": ["vite/client"],
      "strict": true,
      "noEmit": true,
      "skipLibCheck": true,
      "isolatedModules": true,
      "noUnusedLocals": true,
      "noUnusedParameters": true
    },
    "include": ["src", "vite.config.ts", "vitest.config.ts"]
  }
  ```
- Create `vitest.config.ts` (a separate file, so that tests do not load the PWA plugin):
  ```ts
  import { defineConfig } from "vitest/config";

  export default defineConfig({
    test: { environment: "node", include: ["src/**/*.test.ts"] },
  });
  ```
- **Verify:** `npx tsc --version` prints `Version 5.9.x`. (`npm run typecheck` may complain that there are no inputs until Step 4. That is expected.)

### Step 4 — src/format.ts
Create `src/format.ts`:
```ts
/** Formats remaining clock time. <10 s: "S.d" (tenths, floored). Otherwise ceil to seconds: "M:SS" or "H:MM:SS". */
export function formatTime(ms: number): string {
  const v = Math.max(0, ms);
  if (v < 10_000) return (Math.floor(v / 100) / 10).toFixed(1);
  const total = Math.ceil(v / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
```
**Verify:** `npm run typecheck` exits 0.

### Step 5 — src/format.test.ts
Use `import { describe, expect, it } from "vitest";` and a table test (`it.each`) asserting `formatTime(input) === expected`:

| input | expected |
|---|---|
| 300000 | "5:00" |
| 299001 | "5:00" |
| 299000 | "4:59" |
| 65000 | "1:05" |
| 10000 | "0:10" |
| 9999 | "9.9" |
| 9900 | "9.9" |
| 9899 | "9.8" |
| 50 | "0.0" |
| 0 | "0.0" |
| -5 | "0.0" |
| 3599001 | "1:00:00" |
| 3600000 | "1:00:00" |
| 5400000 | "1:30:00" |

**Verify:** `npx vitest run src/format.test.ts` → all pass.

### Step 6 — src/clock.ts
Create `src/clock.ts` with exactly this API:
```ts
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
```
**Verify:** `npm run typecheck` exits 0.

### Step 7 — src/clock.test.ts
Use `const TC = { baseMs: 60_000, incrementMs: 2_000 };` and `const TC0 = { baseMs: 60_000, incrementMs: 0 };`. Test cases:
1. **createClock:** `createClock(TC)` has status `"idle"`, remainingMs `{left: 60000, right: 60000}`, active `null`, lastTick `null`, flagged `null`, lowTimeWarned both `false`.
2. **start:** `start(createClock(TC), "left", 1000)` gives status `"running"`, active `"left"`, lastTick `1000`. Calling `start` again on that running state returns the same object (`toBe`).
3. **currentRemaining:** after `start(..., "left", 1000)`, `currentRemaining(s, 4000)` equals `{left: 57000, right: 60000}`, and `s.remainingMs.left` is still `60000`.
4. **switchTo with increment:** with `s = start(createClock(TC), "left", 1000)`, `n = switchTo(s, "right", 11000, TC)` gives `n.remainingMs.left === 52000`, `n.active === "right"`, `n.lastTick === 11000`, and `currentRemaining(n, 12000).right === 59000`.
5. **switchTo same side:** `switchTo(s, "left", 5000, TC)` returns `s` (`toBe`).
6. **Backdated before lastTick:** `s = start(createClock(TC), "left", 1000)`, then `switchTo(s, "right", 500, TC)` gives `remainingMs.left === 62000` and `lastTick === 1000`.
7. **switchTo when paused:** `p = pause(start(createClock(TC), "left", 0), 1000)`, so `switchTo(p, "right", 2000, TC)` returns `p` (`toBe`).
8. **tick flags:** `s = start(createClock(TC0), "left", 0)`, then `n = tick(s, 60000)` gives status `"flagged"`, flagged `"left"`, `remainingMs.left === 0`. `detectEvents(s, n)` equals `[{ type: "flag", side: "left" }]`.
9. **tick low-time:** `s = start(createClock(TC0), "left", 0)`, then `n = tick(s, 50001)` gives `n.lowTimeWarned.left === true`, and `detectEvents(s, n)` equals `[{ type: "lowTime", side: "left" }]`. `tick(n, 50100)` returns `n` (`toBe`).
10. **switchTo flags:** `s = start(createClock(TC), "left", 0)`, then `switchTo(s, "right", 61000, TC)` gives status `"flagged"`, flagged `"left"`, `remainingMs.left === 0`.
11. **pause/resume:** `s = start(createClock(TC0), "left", 0)`, then `p = pause(s, 5000)` gives status `"paused"`, `remainingMs.left === 55000`, `lastTick === null`. `currentRemaining(p, 99999).left === 55000`. `r = resume(p, "right", 10000)` gives status `"running"`, active `"right"`, lastTick `10000`.
12. **boardToActive:** `boardToActive("left") === "right"` and `boardToActive("right") === "left"`.

**Verify:** `npx vitest run src/clock.test.ts` → 12 tests pass.

### Step 8 — src/vision.ts (features and classification)
Create `src/vision.ts`:
```ts
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
```
**Verify:** `npm run typecheck` exits 0.

### Step 9 — src/vision.test.ts (features and classification)
Test helper (put it in the test file):
```ts
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
```
Test cases:
1. `toFeature(img(() => 128))`: every element is `0`.
2. `toFeature(img(leftPx))`: the mean of the elements has `Math.abs(mean) < 1e-5`, and `Math.sqrt(mean of squares)` passes `toBeCloseTo(1, 4)`.
3. Brightness/contrast invariance: `distance(toFeature(img(leftPx)), toFeature(img((x, y) => leftPx(x, y) * 0.5 + 20))) < 1e-5`.
4. `distance(refs.left, refs.left) === 0`. `distance(new Float32Array(3), new Float32Array(4))` throws `"Feature length mismatch"`.
5. `averageFeatures([refs.left, refs.left])`: every element is within `1e-6` of `refs.left`. `averageFeatures([])` throws `"No features to average"`.
6. `distance(refs.left, refs.right) > MIN_REF_SEPARATION`.
7. A noisy left image `img((x, y) => leftPx(x, y) + ((x * 7 + y * 13) % 11) - 5)` gives `classify(..., refs).candidate === "left"`. The same noise on `rightPx` gives `"right"`.
8. Ambiguous: the mirror-symmetric blend `img((x, y) => (leftPx(x, y) + rightPx(x, y)) / 2)` gives `candidate === null`.
9. All-zero feature: `classify(new Float32Array(FEATURE_LENGTH), { left: new Float32Array(FEATURE_LENGTH), right: new Float32Array(FEATURE_LENGTH) }).candidate === null`.

**Verify:** `npx vitest run src/vision.test.ts` → all pass.

### Step 10 — StateDebouncer in src/vision.ts
Append to `src/vision.ts`:
```ts
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
```
**Verify:** `npm run typecheck` exits 0.

### Step 11 — Debouncer tests in src/vision.test.ts
Add a `describe("StateDebouncer")` block. Each case uses `new StateDebouncer()` (defaults 3 / 1000):
1. **Initial confirmation:** pushes `("left",0)` and `("left",100)` return `changedAt: null`. `("left",200)` returns `{ state: "left", changedAt: 0 }`.
2. **Nulls do not reset:** confirm `"left"` (pushes at 0, 100, 200). Then `("right",1000)`, `(null,1100)` and `("right",1200)` return `changedAt: null`, and `("right",1300)` returns `{ state: "right", changedAt: 1000 }`.
3. **Stable candidate resets pending:** confirm `"left"`. Then push `("right",1000)` and `("left",1100)`, then `("right",1200)`, `("right",1300)` and `("right",1400)`. The last push returns `changedAt: 1200`.
4. **Stale pending restarts:** confirm `"left"`. Then `("right",1000)`, `("right",2500)` and `("right",2600)` return `changedAt: null`, and `("right",2700)` returns `{ state: "right", changedAt: 2500 }`.
5. **Same as stable:** after confirming `"left"`, `("left",300)` returns `{ state: "left", changedAt: null }`.
6. **reset():** confirm `"left"`, then `reset()`. `d.state === null`, and three more `"left"` pushes at 1000, 1100 and 1200 return `changedAt: 1000` on the third.

**Verify:** `npx vitest run src/vision.test.ts` → all pass.

### Step 12 — src/geometry.ts
Create `src/geometry.ts`:
```ts
export interface Rect { x: number; y: number; w: number; h: number; }
export interface Point { x: number; y: number; }

export const MIN_ROI_SIZE = 0.05;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Screen rect occupied by a video of size vw×vh shown with object-fit: contain in a cw×ch box. */
export function containRect(cw: number, ch: number, vw: number, vh: number): Rect {
  const s = Math.min(cw / vw, ch / vh);
  const w = vw * s;
  const h = vh * s;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

/** Screen point -> normalised video coordinates (0..1, clamped). */
export function toNormalizedPoint(px: number, py: number, content: Rect): Point {
  return { x: clamp01((px - content.x) / content.w), y: clamp01((py - content.y) / content.h) };
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Normalised ROI -> screen rect. */
export function normToScreen(roi: Rect, content: Rect): Rect {
  return { x: content.x + roi.x * content.w, y: content.y + roi.y * content.h, w: roi.w * content.w, h: roi.h * content.h };
}

export function isValidRoi(r: Rect): boolean {
  return r.w >= MIN_ROI_SIZE && r.h >= MIN_ROI_SIZE && r.x >= 0 && r.y >= 0 && r.x + r.w <= 1 && r.y + r.h <= 1;
}
```
**Verify:** `npm run typecheck` exits 0.

### Step 13 — src/geometry.test.ts
Use `toBeCloseTo(value, 2)` for all floats:
1. `containRect(1000, 500, 320, 240)` → `{ x: 166.67, y: 0, w: 666.67, h: 500 }`.
2. `containRect(500, 1000, 320, 240)` → `{ x: 0, y: 312.5, w: 500, h: 375 }`.
3. With `c = containRect(1000, 500, 320, 240)`: `toNormalizedPoint(166.67, 0, c)` → `{0, 0}`, `toNormalizedPoint(500, 250, c)` → `{0.5, 0.5}`, and `toNormalizedPoint(1000, 600, c)` → `{1, 1}` (clamped).
4. `rectFromPoints({x: 0.5, y: 0.6}, {x: 0.2, y: 0.1})` → `{ x: 0.2, y: 0.1, w: 0.3, h: 0.5 }`.
5. `normToScreen({x: 0.5, y: 0.5, w: 0.25, h: 0.5}, c)` → `{ x: 500, y: 250, w: 166.67, h: 250 }`.
6. `isValidRoi({x: 0, y: 0, w: 0.04, h: 0.5})` → `false`. `isValidRoi({x: 0.1, y: 0.1, w: 0.3, h: 0.3})` → `true`. `isValidRoi({x: 0.9, y: 0, w: 0.2, h: 0.5})` → `false`.

**Verify:** `npx vitest run src/geometry.test.ts` → all pass.

### Step 14 — src/storage.ts
Create `src/storage.ts`:
```ts
import type { TimeControl } from "./clock";
import { isValidRoi, type Rect } from "./geometry";
import { FEATURE_LENGTH } from "./vision";

export const STORAGE_KEY = "chessclock.v1";

export interface Settings {
  timeControl: TimeControl;
  roi: Rect | null;
  refLeft: number[] | null;
  refRight: number[] | null;
  showCamera: boolean;
}

export function defaultSettings(): Settings {
  return { timeControl: { baseMs: 300_000, incrementMs: 0 }, roi: null, refLeft: null, refRight: null, showCamera: true };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseTimeControl(v: unknown): TimeControl | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isNum(o.baseMs) || !isNum(o.incrementMs) || o.baseMs <= 0 || o.incrementMs < 0) return null;
  return { baseMs: o.baseMs, incrementMs: o.incrementMs };
}

function parseRoi(v: unknown): Rect | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isNum(o.x) || !isNum(o.y) || !isNum(o.w) || !isNum(o.h)) return null;
  const r = { x: o.x, y: o.y, w: o.w, h: o.h };
  return isValidRoi(r) ? r : null;
}

function parseRef(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length !== FEATURE_LENGTH || !v.every(isNum)) return null;
  return v as number[];
}

export function loadSettings(storage: Pick<Storage, "getItem">): Settings {
  const d = defaultSettings();
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return d;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return d;
  }
  if (typeof data !== "object" || data === null) return d;
  const o = data as Record<string, unknown>;
  return {
    timeControl: parseTimeControl(o.timeControl) ?? d.timeControl,
    roi: parseRoi(o.roi),
    refLeft: parseRef(o.refLeft),
    refRight: parseRef(o.refRight),
    showCamera: typeof o.showCamera === "boolean" ? o.showCamera : d.showCamera,
  };
}

export function saveSettings(storage: Pick<Storage, "setItem">, s: Settings): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(s));
}
```
**Verify:** `npm run typecheck` exits 0.

### Step 15 — src/storage.test.ts
Helper:
```ts
function fakeStorage(init?: string) {
  const m = new Map<string, string>();
  if (init !== undefined) m.set(STORAGE_KEY, init);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}
```
Test cases:
1. `loadSettings(fakeStorage())` `toEqual(defaultSettings())`.
2. `loadSettings(fakeStorage("{"))` `toEqual(defaultSettings())`.
3. **Round trip:** build `s` with `timeControl {baseMs: 180000, incrementMs: 2000}`, `roi {x: 0.1, y: 0.2, w: 0.5, h: 0.3}`, `refLeft = Array(1024).fill(0.5)`, `refRight = Array(1024).fill(-0.5)` and `showCamera false`. Save it to a storage, then load it from the same storage; the result `toEqual(s)`.
4. **Partial invalid:** `fakeStorage(JSON.stringify({ timeControl: { baseMs: -1, incrementMs: 0 }, showCamera: false, refLeft: [1, 2, 3] }))` loads with `timeControl` equal to `{ baseMs: 300000, incrementMs: 0 }`, `showCamera === false`, `refLeft === null` and `roi === null`.
5. **Tiny ROI rejected:** `{ roi: { x: 0, y: 0, w: 0.01, h: 0.5 } }` loads with `roi === null`.

**Verify:** `npx vitest run src/storage.test.ts` → all pass; then `npm run check` exits 0.

### Step 16 — src/alerts.ts
Create `src/alerts.ts`:
```ts
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
```
**Verify:** `npm run typecheck` exits 0.

### Step 17 — src/wakelock.ts
Create `src/wakelock.ts`. Use local types so the code does not depend on the TS lib version:
```ts
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
```
**Verify:** `npm run typecheck` exits 0.

### Step 18 — src/camera.ts
Create `src/camera.ts`:
```ts
import type { Rect } from "./geometry";
import { FEATURE_SIZE, toFeature, type Feature } from "./vision";

export async function startCamera(video: HTMLVideoElement): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 320 },
      height: { ideal: 240 },
      frameRate: { ideal: 15, max: 15 },
    },
  });
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
}

export function stopCamera(video: HTMLVideoElement): void {
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

/** Crops the normalised ROI out of the current video frame into a 32×32 feature. */
export class FrameSampler {
  private readonly ctx: CanvasRenderingContext2D;

  constructor() {
    const canvas = document.createElement("canvas");
    canvas.width = FEATURE_SIZE;
    canvas.height = FEATURE_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
  }

  sample(video: HTMLVideoElement, roi: Rect): Feature | null {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return null;
    this.ctx.drawImage(video, roi.x * vw, roi.y * vh, roi.w * vw, roi.h * vh, 0, 0, FEATURE_SIZE, FEATURE_SIZE);
    return toFeature(this.ctx.getImageData(0, 0, FEATURE_SIZE, FEATURE_SIZE).data);
  }
}
```
**Verify:** `npm run typecheck` exits 0.

### Step 19 — Icons (scripts/gen-icons.mjs, public/favicon.svg)
1. Create `public/favicon.svg`:
   ```svg
   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#111111"/><polygon points="50,55 35,80 65,80" fill="#888888"/><polygon points="15,40.25 85,57.75 85,63.75 15,46.25" fill="#c8873a"/></svg>
   ```
2. Create `scripts/gen-icons.mjs`. It is a dependency-free PNG encoder (it needs Node ≥ 22.2 for `zlib.crc32`):
   ```js
   import { deflateSync, crc32 } from "node:zlib";
   import { mkdirSync, writeFileSync } from "node:fs";

   const BG = [17, 17, 17, 255];
   const WEDGE = [136, 136, 136, 255];
   const PLANK = [200, 135, 58, 255];

   function pixel(u, v) {
     const plankCenter = 0.52 + (u - 0.5) * 0.25;
     if (u >= 0.15 && u <= 0.85 && Math.abs(v - plankCenter) <= 0.03) return PLANK;
     if (v >= 0.55 && v <= 0.8 && Math.abs(u - 0.5) <= (v - 0.55) * 0.6) return WEDGE;
     return BG;
   }

   function chunk(type, data) {
     const len = Buffer.alloc(4);
     len.writeUInt32BE(data.length);
     const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
     const crc = Buffer.alloc(4);
     crc.writeUInt32BE(crc32(td));
     return Buffer.concat([len, td, crc]);
   }

   function png(size) {
     const stride = size * 4 + 1;
     const raw = Buffer.alloc(stride * size);
     for (let y = 0; y < size; y++) {
       raw[y * stride] = 0;
       for (let x = 0; x < size; x++) {
         raw.set(pixel((x + 0.5) / size, (y + 0.5) / size), y * stride + 1 + x * 4);
       }
     }
     const ihdr = Buffer.alloc(13);
     ihdr.writeUInt32BE(size, 0);
     ihdr.writeUInt32BE(size, 4);
     ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
     return Buffer.concat([
       Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
       chunk("IHDR", ihdr),
       chunk("IDAT", deflateSync(raw)),
       chunk("IEND", Buffer.alloc(0)),
     ]);
   }

   mkdirSync("public", { recursive: true });
   writeFileSync("public/pwa-192.png", png(192));
   writeFileSync("public/pwa-512.png", png(512));
   writeFileSync("public/apple-touch-icon.png", png(180));
   console.log("icons written");
   ```
3. Run `npm run icons`. Commit the generated PNGs.
- **Verify:** `file public/pwa-192.png public/pwa-512.png public/apple-touch-icon.png` reports `PNG image data, 192 x 192` / `512 x 512` / `180 x 180, 8-bit/color RGBA`.

### Step 20 — index.html
Create `index.html` in the repo root (exact content):
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
    <meta name="theme-color" content="#111111" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <title>Camera Chess Clock</title>
  </head>
  <body data-screen="start">
    <video id="video" playsinline muted autoplay></video>

    <section id="screen-start" class="screen">
      <h1>Camera Chess Clock</h1>
      <p>Place the phone so its back camera sees the wooden board. Keep the phone still during the game.</p>
      <button id="btn-camera" class="primary">Start camera</button>
      <p id="start-error" class="error" hidden></p>
    </section>

    <section id="screen-setup" class="screen" hidden>
      <div id="roi-layer"></div>
      <div class="panel setup-panel">
        <p>1. Drag a box around the board. 2. Press the LEFT side down, tap “Capture left”. 3. Press the RIGHT side down, tap “Capture right”.</p>
        <div class="row">
          <button id="btn-cap-left">Capture left</button>
          <button id="btn-cap-right">Capture right</button>
          <button id="btn-setup-done" class="primary" disabled>Done</button>
        </div>
        <p id="setup-status"></p>
      </div>
    </section>

    <section id="screen-game" class="screen" hidden>
      <div class="clocks">
        <div id="clock-left" class="clock"><span id="time-left" class="time">5:00</span></div>
        <div id="clock-right" class="clock"><span id="time-right" class="time">5:00</span></div>
      </div>
      <div class="panel game-bar">
        <span id="board-indicator">Board: ?</span>
        <select id="tc-preset">
          <option value="">Custom</option>
          <option value="1,0">1+0</option>
          <option value="3,0">3+0</option>
          <option value="3,2">3+2</option>
          <option value="5,0">5+0</option>
          <option value="5,3">5+3</option>
          <option value="10,0">10+0</option>
          <option value="10,5">10+5</option>
          <option value="15,10">15+10</option>
          <option value="30,0">30+0</option>
        </select>
        <label><input id="tc-minutes" type="number" min="1" max="180" step="1" /> min</label>
        <label>+<input id="tc-increment" type="number" min="0" max="60" step="1" /> s</label>
        <button id="btn-start" class="primary">Start</button>
        <button id="btn-pause" hidden>Pause</button>
        <button id="btn-reset">Reset</button>
        <button id="btn-recalibrate">Recalibrate</button>
        <button id="btn-toggle-camera">Hide camera</button>
      </div>
    </section>

    <div id="roi-box" hidden></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```
**Verify:** `grep -o 'id="' index.html | wc -l` prints `25`.

### Step 21 — src/styles.css
Create `src/styles.css` (exact content):
```css
:root { color-scheme: dark; font-family: system-ui, -apple-system, sans-serif; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: #111; color: #eee; overflow: hidden; user-select: none; -webkit-user-select: none; }
[hidden] { display: none !important; }

#video { position: fixed; inset: 0; width: 100%; height: 100%; object-fit: contain; z-index: 0; opacity: 0.35; }
body[data-screen="setup"] #video { opacity: 1; }
body[data-screen="game"] #video.camera-hidden { opacity: 0; }

.screen { position: fixed; inset: 0; z-index: 1; }
#screen-start { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; padding: 2rem; text-align: center; }

#roi-layer { position: absolute; inset: 0; touch-action: none; cursor: crosshair; }
#roi-box { position: fixed; z-index: 2; border: 3px solid #33ccff; pointer-events: none; }

.panel { position: absolute; left: 0; right: 0; bottom: 0; z-index: 3; display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; background: rgba(0, 0, 0, 0.6); }
.setup-panel { flex-direction: column; align-items: stretch; }
.setup-panel p { margin: 0.25rem 0; }
.row { display: flex; flex-wrap: wrap; gap: 0.5rem; }

.clocks { position: absolute; top: 0; left: 0; right: 0; bottom: 3.5rem; display: flex; }
.clock { flex: 1; display: flex; align-items: center; justify-content: center; border: 4px solid transparent; transition: background 0.15s; }
.clock .time { font-size: min(15vw, 40vh); font-weight: 700; font-variant-numeric: tabular-nums; }
.clock.active { background: rgba(40, 160, 80, 0.35); border-color: #33cc66; }
.clock.low .time { color: #ff9933; }
.clock.flagged { background: rgba(200, 30, 30, 0.5); border-color: #ff3333; }

button, select, input { font: inherit; font-size: 1rem; padding: 0.5rem 0.8rem; border-radius: 0.5rem; border: 1px solid #555; background: #222; color: #eee; }
button.primary { background: #22aa66; border-color: #22aa66; color: #fff; }
button:disabled, select:disabled, input:disabled { opacity: 0.4; }
#tc-minutes, #tc-increment { width: 4.5rem; }
.error { color: #ff6666; }
```
**Verify:** the file exists; it is checked later by `npm run build` in Step 23.

### Step 22 — src/main.ts (controller)
Create `src/main.ts` with this exact structure and behaviour (copy the code, then fill nothing else in):
```ts
import "./styles.css";
import { flagAlert, lowTimeAlert, switchClick, unlockAudio } from "./alerts";
import { FrameSampler, startCamera, stopCamera } from "./camera";
import {
  boardToActive, createClock, currentRemaining, detectEvents, LOW_TIME_MS, pause, resume, SIDES, start, switchTo, tick,
  type ClockEvent, type ClockState, type Side,
} from "./clock";
import { formatTime } from "./format";
import { containRect, isValidRoi, normToScreen, rectFromPoints, toNormalizedPoint, type Point, type Rect } from "./geometry";
import { loadSettings, saveSettings, type Settings } from "./storage";
import { averageFeatures, classify, distance, MIN_REF_SEPARATION, StateDebouncer, type BoardState, type Feature } from "./vision";
import { acquireWakeLock, releaseWakeLock } from "./wakelock";

const CAPTURE_FRAMES = 5;
const SAMPLE_MS_RUNNING = 100;
const SAMPLE_MS_IDLE = 250;

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const video = $<HTMLVideoElement>("video");
const screenStart = $("screen-start");
const screenSetup = $("screen-setup");
const screenGame = $("screen-game");
const btnCamera = $<HTMLButtonElement>("btn-camera");
const startError = $("start-error");
const roiLayer = $("roi-layer");
const roiBox = $("roi-box");
const btnCapLeft = $<HTMLButtonElement>("btn-cap-left");
const btnCapRight = $<HTMLButtonElement>("btn-cap-right");
const btnSetupDone = $<HTMLButtonElement>("btn-setup-done");
const setupStatus = $("setup-status");
const clockEls: Record<Side, HTMLElement> = { left: $("clock-left"), right: $("clock-right") };
const timeEls: Record<Side, HTMLElement> = { left: $("time-left"), right: $("time-right") };
const boardIndicator = $("board-indicator");
const tcPreset = $<HTMLSelectElement>("tc-preset");
const tcMinutes = $<HTMLInputElement>("tc-minutes");
const tcIncrement = $<HTMLInputElement>("tc-increment");
const btnStart = $<HTMLButtonElement>("btn-start");
const btnPause = $<HTMLButtonElement>("btn-pause");
const btnReset = $<HTMLButtonElement>("btn-reset");
const btnRecalibrate = $<HTMLButtonElement>("btn-recalibrate");
const btnToggleCamera = $<HTMLButtonElement>("btn-toggle-camera");

const settings: Settings = loadSettings(localStorage);
let clock: ClockState = createClock(settings.timeControl);
const debouncer = new StateDebouncer();
const sampler = new FrameSampler();
const refs: { left: Feature | null; right: Feature | null } = {
  left: settings.refLeft ? Float32Array.from(settings.refLeft) : null,
  right: settings.refRight ? Float32Array.from(settings.refRight) : null,
};
let board: BoardState | null = null;
let capturing: BoardState | null = null;
let captureBuffer: Feature[] = [];
let lastDistances = { dLeft: 0, dRight: 0 };
let sampleTimer: number | null = null;
let rafId: number | null = null;
let cameraWanted = false;
let dragStart: Point | null = null;
let draftRoi: Rect | null = null;

// ---------- persistence ----------
function persist(): void {
  settings.refLeft = refs.left ? Array.from(refs.left) : null;
  settings.refRight = refs.right ? Array.from(refs.right) : null;
  saveSettings(localStorage, settings);
}

// ---------- calibration state ----------
function refSeparation(): number | null {
  return refs.left && refs.right ? distance(refs.left, refs.right) : null;
}
function calibrationReady(): boolean {
  const sep = refSeparation();
  return settings.roi !== null && sep !== null && sep >= MIN_REF_SEPARATION;
}
function resetDetection(): void {
  debouncer.reset();
  board = null;
}

// ---------- screens ----------
function showScreen(name: "start" | "setup" | "game"): void {
  document.body.dataset.screen = name;
  screenStart.hidden = name !== "start";
  screenSetup.hidden = name !== "setup";
  screenGame.hidden = name !== "game";
  renderRoi();
  renderSetup();
  render();
}
function showStartError(message: string): void {
  startError.textContent = message;
  startError.hidden = false;
  showScreen("start");
}

// ---------- sampling loop ----------
function stopSampling(): void {
  if (sampleTimer !== null) {
    clearTimeout(sampleTimer);
    sampleTimer = null;
  }
}
function scheduleSample(): void {
  sampleTimer = window.setTimeout(onSample, clock.status === "running" ? SAMPLE_MS_RUNNING : SAMPLE_MS_IDLE);
}
function startSampling(): void {
  stopSampling();
  scheduleSample();
}
function onSample(): void {
  sampleTimer = null;
  const t = performance.now();
  const f = settings.roi ? sampler.sample(video, settings.roi) : null;
  if (f) {
    if (capturing) {
      captureBuffer.push(f);
      if (captureBuffer.length >= CAPTURE_FRAMES) finishCapture();
    } else if (refs.left && refs.right) {
      const c = classify(f, { left: refs.left, right: refs.right });
      lastDistances = { dLeft: c.dLeft, dRight: c.dRight };
      const r = debouncer.push(c.candidate, t);
      if (r.changedAt !== null && r.state !== null) onBoardChange(r.state, r.changedAt);
      if (!screenSetup.hidden) renderSetup();
    }
  }
  scheduleSample();
}

// ---------- calibration capture ----------
function beginCapture(side: BoardState): void {
  if (!settings.roi || capturing) return;
  capturing = side;
  captureBuffer = [];
  renderSetup();
}
function finishCapture(): void {
  if (!capturing) return;
  refs[capturing] = averageFeatures(captureBuffer);
  capturing = null;
  captureBuffer = [];
  resetDetection();
  persist();
  renderSetup();
}

// ---------- clock events ----------
function handleEvents(events: ClockEvent[]): void {
  for (const e of events) {
    if (e.type === "lowTime") {
      lowTimeAlert();
    } else {
      flagAlert();
      void releaseWakeLock();
    }
  }
}
function onBoardChange(state: BoardState, at: number): void {
  board = state;
  if (clock.status === "running") {
    const prev = clock;
    clock = switchTo(clock, boardToActive(state), at, settings.timeControl);
    if (clock.active !== prev.active) switchClick();
    handleEvents(detectEvents(prev, clock));
  }
  render();
}

// ---------- animation loop ----------
function frame(): void {
  rafId = null;
  const now = performance.now();
  const prev = clock;
  clock = tick(clock, now);
  handleEvents(detectEvents(prev, clock));
  render(now);
  if (clock.status === "running") rafId = requestAnimationFrame(frame);
}
function ensureRaf(): void {
  if (rafId === null && clock.status === "running") rafId = requestAnimationFrame(frame);
}

// ---------- rendering ----------
function render(now: number = performance.now()): void {
  const live = currentRemaining(clock, now);
  const showActive = clock.status === "running" || clock.status === "paused";
  for (const side of SIDES) {
    timeEls[side].textContent = formatTime(live[side]);
    clockEls[side].classList.toggle("active", showActive && clock.active === side);
    clockEls[side].classList.toggle("low", live[side] < LOW_TIME_MS);
    clockEls[side].classList.toggle("flagged", clock.flagged === side);
  }
  boardIndicator.textContent =
    board === null ? "Board: ?" : board === "left" ? "Board: ◀ left down" : "Board: right down ▶";
  btnStart.hidden = clock.status !== "idle";
  btnStart.disabled = board === null;
  btnPause.hidden = !showActive;
  btnPause.textContent = clock.status === "running" ? "Pause" : "Resume";
  const tcLocked = clock.status !== "idle";
  tcPreset.disabled = tcLocked;
  tcMinutes.disabled = tcLocked;
  tcIncrement.disabled = tcLocked;
  btnToggleCamera.textContent = settings.showCamera ? "Hide camera" : "Show camera";
  video.classList.toggle("camera-hidden", !settings.showCamera);
}

function renderSetup(): void {
  btnCapLeft.textContent = refs.left ? "Capture left ✓" : "Capture left";
  btnCapRight.textContent = refs.right ? "Capture right ✓" : "Capture right";
  btnCapLeft.disabled = capturing !== null || settings.roi === null;
  btnCapRight.disabled = capturing !== null || settings.roi === null;
  btnSetupDone.disabled = !calibrationReady();
  const sep = refSeparation();
  if (capturing) {
    setupStatus.textContent = `Capturing ${capturing}… hold still.`;
  } else if (!settings.roi) {
    setupStatus.textContent = "Drag a box around the board.";
  } else if (sep === null) {
    setupStatus.textContent = "Capture both board positions.";
  } else if (sep < MIN_REF_SEPARATION) {
    setupStatus.textContent = `Positions too similar (${sep.toFixed(2)}). Draw the box tighter around the board and capture again.`;
  } else {
    setupStatus.textContent =
      `Ready (separation ${sep.toFixed(2)}). Live: ${board ?? "?"} ` +
      `(L ${lastDistances.dLeft.toFixed(2)} / R ${lastDistances.dRight.toFixed(2)})`;
  }
}

// ---------- ROI drawing ----------
function contentRect(): Rect {
  return containRect(video.clientWidth, video.clientHeight, video.videoWidth || 4, video.videoHeight || 3);
}
function renderRoi(): void {
  const r = draftRoi ?? settings.roi;
  if (!r || screenSetup.hidden) {
    roiBox.hidden = true;
    return;
  }
  const s = normToScreen(r, contentRect());
  roiBox.hidden = false;
  roiBox.style.left = `${s.x}px`;
  roiBox.style.top = `${s.y}px`;
  roiBox.style.width = `${s.w}px`;
  roiBox.style.height = `${s.h}px`;
}
roiLayer.addEventListener("pointerdown", (e) => {
  roiLayer.setPointerCapture(e.pointerId);
  dragStart = toNormalizedPoint(e.clientX, e.clientY, contentRect());
  draftRoi = null;
});
roiLayer.addEventListener("pointermove", (e) => {
  if (!dragStart) return;
  draftRoi = rectFromPoints(dragStart, toNormalizedPoint(e.clientX, e.clientY, contentRect()));
  renderRoi();
});
roiLayer.addEventListener("pointerup", (e) => {
  if (!dragStart) return;
  const r = rectFromPoints(dragStart, toNormalizedPoint(e.clientX, e.clientY, contentRect()));
  dragStart = null;
  draftRoi = null;
  if (isValidRoi(r)) {
    settings.roi = r;
    refs.left = null;
    refs.right = null;
    resetDetection();
    persist();
  }
  renderRoi();
  renderSetup();
});
roiLayer.addEventListener("pointercancel", () => {
  dragStart = null;
  draftRoi = null;
  renderRoi();
});
window.addEventListener("resize", renderRoi);

// ---------- time control ----------
function syncTcInputs(): void {
  const minutes = settings.timeControl.baseMs / 60_000;
  const inc = settings.timeControl.incrementMs / 1000;
  tcMinutes.value = String(minutes);
  tcIncrement.value = String(inc);
  const v = `${minutes},${inc}`;
  tcPreset.value = Array.from(tcPreset.options).some((o) => o.value === v) ? v : "";
}
function applyTc(minutes: number, incSec: number): void {
  const valid =
    Number.isInteger(minutes) && minutes >= 1 && minutes <= 180 &&
    Number.isInteger(incSec) && incSec >= 0 && incSec <= 60;
  if (valid && clock.status === "idle") {
    settings.timeControl = { baseMs: minutes * 60_000, incrementMs: incSec * 1000 };
    persist();
    clock = createClock(settings.timeControl);
  }
  syncTcInputs();
  render();
}
tcPreset.addEventListener("change", () => {
  if (!tcPreset.value) return;
  const [m, i] = tcPreset.value.split(",").map(Number);
  applyTc(m, i);
});
tcMinutes.addEventListener("change", () => applyTc(Number(tcMinutes.value), Number(tcIncrement.value)));
tcIncrement.addEventListener("change", () => applyTc(Number(tcMinutes.value), Number(tcIncrement.value)));

// ---------- buttons ----------
btnCamera.addEventListener("click", async () => {
  startError.hidden = true;
  unlockAudio();
  if (!navigator.mediaDevices?.getUserMedia) {
    showStartError("No camera access. Open the app over HTTPS in Chrome or Safari.");
    return;
  }
  try {
    await startCamera(video);
  } catch (err) {
    showStartError(`Camera unavailable: ${err instanceof Error ? err.name : String(err)}`);
    return;
  }
  cameraWanted = true;
  startSampling();
  showScreen(calibrationReady() ? "game" : "setup");
});
btnCapLeft.addEventListener("click", () => beginCapture("left"));
btnCapRight.addEventListener("click", () => beginCapture("right"));
btnSetupDone.addEventListener("click", () => {
  if (calibrationReady()) showScreen("game");
});
btnStart.addEventListener("click", () => {
  if (board === null || clock.status !== "idle") return;
  unlockAudio();
  clock = start(clock, boardToActive(board), performance.now());
  void acquireWakeLock();
  ensureRaf();
  render();
});
btnPause.addEventListener("click", () => {
  const now = performance.now();
  if (clock.status === "running") {
    clock = pause(clock, now);
    void releaseWakeLock();
  } else if (clock.status === "paused") {
    const active: Side = board !== null ? boardToActive(board) : (clock.active ?? "left");
    clock = resume(clock, active, now);
    void acquireWakeLock();
    ensureRaf();
  }
  render();
});
btnReset.addEventListener("click", () => {
  if ((clock.status === "running" || clock.status === "paused") && !confirm("Reset the clock?")) return;
  clock = createClock(settings.timeControl);
  void releaseWakeLock();
  render();
});
btnRecalibrate.addEventListener("click", () => {
  if (clock.status === "running") clock = pause(clock, performance.now());
  void releaseWakeLock();
  showScreen("setup");
});
btnToggleCamera.addEventListener("click", () => {
  settings.showCamera = !settings.showCamera;
  persist();
  render();
});

// ---------- page visibility ----------
document.addEventListener("visibilitychange", async () => {
  if (document.hidden) {
    if (clock.status === "running") clock = pause(clock, performance.now());
    void releaseWakeLock();
    stopSampling();
    stopCamera(video);
    render();
  } else if (cameraWanted) {
    try {
      await startCamera(video);
      startSampling();
    } catch (err) {
      showStartError(`Camera unavailable: ${err instanceof Error ? err.name : String(err)}`);
    }
  }
});

// ---------- init ----------
syncTcInputs();
showScreen("start");
```
**Verify:** `npm run typecheck` exits 0. If `noUnusedLocals` flags an import, remove only that import. Do not remove any function.

### Step 23 — vite.config.ts (PWA)
Create `vite.config.ts`:
```ts
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/chessclock/",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Camera Chess Clock",
        short_name: "ChessClock",
        description: "A chess clock driven by a wooden board on a wedge, watched by the phone camera.",
        theme_color: "#111111",
        background_color: "#111111",
        display: "standalone",
        orientation: "landscape",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: { globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"] },
    }),
  ],
});
```
**Verify:** `npm run build` exits 0, and `ls dist/sw.js dist/manifest.webmanifest dist/index.html` lists all three. `grep -o '/chessclock/[a-z-]*\.svg' dist/index.html` prints `/chessclock/favicon.svg`.

### Step 24 — .github/workflows/deploy.yml
Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```
**Verify:** `grep -c 'uses:' .github/workflows/deploy.yml` prints `4`.

### Step 25 — README.md
Create `README.md` with these sections (plain prose, short):
1. **Camera Chess Clock**: a one-paragraph description (the board on the wedge, the camera, offline PWA).
2. **Physical setup**: put the phone on a stand with the back camera facing the board from 30–60 cm, with the screen facing the players. Use even lighting. Do not move the phone after calibration.
3. **Usage**:
   - Tap "Start camera".
   - Drag a box tightly around the board.
   - Press the left side down and tap "Capture left"; press the right side down and tap "Capture right"; then tap "Done".
   - Choose a time control. The player who moves second presses their side down; then tap "Start", and the clock of the player whose side is UP runs.
   - Each press of your side ends your move.
   - Use "Recalibrate" if the phone or the lighting changes.
4. **Development**:
   - `npm install`, then `npm run dev` and open `http://localhost:5173/chessclock/` (desktop webcam works on localhost).
   - Phones need HTTPS, so test on the deployed site.
   - `npm run check` and `npm run build`. `npm run icons` regenerates the icons.
5. **Deployment**:
   - Push to `main`. Under GitHub repo Settings → Pages, set Source to "GitHub Actions".
   - The repo must be named `chessclock`; otherwise change `base` in `vite.config.ts`.
   - Install on the phone via "Add to Home screen".

**Verify:** `test -s README.md && echo ok` → `ok`.

### Step 26 — Final quality gate and manual smoke test
1. Run `npm run check`: typecheck passes and all tests pass (format, clock, vision, geometry, storage).
2. Run `npm run build`: it exits 0.
3. Manual check (desktop with a webcam, or skip if none and report it):
   - Run `npm run dev` and open `http://localhost:5173/chessclock/`.
   - Tap "Start camera" and grant permission; the setup screen shows the video.
   - Drag a box; the cyan box appears.
   - Capture left and right with two different scenes in the box (e.g. a hand covering the left vs. the right half). The status shows "Ready (separation …)", and "Done" becomes enabled.
   - On the game screen, Start is enabled once "Board:" shows a side. Tap Start: one clock runs. Change the scene: the clocks switch with a click sound.
4. Report the results.

---

## Definition of done
- `npm run check` exits 0, with every test file from Steps 5, 7, 9, 11, 13 and 15 passing.
- `npm run build` exits 0, and `dist/sw.js` plus `dist/manifest.webmanifest` exist.
- All files listed in "Files created by this plan" exist; there are no other new source files and no extra dependencies.
- Each step is committed on `feature/camera-chess-clock` as `step N: <title>`.

## If blocked
- If a command fails and the fix is not an obvious typo in code you just wrote, **stop and report** the exact command, the error output, and the step number.
- Do not change versions, dependencies, tsconfig options, constants (thresholds, intervals, sizes), file names, the public API signatures or UI behaviour defined in this plan. In particular, if `npm install` reports a peer-dependency conflict, stop and report; do NOT use `--force` or `--legacy-peer-deps`.
- If git refuses to commit because `user.name`/`user.email` is unset, stop and ask the user. Do not set an identity yourself.
- Never silently deviate from a decision in this plan; if a decision seems wrong, report it and wait.
