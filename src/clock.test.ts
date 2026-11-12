import { describe, expect, it } from "vitest";
import { boardToActive, createClock, currentRemaining, detectEvents, pause, resume, start, switchTo, tick } from "./clock";

const TC = { baseMs: 60_000, incrementMs: 2_000 };
const TC0 = { baseMs: 60_000, incrementMs: 0 };

describe("clock", () => {
  it("createClock", () => {
    const c = createClock(TC);
    expect(c.status).toBe("idle");
    expect(c.remainingMs).toEqual({ left: 60000, right: 60000 });
    expect(c.active).toBeNull();
    expect(c.lastTick).toBeNull();
    expect(c.flagged).toBeNull();
    expect(c.lowTimeWarned).toEqual({ left: false, right: false });
  });

  it("start", () => {
    const s = start(createClock(TC), "left", 1000);
    expect(s.status).toBe("running");
    expect(s.active).toBe("left");
    expect(s.lastTick).toBe(1000);
    expect(start(s, "right", 2000)).toBe(s);
  });

  it("currentRemaining", () => {
    const s = start(createClock(TC), "left", 1000);
    expect(currentRemaining(s, 4000)).toEqual({ left: 57000, right: 60000 });
    expect(s.remainingMs.left).toBe(60000);
  });

  it("switchTo with increment", () => {
    const s = start(createClock(TC), "left", 1000);
    const n = switchTo(s, "right", 11000, TC);
    expect(n.remainingMs.left).toBe(52000);
    expect(n.active).toBe("right");
    expect(n.lastTick).toBe(11000);
    expect(currentRemaining(n, 12000).right).toBe(59000);
  });

  it("switchTo same side", () => {
    const s = start(createClock(TC), "left", 1000);
    expect(switchTo(s, "left", 5000, TC)).toBe(s);
  });

  it("backdated before lastTick", () => {
    const s = start(createClock(TC), "left", 1000);
    const n = switchTo(s, "right", 500, TC);
    expect(n.remainingMs.left).toBe(62000);
    expect(n.lastTick).toBe(1000);
  });

  it("switchTo when paused", () => {
    const p = pause(start(createClock(TC), "left", 0), 1000);
    expect(switchTo(p, "right", 2000, TC)).toBe(p);
  });

  it("tick flags", () => {
    const s = start(createClock(TC0), "left", 0);
    const n = tick(s, 60000);
    expect(n.status).toBe("flagged");
    expect(n.flagged).toBe("left");
    expect(n.remainingMs.left).toBe(0);
    expect(detectEvents(s, n)).toEqual([{ type: "flag", side: "left" }]);
  });

  it("tick low-time", () => {
    const s = start(createClock(TC0), "left", 0);
    const n = tick(s, 50001);
    expect(n.lowTimeWarned.left).toBe(true);
    expect(detectEvents(s, n)).toEqual([{ type: "lowTime", side: "left" }]);
    expect(tick(n, 50100)).toBe(n);
  });

  it("switchTo flags", () => {
    const s = start(createClock(TC), "left", 0);
    const n = switchTo(s, "right", 61000, TC);
    expect(n.status).toBe("flagged");
    expect(n.flagged).toBe("left");
    expect(n.remainingMs.left).toBe(0);
  });

  it("pause/resume", () => {
    const s = start(createClock(TC0), "left", 0);
    const p = pause(s, 5000);
    expect(p.status).toBe("paused");
    expect(p.remainingMs.left).toBe(55000);
    expect(p.lastTick).toBeNull();
    expect(currentRemaining(p, 99999).left).toBe(55000);
    const r = resume(p, "right", 10000);
    expect(r.status).toBe("running");
    expect(r.active).toBe("right");
    expect(r.lastTick).toBe(10000);
  });

  it("boardToActive", () => {
    expect(boardToActive("left")).toBe("right");
    expect(boardToActive("right")).toBe("left");
  });
});
