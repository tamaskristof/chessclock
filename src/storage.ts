import type { Category } from "./chesscom";
import type { Side, TimeControl } from "./clock";
import { isValidRoi, type Rect } from "./geometry";
import { FEATURE_LENGTH } from "./vision";

export const STORAGE_KEY = "chessclock.v1";

/** Where a rating came from, so the UI can say "Blitz rating · chess.com/anna_k84". */
export interface RatingSource { username: string; category: Category; }

export interface Player {
  name: string;
  /** Null when not set. */
  rating: number | null;
  source: RatingSource | null;
}

export const MAX_RECENT = 6;

export interface Settings {
  timeControl: TimeControl;
  roi: Rect | null;
  refLeft: number[] | null;
  refRight: number[] | null;
  players: Record<Side, Player>;
  /** chess.com usernames looked up before, newest first. */
  recentUsernames: string[];
}

export function emptyPlayer(): Player {
  return { name: "", rating: null, source: null };
}

export function defaultSettings(): Settings {
  return {
    timeControl: { baseMs: 300_000, incrementMs: 0 },
    roi: null,
    refLeft: null,
    refRight: null,
    players: { left: emptyPlayer(), right: emptyPlayer() },
    recentUsernames: [],
  };
}

/** Moves a username to the front of the recent list (case-insensitive), capped at MAX_RECENT. */
export function withRecent(list: readonly string[], username: string): string[] {
  const key = username.toLowerCase();
  return [username, ...list.filter((u) => u.toLowerCase() !== key)].slice(0, MAX_RECENT);
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

const CATEGORY_SET: readonly string[] = ["bullet", "blitz", "rapid", "daily"];

function parsePlayer(v: unknown): Player {
  if (typeof v !== "object" || v === null) return emptyPlayer();
  const o = v as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.slice(0, 60) : "";
  const rating = isNum(o.rating) && Number.isInteger(o.rating) && o.rating >= 0 && o.rating <= 4000 ? o.rating : null;
  let source: RatingSource | null = null;
  if (typeof o.source === "object" && o.source !== null) {
    const s = o.source as Record<string, unknown>;
    if (typeof s.username === "string" && s.username && typeof s.category === "string" && CATEGORY_SET.includes(s.category)) {
      source = { username: s.username, category: s.category as Category };
    }
  }
  return { name, rating, source: rating === null ? null : source };
}

function parseRecent(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((u): u is string => typeof u === "string" && u.length > 0 && u.length <= 25).slice(0, MAX_RECENT);
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
    players: {
      left: parsePlayer((o.players as Record<string, unknown> | undefined)?.left),
      right: parsePlayer((o.players as Record<string, unknown> | undefined)?.right),
    },
    recentUsernames: parseRecent(o.recentUsernames),
  };
}

export function saveSettings(storage: Pick<Storage, "setItem">, s: Settings): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(s));
}
