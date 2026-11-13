import { describe, expect, it } from "vitest";
import { defaultSettings, loadSettings, MAX_RECENT, saveSettings, STORAGE_KEY, withRecent } from "./storage";

function fakeStorage(init?: string) {
  const m = new Map<string, string>();
  if (init !== undefined) m.set(STORAGE_KEY, init);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}

describe("storage", () => {
  it("defaults when empty", () => {
    expect(loadSettings(fakeStorage())).toEqual(defaultSettings());
  });

  it("defaults on corrupt JSON", () => {
    expect(loadSettings(fakeStorage("{"))).toEqual(defaultSettings());
  });

  it("round trip", () => {
    const s = {
      timeControl: { baseMs: 180000, incrementMs: 2000 },
      roi: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 },
      refLeft: Array(1024).fill(0.5),
      refRight: Array(1024).fill(-0.5),
      players: {
        left: { name: "Anna Kovács", rating: 1840, source: { username: "anna_k84", category: "blitz" as const } },
        right: { name: "", rating: null, source: null },
      },
      recentUsernames: ["anna_k84", "bence_plays"],
    };
    const st = fakeStorage();
    saveSettings(st, s);
    expect(loadSettings(st)).toEqual(s);
  });

  it("partial invalid", () => {
    const l = loadSettings(
      fakeStorage(JSON.stringify({ timeControl: { baseMs: -1, incrementMs: 0 }, refLeft: [1, 2, 3] })),
    );
    expect(l.timeControl).toEqual({ baseMs: 300000, incrementMs: 0 });
    expect(l.refLeft).toBeNull();
    expect(l.roi).toBeNull();
  });

  it("tiny ROI rejected", () => {
    const l = loadSettings(fakeStorage(JSON.stringify({ roi: { x: 0, y: 0, w: 0.01, h: 0.5 } })));
    expect(l.roi).toBeNull();
  });

  it("sanitises players", () => {
    const l = loadSettings(fakeStorage(JSON.stringify({
      players: {
        left: { name: 5, rating: 99999, source: { username: "x", category: "blitz" } },
        right: { name: "Bence", rating: 1700, source: { username: "bence", category: "nope" } },
      },
      recentUsernames: ["a", 3, "", "b"],
    })));
    expect(l.players.left).toEqual({ name: "", rating: null, source: null });
    expect(l.players.right).toEqual({ name: "Bence", rating: 1700, source: null });
    expect(l.recentUsernames).toEqual(["a", "b"]);
  });

  it("withRecent moves to front, dedupes ignoring case, caps", () => {
    expect(withRecent(["a_a", "b_b"], "B_b")).toEqual(["B_b", "a_a"]);
    const many = Array.from({ length: MAX_RECENT }, (_, i) => `user${i}`);
    expect(withRecent(many, "new")).toHaveLength(MAX_RECENT);
    expect(withRecent(many, "new")[0]).toBe("new");
  });
});
