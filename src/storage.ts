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
