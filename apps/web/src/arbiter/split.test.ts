import type { Deal } from "@wasit/sdk";
import { describe, expect, it } from "vitest";
import { splitPreview } from "./split";

const e18 = 10n ** 18n;
// The seeded shape: 30 MUSD advance (0.15 fee held), 70 MUSD balance, 50 bps
const deal = {
  balanceHeld: 70n * e18,
  advanceFeeHeld: 15n * 10n ** 16n,
  terms: { advanceAmount: 30n * e18, feeBps: 50 },
} as unknown as Deal;

describe("splitPreview", () => {
  it("all to the supplier: fee on the share, advance fee earned", () => {
    expect(splitPreview(deal, 10_000, 0)).toEqual({
      toSupplier: 69_650_000_000_000_000_000n,
      toBuyer: 0n,
      claimAmount: 0n,
      earned: 350_000_000_000_000_000n + 150_000_000_000_000_000n,
    });
  });

  it("all to the buyer with the full advance back: no fee at all", () => {
    expect(splitPreview(deal, 0, 10_000)).toEqual({
      toSupplier: 0n,
      toBuyer: 70_150_000_000_000_000_000n,
      claimAmount: 29_850_000_000_000_000_000n,
      earned: 0n,
    });
  });

  it("conserves the escrowed money for any split", () => {
    for (const s of [0, 1, 3_333, 5_000, 9_999, 10_000])
      for (const r of [0, 1, 2_500, 7_777, 10_000]) {
        const p = splitPreview(deal, s, r);
        expect(p.toSupplier + p.toBuyer + p.earned).toBe(deal.balanceHeld + deal.advanceFeeHeld);
        expect(p.earned).toBeGreaterThanOrEqual(0n);
      }
  });

  it("rounds refunds up", () => {
    const p = splitPreview({ ...deal, advanceFeeHeld: 3n }, 0, 5_000);
    expect(p.toBuyer - deal.balanceHeld).toBe(2n); // ⌈3 × 0.5⌉
  });
});
