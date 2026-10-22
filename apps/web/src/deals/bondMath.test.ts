import { describe, expect, it } from "vitest";
import { btcForCoverage, coverageOf, withMargin } from "./bondMath";

const e18 = 10n ** 18n;
const COVERED = 29_850_000_000_000_000_000n; // net advance of the seeded deals
const PRICE = 80_000n * e18;

describe("coverageOf", () => {
  it("values BTC at the price plus any MUSD held", () => {
    expect(coverageOf(e18 / 2_000n, 0n, 40n * e18, PRICE)).toBe(10_000n); // 40 MUSD of BTC
    expect(coverageOf(0n, 41n * e18, 41n * e18, PRICE)).toBe(10_000n);
    expect(coverageOf(1n, 0n, 0n, PRICE)).toBe(0n);
  });
});

describe("btcForCoverage", () => {
  it("is the smallest amount reaching the ratio", () => {
    for (const ratio of [12_000n, 15_000n, 50_000n]) {
      for (const price of [PRICE, 68_123n * e18 + 7n, 1n * e18]) {
        const btc = btcForCoverage(COVERED, ratio, price);
        expect(coverageOf(btc, 0n, COVERED, price)).toBeGreaterThanOrEqual(ratio);
        expect(coverageOf(btc - 2n * (e18 / price + 1n), 0n, COVERED, price)).toBeLessThan(ratio);
      }
    }
  });

  it("suggests one percent more", () => {
    expect(withMargin(1_000n)).toBe(1_010n);
  });
});
