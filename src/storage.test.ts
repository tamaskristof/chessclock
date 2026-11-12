import { describe, expect, it } from "vitest";
import { defaultSettings, loadSettings, saveSettings, STORAGE_KEY } from "./storage";

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
      showCamera: false,
    };
    const st = fakeStorage();
    saveSettings(st, s);
    expect(loadSettings(st)).toEqual(s);
  });

  it("partial invalid", () => {
    const l = loadSettings(
      fakeStorage(JSON.stringify({ timeControl: { baseMs: -1, incrementMs: 0 }, showCamera: false, refLeft: [1, 2, 3] })),
    );
    expect(l.timeControl).toEqual({ baseMs: 300000, incrementMs: 0 });
    expect(l.showCamera).toBe(false);
    expect(l.refLeft).toBeNull();
    expect(l.roi).toBeNull();
  });

  it("tiny ROI rejected", () => {
    const l = loadSettings(fakeStorage(JSON.stringify({ roi: { x: 0, y: 0, w: 0.01, h: 0.5 } })));
    expect(l.roi).toBeNull();
  });
});
