import { describe, expect, it } from "vitest";
import { signalLabel, signalLevel } from "./calibration";

describe("signalLevel", () => {
  it("is 0 when ambiguous", () => {
    expect(signalLevel(0.5, 0.5)).toBe(0);
    expect(signalLevel(0.45, 0.5)).toBe(0);
    expect(signalLevel(0, 0)).toBe(0);
  });
  it("rises as one reference clearly wins", () => {
    expect(signalLevel(0.1, 0.5)).toBeGreaterThan(signalLevel(0.35, 0.5));
    expect(signalLevel(0, 0.5)).toBe(5);
    expect(signalLevel(0.5, 0.05)).toBe(5);
  });
  it("labels", () => {
    expect(signalLabel(5)).toBe("Signal clear");
    expect(signalLabel(1)).toBe("Signal weak");
    expect(signalLabel(0)).toBe("No signal");
  });
});
