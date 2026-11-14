import { getAddress, isAddress } from "viem";
import { describe, expect, it } from "vitest";
import type { DealLog } from "@/data/dealModel";
import { agentsFor, breakEvenVolume, feeOn, isTeam, observe, TEAM, troveCost } from "./model";

const M = 10n ** 18n;
const OUT = "0x1111111111111111111111111111111111111111";
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const log = (eventName: string, args: Record<string, unknown>, n = 1) =>
  ({ eventName, args, transactionHash: tx(n) }) as unknown as DealLog;

describe("team list", () => {
  it("holds valid checksummed addresses", () => {
    for (const a of TEAM) {
      expect(isAddress(a)).toBe(true);
      expect(getAddress(a)).toBe(a);
    }
    expect(isTeam(TEAM[1]!.toLowerCase() as `0x${string}`)).toBe(true);
    expect(isTeam(OUT)).toBe(false);
  });
});

describe("observed fees", () => {
  it("counts released, resolved and buyer-default fees and splits team from outside deals", () => {
    const [buyer, supplier, , , inspector] = TEAM;
    const logs = [
      log("DealCreated", { dealId: 1n, buyer, supplier }),
      log("Attested", { dealId: 1n, signer: inspector }),
      log("AdvanceFunded", {
        dealId: 1n,
        toSupplier: 2985n * 10n ** 16n,
        feeHeld: 15n * 10n ** 16n,
      }),
      log("Released", { dealId: 1n, toSupplier: 995n * 10n ** 17n, fee: 5n * 10n ** 17n }, 2),
      log("DealCreated", { dealId: 2n, buyer, supplier }),
      log("Attested", { dealId: 2n, signer: OUT }),
      log("Released", { dealId: 2n, toSupplier: 995n * M, fee: 5n * M }, 3),
      log("DealCreated", { dealId: 3n, buyer, supplier }),
      log("BuyerDefaulted", { dealId: 3n, fee: 15n * 10n ** 16n }, 4),
      log("DealCreated", { dealId: 4n, buyer, supplier }),
      log("SupplierDefaulted", { dealId: 4n, refundedToBuyer: 30n * M, bondClaimRequested: 0n }),
    ];
    const o = observe(logs);
    expect(o.deals).toBe(4);
    expect(o.rows.map((r) => r.dealId)).toEqual([1n, 2n, 3n]);
    expect(o.team).toEqual({
      settled: 995n * 10n ** 17n + 2985n * 10n ** 16n,
      fees: 5n * 10n ** 17n + 15n * 10n ** 16n,
      count: 2,
    });
    expect(o.outside).toEqual({ settled: 995n * M, fees: 5n * M, count: 1 });
    expect(o.rows.find((r) => r.dealId === 2n)?.tx).toBe(tx(3));
  });

  it("finds no outside deal when every actor is a team wallet", () => {
    const o = observe([log("DealCreated", { dealId: 9n, buyer: TEAM[1], supplier: TEAM[2] })]);
    expect(o.outside.count).toBe(0);
    expect(o.rows).toEqual([]);
  });
});

describe("model arithmetic", () => {
  it("takes the fee on settled value", () => {
    expect(feeOn(3_000n * M, 50n)).toBe(15n * M);
  });

  it("finds the break-even volume and the agents it takes", () => {
    expect(breakEvenVolume(300n * M, 50n)).toBe(60_000n * M);
    expect(breakEvenVolume(1_500n * M, 50n)).toBe(300_000n * M);
    expect(agentsFor(60_000n * M, 20_000n * M, 10n)).toBe(1n);
    expect(agentsFor(300_000n * M, 3_000n * M, 2n)).toBe(50n);
  });

  it("prices a trove bond like the live system: fee plus interest on the composite debt", () => {
    // 30 days on a 1,800 draw: 1.8 + 2,001.8 x 1% x 30/365 = 3.4453; the fork test measured 3.4442
    const cost = troveCost(1_800n * M, 30n);
    expect(cost).toBeGreaterThan(344n * 10n ** 16n);
    expect(cost).toBeLessThan(345n * 10n ** 16n);
  });
});
