import { describe, expect, it } from "vitest";
import { formatTime } from "./format";

describe("formatTime", () => {
  it.each([
    [300000, "5:00.00"],
    [299001, "4:59.00"],
    [65000, "1:05.00"],
    [10000, "10.00"],
    [9999, "9.99"],
    [9890, "9.89"],
    [50, "0.05"],
    [9, "0.00"],
    [0, "0.00"],
    [-5, "0.00"],
    [3599990, "59:59.99"],
    [3600000, "1:00:00.00"],
    [5400000, "1:30:00.00"],
  ])("formatTime(%i) = %s", (input, expected) => {
    expect(formatTime(input)).toBe(expected);
  });
});
