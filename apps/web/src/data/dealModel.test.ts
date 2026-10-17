import { AttestationKind, BondSettlement, BondStatus, DealState } from "@wasit/sdk";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { reduceDeals, type DealLog } from "./dealModel";

const e18 = (v: number) => BigInt(Math.round(v * 1e6)) * 10n ** 12n;
const BUYER: Address = "0xC932A7b94E0C0E9c5dAD3cf9547ad51FB865130b";
const SUPPLIER: Address = "0xAE52F1f55BD606cF385E7EE6D85E7c689D0CCE77";
const AGENT: Address = "0x45Be78315AEc0372011db5c526445eFEB86B65Cf";
const SIGNER: Address = "0xb81e05e23A4b0030173B78A20757Bbe9b749c9e9";
const MUSD: Address = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
const HASH: Hex = `0x${"ab".repeat(32)}`;
const BOND_BTC = 554_467_745_855_803n; // posted on live deal #2

/** Builds a log in chain order; only the fields the reducer reads are meaningful. */
function chain() {
  let block = 100n;
  let index = 0;
  return <N extends DealLog["eventName"]>(
    eventName: N,
    args: Extract<DealLog, { eventName: N }>["args"],
  ): DealLog => {
    block += 1n;
    const tx: Hex = `0x${block.toString(16).padStart(64, "0")}`;
    return {
      eventName,
      args,
      blockNumber: block,
      logIndex: index++,
      transactionHash: tx,
      blockTimestamp: 1_792_000_000n + block,
    } as unknown as DealLog;
  };
}

/** Created, accepted by supplier and arbiter, bonded and advance paid: 30 MUSD at 50 bps. */
function opened(id: bigint) {
  const log = chain();
  const logs = [
    log("DealCreated", {
      dealId: id,
      buyer: BUYER,
      supplier: SUPPLIER,
      token: MUSD,
      advanceAmount: e18(30),
      balanceAmount: e18(70),
      termsHash: HASH,
    }),
    log("DealAccepted", { dealId: id, supplier: SUPPLIER }),
    log("ArbiterAccepted", { dealId: id, arbiter: SIGNER }),
    log("BondPosted", { dealId: id, bonder: AGENT, btcAmount: BOND_BTC, coverageBps: 15_150n }),
    log("AdvanceFunded", { dealId: id, toSupplier: e18(29.85), feeHeld: e18(0.15) }),
  ];
  return { log, logs };
}

const attested = (kind: AttestationKind, id: bigint) => ({
  dealId: id,
  kind,
  signer: SIGNER,
  evidenceHash: HASH,
  issuedAt: 1_792_000_000n,
});

describe("reduceDeals", () => {
  it("follows the happy path to Released with exact money", () => {
    const { log, logs } = opened(2n);
    const before = [
      ...logs,
      log("Attested", attested(AttestationKind.ReadyInspected, 2n)),
      log("BalanceFunded", { dealId: 2n, amount: e18(70) }),
    ];
    expect(reduceDeals(before).get(2n)).toMatchObject({
      state: DealState.BalanceFunded,
      escrowed: e18(70.15),
    });

    const after = [
      ...before,
      log("Attested", attested(AttestationKind.Shipped, 2n)),
      log("Released", { dealId: 2n, toSupplier: e18(69.65), fee: e18(0.5) }),
      log("BondReleased", { dealId: 2n, bonder: AGENT, btcReturned: BOND_BTC, musdReturned: 0n }),
      log("BondSettled", { dealId: 2n, action: BondSettlement.Release, paid: 0n }),
    ];
    const deal = reduceDeals(after).get(2n);
    expect(deal).toMatchObject({
      state: DealState.Released,
      arbiterAccepted: true,
      escrowed: 0n,
      paidToSupplier: e18(99.5),
      refundedToBuyer: 0n,
      fees: e18(0.5),
      bondPending: BondSettlement.None,
      bond: { status: BondStatus.Released, btcHeld: 0n, musdHeld: 0n, shortfall: 0n },
    });
    expect(deal?.timeline).toHaveLength(after.length);
    expect(deal?.timeline.filter((t) => t.attestation).map((t) => t.attestation?.kind)).toEqual([
      AttestationKind.ReadyInspected,
      AttestationKind.Shipped,
    ]);
    expect(deal?.ledger.find((l) => l.label === "Bond BTC returned to the bonder")).toMatchObject({
      asset: "BTC",
      amount: BOND_BTC,
    });
  });

  it("refunds the buyer from escrow and bond on supplier default, keeping Claimed after leftovers", () => {
    const { log, logs } = opened(3n);
    const deal = reduceDeals([
      ...logs,
      log("SupplierDefaulted", {
        dealId: 3n,
        refundedToBuyer: e18(0.15),
        bondClaimRequested: e18(29.85),
      }),
      log("BondClaimed", { dealId: 3n, to: BUYER, requested: e18(29.85), paid: e18(29.85) }),
      log("BondReleased", {
        dealId: 3n,
        bonder: AGENT,
        btcReturned: 165_085_307_130_473n,
        musdReturned: e18(0.79),
      }),
      log("BondSettled", { dealId: 3n, action: BondSettlement.Claim, paid: e18(29.85) }),
    ]).get(3n);
    expect(deal).toMatchObject({
      state: DealState.SupplierDefaulted,
      escrowed: 0n,
      refundedToBuyer: e18(30),
      paidToSupplier: e18(29.85),
      bond: { status: BondStatus.Claimed, btcHeld: 0n, musdHeld: 0n, shortfall: 0n },
    });
  });

  it("reports a bond shortfall", () => {
    const { log, logs } = opened(4n);
    const deal = reduceDeals([
      ...logs,
      log("SupplierDefaulted", {
        dealId: 4n,
        refundedToBuyer: e18(0.15),
        bondClaimRequested: e18(29.85),
      }),
      log("BondClaimed", { dealId: 4n, to: BUYER, requested: e18(29.85), paid: e18(20) }),
      log("BondShortfall", { dealId: 4n, requested: e18(29.85), paid: e18(20) }),
    ]).get(4n);
    expect(deal?.refundedToBuyer).toBe(e18(20.15));
    expect(deal?.bond.shortfall).toBe(e18(9.85));
  });

  it("tracks a protected bond while the advance is outstanding", () => {
    const { log, logs } = opened(1n);
    const deal = reduceDeals([
      ...logs,
      log("BondProtected", {
        dealId: 1n,
        btcSold: 529_255_319_148_937n,
        musdReceived: e18(41.66),
        coverageBefore: 11_362n,
      }),
    ]).get(1n);
    expect(deal).toMatchObject({
      state: DealState.AdvancePaid,
      escrowed: e18(0.15),
      bond: {
        status: BondStatus.Protected,
        btcHeld: BOND_BTC - 529_255_319_148_937n,
        musdHeld: e18(41.66),
        lastCoverageBps: 11_362n,
      },
    });
  });

  it("marks a failed bond settlement as pending until a retry succeeds", () => {
    const { log, logs } = opened(5n);
    const failed = [
      ...logs,
      log("SupplierDefaulted", {
        dealId: 5n,
        refundedToBuyer: e18(0.15),
        bondClaimRequested: e18(29.85),
      }),
      log("BondSettlementFailed", { dealId: 5n, action: BondSettlement.Claim, reason: "0x" }),
    ];
    expect(reduceDeals(failed).get(5n)?.bondPending).toBe(BondSettlement.Claim);
    const retried = [
      ...failed,
      log("BondClaimed", { dealId: 5n, to: BUYER, requested: e18(29.85), paid: e18(29.85) }),
      log("BondSettled", { dealId: 5n, action: BondSettlement.Claim, paid: e18(29.85) }),
    ];
    expect(reduceDeals(retried).get(5n)?.bondPending).toBe(BondSettlement.None);
  });

  it("refunds on cancel and sorts logs into chain order", () => {
    const { log, logs } = opened(6n);
    const all = [
      ...logs,
      log("DealCancelled", { dealId: 6n, by: SUPPLIER, refundedToBuyer: e18(30) }),
    ];
    const deal = reduceDeals([...all].reverse()).get(6n);
    expect(deal?.state).toBe(DealState.Cancelled);
    expect(deal?.escrowed).toBe(0n);
    expect(deal?.refundedToBuyer).toBe(e18(30));
    expect(deal?.timeline.map((t) => t.event)).toEqual(all.map((l) => l.eventName));
  });

  it("ignores config events and logs of unknown deals", () => {
    const log = chain();
    const deals = reduceDeals([
      log("DefaultFeeSet", { feeBps: 50 }),
      log("AdvanceFunded", { dealId: 9n, toSupplier: 1n, feeHeld: 1n }),
    ]);
    expect(deals.size).toBe(0);
  });
});
