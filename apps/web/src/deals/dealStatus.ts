import { BondSettlement, BondStatus, DealState, type Bond, type Deal } from "@wasit/sdk";
import { isAddressEqual, zeroAddress, type Address } from "viem";

export type Role = "buyer" | "supplier" | "bonder" | "inspector" | "carrier" | "arbiter";

/** Every role the account holds in the deal (one address can hold several, e.g. inspector + carrier). */
export function rolesOf(terms: Deal["terms"], account: Address | undefined): Role[] {
  if (!account) return [];
  const named: [Role, Address][] = [
    ["buyer", terms.buyer],
    ["supplier", terms.supplier],
    ["bonder", terms.bonder],
    ["inspector", terms.inspector],
    ["carrier", terms.carrier],
    ["arbiter", terms.arbiter],
  ];
  return named.filter(([, a]) => a !== zeroAddress && isAddressEqual(a, account)).map(([r]) => r);
}

/** Absolute deadlines (ARCHITECTURE §3, ADR-017); undefined until the milestone they count from. */
export interface Deadlines {
  readyBy?: bigint;
  balanceDue?: bigint;
  shipBy?: bigint;
  challengeEnds?: bigint;
  ruleBy?: bigint;
}

const after = (start: bigint, period: number) => (start > 0n ? start + BigInt(period) : undefined);

export function deadlinesOf(deal: Deal): Deadlines {
  const t = deal.terms;
  return {
    readyBy: after(deal.advancePaidAt, t.productionPeriod),
    balanceDue: after(deal.readyAt, t.balanceWindow),
    shipBy: after(deal.balanceFundedAt, t.shippingPeriod),
    challengeEnds: after(deal.shippedAt, t.challengeWindow),
    ruleBy: after(deal.disputedAt, t.arbitrationPeriod),
  };
}

export type ActionId =
  | "accept"
  | "acceptArbiter"
  | "postBond"
  | "withdrawBond"
  | "cancel"
  | "fundAdvance"
  | "attestReady"
  | "fundBalance"
  | "attestShipped"
  | "acceptGoods"
  | "dispute"
  | "resolve"
  | "release"
  | "claimSupplierDefault"
  | "claimBuyerDefault"
  | "refundAndCancel"
  | "topUp"
  | "protect"
  | "retryBondSettlement";

export interface DealAction {
  id: ActionId;
  /** Who the contract lets send it; "anyone" for keeper calls. */
  by: Role | "anyone";
  /** True when the connected account may send it. */
  mine: boolean;
  /** The account may send it, but a precondition is missing; the reason is shown instead. */
  blocked?: string;
}

export interface DealSnapshot {
  deal: Deal;
  bond: Bond | undefined;
  /** Live coverage in bps; undefined when there is no live bond or the price read failed. */
  coverageBps: bigint | undefined;
  /** Unix seconds. */
  now: bigint;
  account: Address | undefined;
}

const liveBond = (bond: Bond | undefined) =>
  bond?.status === BondStatus.Active || bond?.status === BondStatus.Protected;

const hasBond = (deal: Deal) => deal.terms.bonder !== zeroAddress;

/**
 * What can be done on the deal right now, mirroring the guards in WasitEscrow and AdvanceBond so
 * the page only offers calls the contracts will accept (they still simulate before signing).
 */
export function dealActions({ deal, bond, coverageBps, now, account }: DealSnapshot): DealAction[] {
  const roles = rolesOf(deal.terms, account);
  const d = deadlinesOf(deal);
  const out: DealAction[] = [];
  const add = (id: ActionId, by: DealAction["by"], blocked?: string) =>
    out.push({ id, by, mine: by === "anyone" || roles.includes(by), blocked });
  const open = (deadline: bigint | undefined) => deadline !== undefined && now <= deadline;
  const passed = (deadline: bigint | undefined) => deadline !== undefined && now > deadline;

  switch (deal.state) {
    case DealState.Created:
    case DealState.Accepted: {
      if (deal.state === DealState.Created) add("accept", "supplier");
      if (!deal.arbiterAccepted) add("acceptArbiter", "arbiter");
      if (hasBond(deal) && !liveBond(bond)) add("postBond", "bonder");
      if (deal.state === DealState.Accepted) {
        const bondReady =
          !hasBond(deal) ||
          (bond?.status === BondStatus.Active &&
            coverageBps !== undefined &&
            coverageBps >= BigInt(deal.terms.bondRatioBps));
        add(
          "fundAdvance",
          "buyer",
          !deal.arbiterAccepted
            ? "The arbiter has not accepted the role yet."
            : !bondReady
              ? "The BTC bond is not posted at the required coverage yet."
              : undefined,
        );
      }
      if (bond?.status === BondStatus.Active) add("withdrawBond", "bonder");
      add("cancel", roles.includes("supplier") ? "supplier" : "buyer");
      break;
    }
    case DealState.AdvancePaid:
      if (open(d.readyBy)) add("attestReady", "inspector");
      if (passed(d.readyBy)) add("claimSupplierDefault", "anyone");
      add("refundAndCancel", "supplier");
      break;
    case DealState.GoodsReady:
      if (open(d.balanceDue)) add("fundBalance", "buyer");
      if (passed(d.balanceDue)) add("claimBuyerDefault", "anyone");
      add("refundAndCancel", "supplier");
      break;
    case DealState.BalanceFunded:
      if (open(d.shipBy)) add("attestShipped", "carrier");
      if (passed(d.shipBy)) add("claimSupplierDefault", "anyone");
      add("refundAndCancel", "supplier");
      break;
    case DealState.Shipped:
      add("acceptGoods", "buyer");
      if (open(d.challengeEnds)) add("dispute", "buyer");
      if (passed(d.challengeEnds)) add("release", "anyone");
      break;
    case DealState.Disputed:
      if (open(d.ruleBy)) add("resolve", "arbiter");
      if (passed(d.ruleBy)) add("release", "anyone");
      break;
  }

  const outstanding = deal.state >= DealState.AdvancePaid && deal.state <= DealState.Disputed;
  if (liveBond(bond) && (outstanding || deal.state <= DealState.Accepted)) add("topUp", "anyone");
  if (
    outstanding &&
    bond?.status === BondStatus.Active &&
    coverageBps !== undefined &&
    coverageBps < BigInt(bond.protectRatioBps)
  )
    add("protect", "anyone");
  if (deal.bondPending !== BondSettlement.None) add("retryBondSettlement", "anyone");
  return out;
}

export interface NextStep {
  /** Who the deal waits on; undefined once it is settled. */
  party: Role | "anyone" | undefined;
  title: string;
  /** Deadline for that step, if one applies. */
  due?: bigint;
  /** The deadline has passed and the deal can now be closed by a default claim or release. */
  overdue: boolean;
}

const SETTLED: Partial<Record<DealState, string>> = {
  [DealState.Released]: "Settled: the balance was released to the supplier.",
  [DealState.Resolved]: "Settled by the arbiter's ruling.",
  [DealState.SupplierDefaulted]:
    "Closed: the supplier missed a deadline and the buyer was refunded.",
  [DealState.BuyerDefaulted]: "Closed: the buyer did not fund the balance in time.",
  [DealState.Cancelled]: "Cancelled.",
};

/** One line on who must act next and by when, for the top of the deal page. */
export function nextStep({ deal, bond, coverageBps, now }: DealSnapshot): NextStep {
  const d = deadlinesOf(deal);
  const step = (party: NextStep["party"], title: string, due?: bigint): NextStep => ({
    party,
    title,
    due,
    overdue: due !== undefined && now > due,
  });
  const bondShort =
    hasBond(deal) &&
    !(
      bond?.status === BondStatus.Active &&
      coverageBps !== undefined &&
      coverageBps >= BigInt(deal.terms.bondRatioBps)
    );

  switch (deal.state) {
    case DealState.Created:
      return step("supplier", "Waiting for the supplier to accept the terms.");
    case DealState.Accepted:
      if (!deal.arbiterAccepted)
        return step("arbiter", "Waiting for the arbiter to accept the role.");
      if (bondShort) return step("bonder", "Waiting for the BTC bond to be posted.");
      return step("buyer", "Ready for the buyer to pay the advance.");
    case DealState.AdvancePaid:
      return step(
        "inspector",
        "In production: waiting for the inspector to sign goods ready.",
        d.readyBy,
      );
    case DealState.GoodsReady:
      return step(
        "buyer",
        "Goods inspected: waiting for the buyer to fund the balance.",
        d.balanceDue,
      );
    case DealState.BalanceFunded:
      return step(
        "carrier",
        "Balance in escrow: waiting for the carrier to sign shipment.",
        d.shipBy,
      );
    case DealState.Shipped:
      return step(
        "buyer",
        "Shipped: the buyer can accept or dispute until the window ends.",
        d.challengeEnds,
      );
    case DealState.Disputed:
      return step("arbiter", "Disputed: waiting for the arbiter's ruling.", d.ruleBy);
    default:
      return {
        party: undefined,
        title: SETTLED[deal.state as DealState] ?? "Unknown state.",
        overdue: false,
      };
  }
}
