import { describe, expect, it } from "vitest";
import { categoryFor, isValidUsername, lookupPlayer, parsePlayer } from "./chesscom";

const tc = (min: number, inc: number) => ({ baseMs: min * 60_000, incrementMs: inc * 1000 });

describe("categoryFor", () => {
  it.each([
    [1, 0, "bullet"],
    [2, 0, "bullet"],
    [3, 0, "blitz"],
    [3, 2, "blitz"],
    [5, 3, "blitz"],
    [9, 0, "blitz"],
    [10, 0, "rapid"],
    [10, 5, "rapid"],
    [15, 10, "rapid"],
    [30, 0, "rapid"],
    [2, 3, "blitz"],
    [1, 2, "bullet"],
  ])("%i+%i is %s", (m, i, c) => {
    expect(categoryFor(tc(m, i))).toBe(c);
  });
});

describe("isValidUsername", () => {
  it("accepts chess.com names and rejects the rest", () => {
    expect(isValidUsername("anna_k84")).toBe(true);
    expect(isValidUsername("a-b")).toBe(true);
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("../etc")).toBe(false);
    expect(isValidUsername("a b c")).toBe(false);
    expect(isValidUsername("x".repeat(26))).toBe(false);
  });
});

const profile = { username: "Anna_K84", name: " Anna Kovács ", country: "https://api.chess.com/pub/country/HU" };
const stats = {
  chess_bullet: { last: { rating: 1652 } },
  chess_blitz: { last: { rating: 1840 } },
  chess_rapid: { last: { rating: 1913 } },
};

describe("parsePlayer", () => {
  it("reads name, country and ratings", () => {
    expect(parsePlayer("anna_k84", profile, stats)).toEqual({
      username: "Anna_K84",
      name: "Anna Kovács",
      country: "HU",
      ratings: { bullet: 1652, blitz: 1840, rapid: 1913, daily: null },
    });
  });
  it("copes with missing stats and name", () => {
    const p = parsePlayer("bob", { username: "bob" }, {});
    expect(p?.name).toBeNull();
    expect(p?.country).toBeNull();
    expect(p?.ratings.blitz).toBeNull();
  });
  it("rejects a non-object profile and ignores junk ratings", () => {
    expect(parsePlayer("x", null, {})).toBeNull();
    expect(parsePlayer("xyz", {}, { chess_blitz: { last: { rating: "high" } } })?.ratings.blitz).toBeNull();
  });
});

function fakeFetch(map: Record<string, { status: number; body?: unknown } | "throw">): typeof fetch {
  return (async (url: string) => {
    const hit = map[url];
    if (hit === undefined || hit === "throw") throw new Error("offline");
    return { status: hit.status, ok: hit.status >= 200 && hit.status < 300, json: async () => hit.body };
  }) as unknown as typeof fetch;
}

describe("lookupPlayer", () => {
  const base = "https://api.chess.com/pub/player/anna_k84";
  it("returns the player", async () => {
    const r = await lookupPlayer(" Anna_K84 ", fakeFetch({
      [base]: { status: 200, body: profile },
      [`${base}/stats`]: { status: 200, body: stats },
    }));
    expect(r.ok && r.player.ratings.blitz).toBe(1840);
  });
  it("still works when stats fail", async () => {
    const r = await lookupPlayer("anna_k84", fakeFetch({
      [base]: { status: 200, body: profile },
      [`${base}/stats`]: { status: 500 },
    }));
    expect(r.ok && r.player.ratings.blitz).toBeNull();
  });
  it("maps 404 to notfound", async () => {
    expect(await lookupPlayer("anna_k84", fakeFetch({ [base]: { status: 404 } }))).toEqual({ ok: false, error: "notfound" });
  });
  it("maps failures to network", async () => {
    expect(await lookupPlayer("anna_k84", fakeFetch({ [base]: "throw" }))).toEqual({ ok: false, error: "network" });
    expect(await lookupPlayer("anna_k84", fakeFetch({ [base]: { status: 429 } }))).toEqual({ ok: false, error: "network" });
  });
  it("rejects bad usernames without a request", async () => {
    const f = (() => { throw new Error("should not be called"); }) as unknown as typeof fetch;
    expect(await lookupPlayer("../x", f)).toEqual({ ok: false, error: "invalid" });
  });
});
