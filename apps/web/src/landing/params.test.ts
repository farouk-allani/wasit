import { describe, expect, it } from "vitest";
import { exampleDeal, params, usd } from "./params";

describe("landing worked example", () => {
  it("follows the money table: fee only on value kept by the supplier", () => {
    expect(params.feeBps).toBe(50n);
    const deal = exampleDeal(10_000n, 3_000n, 15_000n);
    expect(deal).toEqual({
      advance: 3_000n,
      balance: 7_000n,
      advanceFee: 15n,
      netAdvance: 2_985n,
      bondValue: 4_477n,
      toSupplierOnRelease: 6_965n,
      totalFee: 50n,
    });
    expect(deal.netAdvance + deal.toSupplierOnRelease + deal.totalFee).toBe(10_000n);
  });

  it("formats whole dollars", () => {
    expect(usd(4_477n)).toBe("$4,477");
  });
});
