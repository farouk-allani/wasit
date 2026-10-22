import { describe, expect, it } from "vitest";
import { formatBtc, formatDuration, formatMusd, formatRelative } from "./format";

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

describe("formatBtc", () => {
  it("truncates to six decimals by default", () => {
    expect(formatBtc(554_467_745_855_803n)).toBe("0.000554 BTC");
    expect(formatBtc(2n * 10n ** 18n)).toBe("2 BTC");
    expect(formatBtc(0n)).toBe("0 BTC");
  });
});

describe("formatRelative", () => {
  it("says which way and how far", () => {
    expect(formatRelative(1_000n + 240n, 1_000n)).toBe("in 4 min");
    expect(formatRelative(1_000n, 1_000n + 7_200n)).toBe("2 h ago");
    expect(formatRelative(1_030n, 1_000n)).toBe("in under a minute");
    expect(formatRelative(0n, 3n * 86_400n + 3_725n)).toBe("3 days 1 h ago");
  });
});
