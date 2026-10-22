import { describe, expect, it } from "vitest";
import { formatDuration, formatMusd } from "./format";

const musd = 10n ** 18n;

describe("formatMusd", () => {
  it("groups thousands and truncates decimals", () => {
    expect(formatMusd(1_234_567n * musd)).toBe("1,234,567 MUSD");
    expect(formatMusd(1_999n * musd + musd - 1n)).toBe("1,999.99 MUSD");
    expect(formatMusd(15n * (musd / 10n))).toBe("1.5 MUSD");
    expect(formatMusd(1n, 18)).toBe("0.000000000000000001 MUSD");
  });
});

describe("formatDuration", () => {
  it("uses the largest whole units", () => {
    expect(formatDuration(14 * 86_400)).toBe("14 days");
    expect(formatDuration(86_400 + 2 * 3_600 + 30 * 60)).toBe("1 day 2 h 30 min");
    expect(formatDuration(60)).toBe("1 min");
  });
});
