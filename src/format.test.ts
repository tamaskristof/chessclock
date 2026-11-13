import { describe, expect, it } from "vitest";
import { clockWidthEm, formatClock, formatTime } from "./format";

describe("formatTime", () => {
  it.each([
    [300000, "5:00"],
    [299001, "4:59"],
    [65000, "1:05"],
    [20000, "0:20"],
    [19999, "19.99"],
    [10000, "10.00"],
    [9999, "9.99"],
    [9890, "9.89"],
    [50, "0.05"],
    [9, "0.00"],
    [0, "0.00"],
    [-5, "0.00"],
    [3599990, "59:59"],
    [3600000, "1:00:00"],
    [5400000, "1:30:00"],
  ])("formatTime(%i) = %s", (input, expected) => {
    expect(formatTime(input)).toBe(expected);
  });
});

describe("formatClock", () => {
  it("splits hundredths off under 20 s", () => {
    expect(formatClock(7040)).toEqual({ main: "7", frac: ".04" });
    expect(formatClock(0)).toEqual({ main: "0", frac: ".00" });
  });
  it("has no fraction at 20 s and above", () => {
    expect(formatClock(20000)).toEqual({ main: "0:20", frac: null });
  });
});

describe("clockWidthEm", () => {
  it("grows with length", () => {
    const short = clockWidthEm(formatClock(299000));
    const long = clockWidthEm(formatClock(5_400_000));
    expect(long).toBeGreaterThan(short);
    expect(clockWidthEm(formatClock(7040))).toBeGreaterThan(0.5);
  });
});
