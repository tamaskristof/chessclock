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
