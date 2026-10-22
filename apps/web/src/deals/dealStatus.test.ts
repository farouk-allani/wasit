import { BondSettlement, BondStatus, DealState, type Bond, type Deal } from "@wasit/sdk";
import { zeroAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { dealActions, deadlinesOf, nextStep, rolesOf, type DealSnapshot } from "./dealStatus";

const BUYER: Address = "0xC932A7b94E0C0E9c5dAD3cf9547ad51FB865130b";
const SUPPLIER: Address = "0xAE52F1f55BD606cF385E7EE6D85E7c689D0CCE77";
const AGENT: Address = "0x45Be78315AEc0372011db5c526445eFEB86B65Cf";
const SIGNER: Address = "0xb81e05e23A4b0030173B78A20757Bbe9b749c9e9";
const ARBITER: Address = "0x400b1e116dF4e79b9d34641Dc79175c7BC1aeD36";
const KEEPER: Address = "0x1111111111111111111111111111111111111111";
const T0 = 1_792_000_000n;

function deal(overrides: Partial<Deal> = {}, bonder: Address = AGENT): Deal {
  return {
    terms: {
      buyer: BUYER,
      supplier: SUPPLIER,
      inspector: SIGNER,
      carrier: SIGNER,
      arbiter: ARBITER,
      bonder,
      token: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
      advanceAmount: 30n * 10n ** 18n,
      balanceAmount: 70n * 10n ** 18n,
      feeBps: 50,
      bondRatioBps: bonder === zeroAddress ? 0 : 15_000,
      productionPeriod: 600,
      balanceWindow: 600,
      shippingPeriod: 600,
      challengeWindow: 300,
      arbitrationPeriod: 600,
      termsHash: `0x${"ab".repeat(32)}`,
    },
    state: DealState.Created,
    arbiterAccepted: false,
    attestationNonce: 0,
    bondPending: BondSettlement.None,
    advancePaidAt: 0n,
    readyAt: 0n,
    balanceFundedAt: 0n,
    shippedAt: 0n,
    disputedAt: 0n,
    balanceHeld: 0n,
    advanceFeeHeld: 0n,
    bondClaimAmount: 0n,
    ...overrides,
  };
}

const bond = (status: BondStatus): Bond => ({
  bonder: AGENT,
  oracle: zeroAddress,
  swap: zeroAddress,
  covered: 29_850_000_000_000_000_000n,
  btcHeld: 1n,
  musdHeld: 0n,
  initialRatioBps: 15_000,
  topUpRatioBps: 13_000,
  protectRatioBps: 11_500,
  maxSlippageBps: 600,
  status,
});

const snap = (s: Partial<DealSnapshot> & { deal: Deal }): DealSnapshot => ({
  bond: undefined,
  coverageBps: undefined,
  now: T0,
  account: undefined,
  ...s,
});

const ids = (s: DealSnapshot) => dealActions(s).map((a) => a.id);
const mine = (s: DealSnapshot) =>
  dealActions(s)
    .filter((a) => a.mine)
    .map((a) => a.id);

describe("rolesOf", () => {
  it("finds every role an address holds, case-insensitively", () => {
    expect(rolesOf(deal().terms, SIGNER.toLowerCase() as Address)).toEqual([
      "inspector",
      "carrier",
    ]);
    expect(rolesOf(deal().terms, KEEPER)).toEqual([]);
    expect(rolesOf(deal().terms, undefined)).toEqual([]);
  });

  it("never matches the zero bonder of an unbonded deal", () => {
    expect(rolesOf(deal({}, zeroAddress).terms, zeroAddress)).toEqual([]);
  });
});

describe("deadlinesOf", () => {
  it("counts each deadline from its milestone and leaves later ones open", () => {
    const d = deadlinesOf(
      deal({ state: DealState.GoodsReady, advancePaidAt: T0, readyAt: T0 + 100n }),
    );
    expect(d).toEqual({
      readyBy: T0 + 600n,
      balanceDue: T0 + 700n,
      shipBy: undefined,
      challengeEnds: undefined,
      ruleBy: undefined,
    });
  });
});

describe("dealActions", () => {
  it("before acceptance offers accept, arbiter and bond posting, and cancel", () => {
    const s = snap({ deal: deal() });
    expect(ids(s)).toEqual(["accept", "acceptArbiter", "postBond", "cancel"]);
    expect(mine({ ...s, account: SUPPLIER })).toEqual(["accept", "cancel"]);
    expect(mine({ ...s, account: BUYER })).toEqual(["cancel"]);
    expect(mine({ ...s, account: AGENT })).toEqual(["postBond"]);
    expect(mine({ ...s, account: ARBITER })).toEqual(["acceptArbiter"]);
  });

  it("blocks the advance until the arbiter accepts and the bond covers the ratio", () => {
    const accepted = deal({ state: DealState.Accepted });
    const fund = (s: DealSnapshot) => dealActions(s).find((a) => a.id === "fundAdvance");

    expect(fund(snap({ deal: accepted, account: BUYER }))?.blocked).toMatch(/arbiter/);
    const ready = { ...accepted, arbiterAccepted: true };
    expect(fund(snap({ deal: ready, account: BUYER }))?.blocked).toMatch(/bond/);
    expect(
      fund(snap({ deal: ready, bond: bond(BondStatus.Active), coverageBps: 14_999n }))?.blocked,
    ).toMatch(/bond/);
    expect(
      fund(
        snap({ deal: ready, bond: bond(BondStatus.Active), coverageBps: 15_000n, account: BUYER }),
      ),
    ).toEqual({ id: "fundAdvance", by: "buyer", mine: true, blocked: undefined });
  });

  it("lets an unbonded deal be funded once the arbiter accepted", () => {
    const s = snap({
      deal: deal({ state: DealState.Accepted, arbiterAccepted: true }, zeroAddress),
    });
    expect(ids(s)).toEqual(["fundAdvance", "cancel"]);
  });

  it("offers withdraw and top-up for a live bond before the advance", () => {
    const s = snap({ deal: deal(), bond: bond(BondStatus.Active), coverageBps: 15_100n });
    expect(ids(s)).toEqual(["accept", "acceptArbiter", "withdrawBond", "cancel", "topUp"]);
  });

  it("switches from attesting to a default claim after readyBy", () => {
    const paid = deal({ state: DealState.AdvancePaid, arbiterAccepted: true, advancePaidAt: T0 });
    const live = { bond: bond(BondStatus.Active), coverageBps: 15_000n };
    expect(ids(snap({ deal: paid, ...live, now: T0 + 600n }))).toEqual([
      "attestReady",
      "refundAndCancel",
      "topUp",
    ]);
    expect(ids(snap({ deal: paid, ...live, now: T0 + 601n }))).toEqual([
      "claimSupplierDefault",
      "refundAndCancel",
      "topUp",
    ]);
  });

  it("offers protection only below the protect ratio of an active bond", () => {
    const paid = deal({ state: DealState.AdvancePaid, advancePaidAt: T0 });
    expect(
      ids(snap({ deal: paid, bond: bond(BondStatus.Active), coverageBps: 11_499n })),
    ).toContain("protect");
    expect(
      ids(snap({ deal: paid, bond: bond(BondStatus.Active), coverageBps: 11_500n })),
    ).not.toContain("protect");
    expect(
      ids(snap({ deal: paid, bond: bond(BondStatus.Protected), coverageBps: 9_000n })),
    ).not.toContain("protect");
  });

  it("handles the balance window: fund on time, buyer default after", () => {
    const ready = deal({ state: DealState.GoodsReady, advancePaidAt: T0, readyAt: T0 + 60n });
    expect(ids(snap({ deal: ready, now: T0 + 660n }))).toEqual(["fundBalance", "refundAndCancel"]);
    expect(ids(snap({ deal: ready, now: T0 + 661n }))).toEqual([
      "claimBuyerDefault",
      "refundAndCancel",
    ]);
  });

  it("closes the dispute window at challengeEnds and opens release after it", () => {
    const shipped = deal({ state: DealState.Shipped, shippedAt: T0 });
    expect(ids(snap({ deal: shipped, now: T0 + 300n }))).toEqual(["acceptGoods", "dispute"]);
    expect(ids(snap({ deal: shipped, now: T0 + 301n }))).toEqual(["acceptGoods", "release"]);
  });

  it("lets anyone release a lapsed dispute", () => {
    const disputed = deal({ state: DealState.Disputed, shippedAt: T0, disputedAt: T0 + 10n });
    expect(ids(snap({ deal: disputed, now: T0 + 610n }))).toEqual(["resolve"]);
    expect(mine(snap({ deal: disputed, now: T0 + 611n, account: KEEPER }))).toEqual(["release"]);
  });

  it("offers only a bond retry on a settled deal with a failed bond call", () => {
    const s = snap({
      deal: deal({ state: DealState.SupplierDefaulted, bondPending: BondSettlement.Claim }),
    });
    expect(ids(s)).toEqual(["retryBondSettlement"]);
    expect(ids({ ...s, deal: deal({ state: DealState.Released }) })).toEqual([]);
  });
});

describe("nextStep", () => {
  it("walks the pre-advance checklist in order", () => {
    expect(nextStep(snap({ deal: deal() })).party).toBe("supplier");
    const accepted = deal({ state: DealState.Accepted });
    expect(nextStep(snap({ deal: accepted })).party).toBe("arbiter");
    const arbiterIn = { ...accepted, arbiterAccepted: true };
    expect(nextStep(snap({ deal: arbiterIn })).party).toBe("bonder");
    expect(
      nextStep(snap({ deal: arbiterIn, bond: bond(BondStatus.Active), coverageBps: 15_000n }))
        .party,
    ).toBe("buyer");
  });

  it("carries the deadline and flags it once passed", () => {
    const paid = deal({ state: DealState.AdvancePaid, advancePaidAt: T0 });
    expect(nextStep(snap({ deal: paid, now: T0 + 600n }))).toMatchObject({
      party: "inspector",
      due: T0 + 600n,
      overdue: false,
    });
    expect(nextStep(snap({ deal: paid, now: T0 + 601n })).overdue).toBe(true);
  });

  it("has no party once settled", () => {
    expect(nextStep(snap({ deal: deal({ state: DealState.Released }) }))).toMatchObject({
      party: undefined,
      overdue: false,
    });
  });
});
