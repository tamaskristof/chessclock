import "./styles.css";
import { flagAlert, lowTimeAlert, switchClick, unlockAudio } from "./alerts";
import { FrameSampler, startCamera, stopCamera } from "./camera";
import { categoryFor } from "./chesscom";
import { signalLabel, signalLevel } from "./calibration";
import {
  boardToActive, createClock, currentRemaining, detectEvents, LOW_TIME_MS, other, pause, resume, SIDES, start, switchTo, tick,
  type ClockEvent, type ClockState, type Side,
} from "./clock";
import { $ } from "./dom";
import { clockWidthEm, formatClock } from "./format";
import { containRect, isValidRoi, normToScreen, rectFromPoints, toNormalizedPoint, type Point, type Rect } from "./geometry";
import { categoryLabel, sideLabel, tcLabel } from "./labels";
import { initSearch } from "./search";
import { loadSettings, saveSettings, withRecent, type Settings } from "./storage";
import { averageFeatures, classify, distance, MIN_REF_SEPARATION, StateDebouncer, type BoardState, type Feature } from "./vision";
import { acquireWakeLock, releaseWakeLock } from "./wakelock";
import { enterFullscreen } from "./fullscreen";

const CAPTURE_FRAMES = 5;
const SAMPLE_MS_RUNNING = 100;
const SAMPLE_MS_IDLE = 250;
const PRESETS: ReadonlyArray<readonly [number, number]> = [[1, 0], [3, 0], [3, 2], [5, 0], [5, 3], [10, 0], [10, 5], [15, 10], [30, 0]];

type Screen = "start" | "home" | "search" | "calibrate" | "game";

// ---------- elements ----------
const video = $<HTMLVideoElement>("video");
const screens: Record<Screen, HTMLElement> = {
  start: $("screen-start"), home: $("screen-home"), search: $("screen-search"), calibrate: $("screen-calibrate"), game: $("screen-game"),
};
const btnCamera = $<HTMLButtonElement>("btn-camera");
const startError = $("start-error");

const tcChips = $("tc-chips");
const tcCustom = $("tc-custom");
const tcBack = $<HTMLButtonElement>("tc-back");
const tcMinutes = $<HTMLInputElement>("tc-minutes");
const tcIncrement = $<HTMLInputElement>("tc-increment");
const tcSummary = $("tc-summary");
const calPill = $("cal-pill");
const calPillText = $("cal-pill-text");
const btnCalibrate = $<HTMLButtonElement>("btn-calibrate");
const nameEls: Record<Side, HTMLInputElement> = { left: $("name-left"), right: $("name-right") };
const ratingEls: Record<Side, HTMLInputElement> = { left: $("rating-left"), right: $("rating-right") };
const sourceEls: Record<Side, HTMLElement> = { left: $("source-left"), right: $("source-right") };
const homeBoardPill = $("home-board-pill");
const homeBoardText = $("home-board-text");
const btnStart = $<HTMLButtonElement>("btn-start");

const roiLayer = $("roi-layer");
const roiBox = $("roi-box");
const calTitle = $("cal-title");
const calText = $("cal-text");
const calExtra = $("cal-extra");
const calBack = $<HTMLButtonElement>("cal-back");
const calNext = $<HTMLButtonElement>("cal-next");

const clockEls: Record<Side, HTMLElement> = { left: $("clock-left"), right: $("clock-right") };
const mainEls: Record<Side, HTMLElement> = { left: $("time-left"), right: $("time-right") };
const fracEls: Record<Side, HTMLElement> = { left: $("frac-left"), right: $("frac-right") };
const whoEls: Record<Side, HTMLElement> = { left: $("who-left"), right: $("who-right") };
const gamePill = $("game-pill");
const gamePillText = $("game-pill-text");
const btnPause = $<HTMLButtonElement>("btn-pause");
const sheetPause = $("sheet-pause");
const pauseSub = $("pause-sub");
const result = $("result");
const resultTitle = $("result-title");
const resultSub = $("result-sub");

// ---------- state ----------
const settings: Settings = loadSettings(localStorage);
let clock: ClockState = createClock(settings.timeControl);
const debouncer = new StateDebouncer();
const sampler = new FrameSampler();
const refs: { left: Feature | null; right: Feature | null } = {
  left: settings.refLeft ? Float32Array.from(settings.refLeft) : null,
  right: settings.refRight ? Float32Array.from(settings.refRight) : null,
};
let screen: Screen = "start";
let board: BoardState | null = null;
let capturing: BoardState | null = null;
let captureBuffer: Feature[] = [];
let lastDistances = { dLeft: 0, dRight: 0 };
let sampleTimer: number | null = null;
let rafId: number | null = null;
let cameraWanted = false;
let customOpen = false;
let calStep = 0;
let calReturn: Screen = "home";
let calError: string | null = null;
let calSnapshot: { roi: Rect | null; left: number[] | null; right: number[] | null } | null = null;
const seen: Record<Side, boolean> = { left: false, right: false };
let dragAnchor: Point | null = null;
let draftRoi: Rect | null = null;
let searchSide: Side = "left";

// ---------- persistence ----------
function persist(): void {
  settings.refLeft = refs.left ? Array.from(refs.left) : null;
  settings.refRight = refs.right ? Array.from(refs.right) : null;
  try {
    saveSettings(localStorage, settings);
  } catch {
    /* storage unavailable: the game still works */
  }
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
function showScreen(name: Screen): void {
  screen = name;
  document.body.dataset.screen = name;
  for (const key of Object.keys(screens) as Screen[]) screens[key].hidden = key !== name;
  if (name === "home") renderHome();
  if (name === "calibrate") renderCalibrate();
  renderRoi();
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
      else renderCalibrate();
    } else if (refs.left && refs.right) {
      const c = classify(f, { left: refs.left, right: refs.right });
      lastDistances = { dLeft: c.dLeft, dRight: c.dRight };
      const r = debouncer.push(c.candidate, t);
      if (r.changedAt !== null && r.state !== null) onBoardChange(r.state, r.changedAt);
      if (screen === "calibrate" && calStep === 3) renderCalibrate();
    }
  }
  scheduleSample();
}

// ---------- calibration capture ----------
function beginCapture(side: BoardState): void {
  if (!settings.roi || capturing) return;
  capturing = side;
  captureBuffer = [];
  renderCalibrate();
}
function finishCapture(): void {
  if (!capturing) return;
  const side = capturing;
  refs[side] = averageFeatures(captureBuffer);
  capturing = null;
  captureBuffer = [];
  resetDetection();
  persist();
  if (side === "left") {
    calStep = 2;
  } else {
    const sep = refSeparation();
    if (sep !== null && sep < MIN_REF_SEPARATION) {
      calError = `The two positions look too similar (${sep.toFixed(2)}). Draw the box tighter around the plank and try again.`;
      refs.left = null;
      refs.right = null;
      persist();
      calStep = 0;
    } else {
      seen.left = false;
      seen.right = false;
      calStep = 3;
    }
  }
  renderCalibrate();
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
  if (screen === "calibrate" && calStep === 3) seen[state] = true;
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

// ---------- players ----------
function playerName(side: Side): string {
  return settings.players[side].name.trim() || sideLabel(side);
}
function whoText(side: Side): { name: string; rating: string } {
  const p = settings.players[side];
  return { name: p.name.trim(), rating: p.rating === null ? "" : String(p.rating) };
}
function setBoardPill(pill: HTMLElement, text: HTMLElement, detected: BoardState | null, badWhenNone = false): void {
  const dot = pill.querySelector(".dot") as HTMLElement;
  text.textContent = detected === null ? "No board" : detected === "left" ? "Left down" : "Right down";
  dot.classList.toggle("off", detected === null && !badWhenNone);
  dot.classList.toggle("bad", detected === null && badWhenNone);
}

// ---------- rendering: game ----------
const lastText: Record<Side, string> = { left: "", right: "" };
function render(now: number = performance.now()): void {
  if (screen === "home") renderHomeLive();
  if (screen !== "game") return;
  const live = currentRemaining(clock, now);
  const running = clock.status === "running";
  const paused = clock.status === "paused";
  const flagged = clock.status === "flagged";
  const bothEmpty = SIDES.every((side) => {
    const w = whoText(side);
    return w.name === "" && w.rating === "";
  });
  for (const side of SIDES) {
    const t = formatClock(live[side]);
    const key = t.main + (t.frac ?? "");
    if (key !== lastText[side]) {
      lastText[side] = key;
      mainEls[side].textContent = t.main;
      fracEls[side].textContent = t.frac ?? "";
      clockEls[side].style.setProperty("--em", clockWidthEm(t).toFixed(2));
    }
    const el = clockEls[side];
    el.classList.toggle("running", running && clock.active === side);
    el.classList.toggle("waiting", (running && clock.active !== side) || (flagged && clock.flagged !== side));
    el.classList.toggle("paused-side", paused && clock.active === side);
    el.classList.toggle("low", live[side] < LOW_TIME_MS && !flagged);
    el.classList.toggle("flagged", clock.flagged === side);
    const w = whoText(side);
    // Keep the line's height on both halves if either player has one, so the digits stay level.
    whoEls[side].hidden = bothEmpty;
    whoEls[side].style.visibility = w.name === "" && w.rating === "" ? "hidden" : "";
    whoEls[side].innerHTML = '<span class="nm"></span><span class="rt"></span>';
    (whoEls[side].querySelector(".nm") as HTMLElement).textContent = w.name;
    (whoEls[side].querySelector(".rt") as HTMLElement).textContent = w.rating;
  }
  setBoardPill(gamePill, gamePillText, board, true);
  gamePill.hidden = !running;
  btnPause.hidden = !running;
  sheetPause.hidden = !paused;
  result.hidden = !flagged;
  screens.game.classList.toggle("paused-layout", paused);
  screens.game.classList.toggle("game-over-layout", flagged);
  if (paused) {
    pauseSub.textContent = `${playerName(clock.active ?? "left")} to move · ${tcLabel(settings.timeControl)}`;
  }
  if (flagged && clock.flagged) {
    const winner = other(clock.flagged);
    resultTitle.textContent = `${playerName(clock.flagged)} lost on time`;
    resultSub.textContent = `${playerName(winner)} wins · ${tcLabel(settings.timeControl)}`;
  }
}

// ---------- rendering: home ----------
function isPreset(tc: { baseMs: number; incrementMs: number }): boolean {
  return PRESETS.some(([m, i]) => tc.baseMs === m * 60_000 && tc.incrementMs === i * 1000);
}
function renderTimeControl(): void {
  const tc = settings.timeControl;
  const children: HTMLElement[] = PRESETS.map(([m, i]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = `${m}+${i}`;
    b.setAttribute("aria-pressed", String(tc.baseMs === m * 60_000 && tc.incrementMs === i * 1000));
    b.addEventListener("click", () => applyTc(m, i));
    return b;
  });
  const custom = document.createElement("button");
  custom.type = "button";
  const customActive = !isPreset(tc);
  if (customActive) {
    const label = tcLabel(tc);
    custom.className = "chip custom-val";
    custom.setAttribute("aria-label", `Custom, ${label}`);
    const cap = document.createElement("span");
    cap.className = "cap";
    cap.textContent = "CUSTOM";
    const val = document.createElement("span");
    val.className = "val";
    val.textContent = label;
    custom.append(cap, val);
  } else {
    custom.className = "chip text";
    custom.textContent = "Custom";
  }
  custom.setAttribute("aria-pressed", String(customActive));
  custom.addEventListener("click", () => {
    customOpen = true;
    renderTimeControl();
  });
  tcChips.replaceChildren(...children, custom);
  tcChips.hidden = customOpen;
  tcCustom.hidden = !customOpen;
  if (document.activeElement !== tcMinutes) tcMinutes.value = String(tc.baseMs / 60_000);
  if (document.activeElement !== tcIncrement) tcIncrement.value = String(tc.incrementMs / 1000);
  const mins = tc.baseMs / 60_000;
  const inc = tc.incrementMs / 1000;
  tcSummary.textContent =
    `${mins} minute${mins === 1 ? "" : "s"} per player, ${inc === 0 ? "no increment" : `plus ${inc} second${inc === 1 ? "" : "s"} per move`}. ` +
    `Counts as ${categoryFor(tc)} on chess.com.`;
}
function renderPlayers(): void {
  for (const side of SIDES) {
    const p = settings.players[side];
    if (document.activeElement !== nameEls[side]) nameEls[side].value = p.name;
    if (document.activeElement !== ratingEls[side]) ratingEls[side].value = p.rating === null ? "" : String(p.rating);
    const src = p.source;
    sourceEls[side].hidden = !src || p.rating === null;
    if (src) sourceEls[side].textContent = `${categoryLabel(src.category)} rating · chess.com/${src.username}`;
  }
}
function renderHome(): void {
  renderTimeControl();
  renderPlayers();
  renderHomeLive();
}
function renderHomeLive(): void {
  const ready = calibrationReady();
  const dot = calPill.querySelector(".dot") as HTMLElement;
  calPillText.textContent = ready ? "Board calibrated" : "Not calibrated";
  dot.classList.toggle("off", !ready);
  btnCalibrate.textContent = ready ? "Recalibrate" : "Calibrate";
  btnCalibrate.classList.toggle("primary", !ready);
  setBoardPill(homeBoardPill, homeBoardText, ready ? board : null);
  btnStart.disabled = !ready || board === null;
}

// ---------- time control ----------
function applyTc(minutes: number, incSec: number): void {
  const valid =
    Number.isInteger(minutes) && minutes >= 1 && minutes <= 180 && Number.isInteger(incSec) && incSec >= 0 && incSec <= 60;
  if (valid) {
    settings.timeControl = { baseMs: minutes * 60_000, incrementMs: incSec * 1000 };
    persist();
  }
  renderTimeControl();
}
tcBack.addEventListener("click", () => {
  customOpen = false;
  renderTimeControl();
});
tcMinutes.addEventListener("input", () => applyTc(Number(tcMinutes.value), Number(tcIncrement.value)));
tcIncrement.addEventListener("input", () => applyTc(Number(tcMinutes.value), Number(tcIncrement.value)));
tcMinutes.addEventListener("change", renderTimeControl);
tcIncrement.addEventListener("change", renderTimeControl);

// ---------- player inputs ----------
for (const side of SIDES) {
  nameEls[side].addEventListener("input", () => {
    settings.players[side].name = nameEls[side].value.slice(0, 60);
    persist();
  });
  ratingEls[side].addEventListener("input", () => {
    const digits = ratingEls[side].value.replace(/\D/g, "").slice(0, 4);
    ratingEls[side].value = digits;
    const p = settings.players[side];
    p.rating = digits === "" ? null : Number(digits);
    p.source = null; // a hand-typed rating no longer comes from chess.com
    persist();
    renderPlayers();
  });
}
document.querySelectorAll<HTMLButtonElement>(".find").forEach((b) => {
  b.addEventListener("click", () => {
    searchSide = b.dataset.side === "right" ? "right" : "left";
    search.open(searchSide, settings.players[searchSide].source?.username ?? "");
    showScreen("search");
  });
});

const search = initSearch({
  getTimeControl: () => settings.timeControl,
  getRecent: () => settings.recentUsernames,
  onLookedUp: (username) => {
    settings.recentUsernames = withRecent(settings.recentUsernames, username);
    persist();
  },
  onPick: (side, picked) => {
    settings.players[side] = { name: picked.name, rating: picked.rating, source: picked.source };
    persist();
    showScreen("home");
  },
  onBack: () => showScreen("home"),
});

// ---------- calibration wizard ----------
function enterCalibration(returnTo: Screen = "home"): void {
  calReturn = returnTo;
  calSnapshot = {
    roi: settings.roi ? { ...settings.roi } : null,
    left: settings.refLeft,
    right: settings.refRight,
  };
  calStep = 0;
  calError = null;
  capturing = null;
  showScreen("calibrate");
}
function leaveCalibration(restore: boolean): void {
  if (restore && calSnapshot) {
    settings.roi = calSnapshot.roi;
    refs.left = calSnapshot.left ? Float32Array.from(calSnapshot.left) : null;
    refs.right = calSnapshot.right ? Float32Array.from(calSnapshot.right) : null;
    persist();
  }
  capturing = null;
  resetDetection();
  showScreen(calReturn);
}
function hadCalibration(): boolean {
  return calSnapshot !== null && calSnapshot.roi !== null && calSnapshot.left !== null && calSnapshot.right !== null;
}

function renderCalibrate(): void {
  document.body.dataset.calStep = String(calStep);
  document.querySelectorAll<HTMLElement>(".steps li").forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle("done", n < calStep);
    li.classList.toggle("current", n === calStep);
  });
  roiBox.classList.toggle("ok", calStep === 3);
  calExtra.replaceChildren();
  calNext.disabled = false;
  calBack.hidden = false;
  calBack.textContent = "Back";
  calNext.textContent = "Next";

  if (calStep === 0) {
    calTitle.textContent = "Frame the board";
    calText.textContent = "Drag a box tightly around the plank. Drag the corners to adjust it.";
    addNote(calError ?? "Keep the phone still from now on.", calError !== null);
    calNext.disabled = settings.roi === null;
    calBack.textContent = "Cancel";
    calBack.hidden = !hadCalibration();
  } else if (calStep === 1 || calStep === 2) {
    const side: BoardState = calStep === 1 ? "left" : "right";
    calTitle.textContent = `Press the ${side} side down`;
    calText.textContent = "Hold it down, then tap Capture. Keep your hand outside the box.";
    if (capturing) {
      const n = captureBuffer.length;
      const box = document.createElement("div");
      box.className = "progress";
      box.innerHTML = '<div class="line"><span>Hold still…</span><b></b></div><div class="bar"><div></div></div>';
      (box.querySelector("b") as HTMLElement).textContent = `${n} / ${CAPTURE_FRAMES}`;
      (box.querySelector(".bar > div") as HTMLElement).style.width = `${(n / CAPTURE_FRAMES) * 100}%`;
      calExtra.append(box);
      calNext.textContent = "Capturing…";
      calNext.disabled = true;
    } else {
      calNext.textContent = "Capture";
    }
  } else {
    calTitle.textContent = "Test the board";
    calText.textContent = "Press each side once and check the app sees it.";
    const level = signalLevel(lastDistances.dLeft, lastDistances.dRight);
    const row = document.createElement("div");
    row.className = "test-row";
    row.innerHTML =
      '<span class="pill"><span class="dot"></span><span class="t"></span></span>' +
      '<div class="meter"><div class="bars" role="img"><i></i><i></i><i></i><i></i><i></i></div><span class="l"></span></div>';
    setBoardPill(row.querySelector(".pill") as HTMLElement, row.querySelector(".t") as HTMLElement, board);
    row.querySelectorAll<HTMLElement>(".bars i").forEach((bar, i) => bar.classList.toggle("on", i < level));
    (row.querySelector(".bars") as HTMLElement).setAttribute("aria-label", signalLabel(level));
    (row.querySelector(".l") as HTMLElement).textContent = signalLabel(level);
    const seenRow = document.createElement("div");
    seenRow.className = "seen";
    seenRow.innerHTML = `<span class="${seen.left ? "yes" : ""}">Left seen</span><span class="${seen.right ? "yes" : ""}">Right seen</span>`;
    calExtra.append(row, seenRow);
    calBack.textContent = "Start over";
    calNext.textContent = "Done";
    calNext.disabled = !(seen.left && seen.right);
  }
}
function addNote(text: string, bad: boolean): void {
  const p = document.createElement("p");
  p.className = "body small";
  p.textContent = text;
  p.style.color = bad ? "var(--flag)" : "var(--ink-muted)";
  calExtra.append(p);
}

calBack.addEventListener("click", () => {
  if (capturing) return;
  if (calStep === 0) leaveCalibration(true);
  else {
    calStep = calStep === 3 ? 0 : calStep - 1;
    calError = null;
    renderCalibrate();
  }
});
calNext.addEventListener("click", () => {
  if (calStep === 0 && settings.roi) {
    calError = null;
    calStep = 1;
    renderCalibrate();
  } else if (calStep === 1) beginCapture("left");
  else if (calStep === 2) beginCapture("right");
  else if (calStep === 3 && calibrationReady()) leaveCalibration(false);
});
btnCalibrate.addEventListener("click", () => enterCalibration());

// ---------- ROI drawing ----------
function contentRect(): Rect {
  return containRect(video.clientWidth, video.clientHeight, video.videoWidth || 4, video.videoHeight || 3);
}
function renderRoi(): void {
  const r = draftRoi ?? settings.roi;
  if (!r || screen !== "calibrate") {
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
function bindDrag(el: HTMLElement, anchorFor: (e: PointerEvent) => Point | null): void {
  el.addEventListener("pointerdown", (e) => {
    if (calStep !== 0) return;
    const anchor = anchorFor(e);
    if (!anchor) return;
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    dragAnchor = anchor;
    draftRoi = null;
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragAnchor) return;
    draftRoi = rectFromPoints(dragAnchor, toNormalizedPoint(e.clientX, e.clientY, contentRect()));
    renderRoi();
  });
  el.addEventListener("pointerup", (e) => {
    if (!dragAnchor) return;
    const r = rectFromPoints(dragAnchor, toNormalizedPoint(e.clientX, e.clientY, contentRect()));
    dragAnchor = null;
    draftRoi = null;
    if (isValidRoi(r)) {
      settings.roi = r;
      refs.left = null;
      refs.right = null;
      calError = null;
      resetDetection();
      persist();
    }
    renderRoi();
    renderCalibrate();
  });
  el.addEventListener("pointercancel", () => {
    dragAnchor = null;
    draftRoi = null;
    renderRoi();
  });
}
bindDrag(roiLayer, (e) => toNormalizedPoint(e.clientX, e.clientY, contentRect()));
roiBox.querySelectorAll<HTMLElement>(".handle").forEach((h) => {
  bindDrag(h, () => {
    const r = settings.roi;
    if (!r) return null;
    const c = h.dataset.corner ?? "se";
    // Anchor on the opposite corner so the dragged corner follows the pointer.
    return { x: c.endsWith("w") ? r.x + r.w : r.x, y: c.startsWith("n") ? r.y + r.h : r.y };
  });
});
window.addEventListener("resize", renderRoi);

// ---------- buttons ----------
btnCamera.addEventListener("click", async () => {
  startError.hidden = true;
  unlockAudio();
  enterFullscreen(); // before any await, while the tap still counts as a user gesture
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
  if (calibrationReady()) showScreen("home");
  else enterCalibration();
});

function startGame(): void {
  if (board === null || !calibrationReady()) return;
  unlockAudio();
  enterFullscreen(); // in case the player left fullscreen since the camera started
  clock = start(createClock(settings.timeControl), boardToActive(board), performance.now());
  lastText.left = "";
  lastText.right = "";
  void acquireWakeLock();
  showScreen("game");
  ensureRaf();
}
btnStart.addEventListener("click", startGame);

btnPause.addEventListener("click", () => {
  clock = pause(clock, performance.now());
  void releaseWakeLock();
  render();
});
$("btn-resume").addEventListener("click", () => {
  if (clock.status !== "paused") return;
  const active: Side = board !== null ? boardToActive(board) : (clock.active ?? "left");
  clock = resume(clock, active, performance.now());
  void acquireWakeLock();
  ensureRaf();
  render();
});
function toHome(): void {
  clock = createClock(settings.timeControl);
  void releaseWakeLock();
  showScreen("home");
}
$("btn-new").addEventListener("click", toHome);
$("result-new").addEventListener("click", toHome);
$("result-rematch").addEventListener("click", () => {
  // Players swap seats for the rematch, so names and ratings swap sides.
  const { left, right } = settings.players;
  settings.players = { left: right, right: left };
  persist();
  toHome();
});
$("btn-recal").addEventListener("click", () => enterCalibration("game")); // the game stays paused underneath

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
showScreen("start");
