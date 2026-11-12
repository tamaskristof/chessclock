import { describe, expect, it } from "vitest";
import { containRect, isValidRoi, normToScreen, rectFromPoints, toNormalizedPoint, type Rect } from "./geometry";

function expectRect(r: Rect, e: Rect): void {
  expect(r.x).toBeCloseTo(e.x, 2);
  expect(r.y).toBeCloseTo(e.y, 2);
  expect(r.w).toBeCloseTo(e.w, 2);
  expect(r.h).toBeCloseTo(e.h, 2);
}

describe("geometry", () => {
  const c = containRect(1000, 500, 320, 240);

  it("containRect landscape box", () => {
    expectRect(c, { x: 166.67, y: 0, w: 666.67, h: 500 });
  });

  it("containRect portrait box", () => {
    expectRect(containRect(500, 1000, 320, 240), { x: 0, y: 312.5, w: 500, h: 375 });
  });

  it("toNormalizedPoint", () => {
    const a = toNormalizedPoint(166.67, 0, c);
    expect(a.x).toBeCloseTo(0, 2);
    expect(a.y).toBeCloseTo(0, 2);
    const b = toNormalizedPoint(500, 250, c);
    expect(b.x).toBeCloseTo(0.5, 2);
    expect(b.y).toBeCloseTo(0.5, 2);
    const d = toNormalizedPoint(1000, 600, c);
    expect(d.x).toBeCloseTo(1, 2);
    expect(d.y).toBeCloseTo(1, 2);
  });

  it("rectFromPoints", () => {
    expectRect(rectFromPoints({ x: 0.5, y: 0.6 }, { x: 0.2, y: 0.1 }), { x: 0.2, y: 0.1, w: 0.3, h: 0.5 });
  });

  it("normToScreen", () => {
    expectRect(normToScreen({ x: 0.5, y: 0.5, w: 0.25, h: 0.5 }, c), { x: 500, y: 250, w: 166.67, h: 250 });
  });

  it("isValidRoi", () => {
    expect(isValidRoi({ x: 0, y: 0, w: 0.04, h: 0.5 })).toBe(false);
    expect(isValidRoi({ x: 0.1, y: 0.1, w: 0.3, h: 0.3 })).toBe(true);
    expect(isValidRoi({ x: 0.9, y: 0, w: 0.2, h: 0.5 })).toBe(false);
  });
});
