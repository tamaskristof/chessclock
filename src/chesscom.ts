import type { TimeControl } from "./clock";

export type Category = "bullet" | "blitz" | "rapid" | "daily";
export const CATEGORIES: readonly Category[] = ["bullet", "blitz", "rapid", "daily"];

export interface ChessComPlayer {
  username: string;
  name: string | null;
  /** ISO 3166 country code, e.g. "HU". */
  country: string | null;
  ratings: Record<Category, number | null>;
}

export type LookupResult =
  | { ok: true; player: ChessComPlayer }
  | { ok: false; error: "invalid" | "notfound" | "network" };

const API = "https://api.chess.com/pub/player";
const USERNAME_RE = /^[A-Za-z0-9_-]{3,25}$/;

export function isValidUsername(u: string): boolean {
  return USERNAME_RE.test(u);
}

/** chess.com's own rule: minutes + 40 x increment seconds. Under 3 min bullet, under 10 min blitz, else rapid. */
export function categoryFor(tc: TimeControl): Exclude<Category, "daily"> {
  const seconds = tc.baseMs / 1000 + 40 * (tc.incrementMs / 1000);
  if (seconds < 180) return "bullet";
  if (seconds < 600) return "blitz";
  return "rapid";
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function lastRating(stats: Record<string, unknown>, key: string): number | null {
  const mode = stats[key];
  if (!isObj(mode) || !isObj(mode.last)) return null;
  const r = mode.last.rating;
  return typeof r === "number" && Number.isFinite(r) && r > 0 && r <= 4000 ? Math.round(r) : null;
}

export function parsePlayer(username: string, profile: unknown, stats: unknown): ChessComPlayer | null {
  if (!isObj(profile)) return null;
  const s = isObj(stats) ? stats : {};
  const name = typeof profile.name === "string" && profile.name.trim() ? profile.name.trim().slice(0, 60) : null;
  const countryUrl = typeof profile.country === "string" ? profile.country : "";
  const code = /\/([A-Z]{2})$/.exec(countryUrl)?.[1] ?? null;
  const canonical = typeof profile.username === "string" && profile.username ? profile.username : username;
  return {
    username: canonical,
    name,
    country: code,
    ratings: {
      bullet: lastRating(s, "chess_bullet"),
      blitz: lastRating(s, "chess_blitz"),
      rapid: lastRating(s, "chess_rapid"),
      daily: lastRating(s, "chess_daily"),
    },
  };
}

export function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Looks up an exact username on chess.com's public API: profile, then ratings. */
export async function lookupPlayer(
  raw: string,
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<LookupResult> {
  const username = raw.trim();
  if (!isValidUsername(username)) return { ok: false, error: "invalid" };
  const base = `${API}/${encodeURIComponent(username.toLowerCase())}`;
  try {
    const p = await fetchFn(base);
    if (p.status === 404) return { ok: false, error: "notfound" };
    if (!p.ok) return { ok: false, error: "network" };
    const profile: unknown = await p.json();
    let stats: unknown = {};
    const s = await fetchFn(`${base}/stats`);
    if (s.ok) stats = await s.json();
    const player = parsePlayer(username, profile, stats);
    return player ? { ok: true, player } : { ok: false, error: "network" };
  } catch {
    return { ok: false, error: "network" };
  }
}
