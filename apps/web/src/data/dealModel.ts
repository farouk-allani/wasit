import {
  AttestationKind,
  BondSettlement,
  BondStatus,
  DealState,
  type advanceBondAbi,
  type wasitEscrowAbi,
} from "@wasit/sdk";
import type { Address, GetContractEventsReturnType, Hex } from "viem";

export type EscrowLog = GetContractEventsReturnType<typeof wasitEscrowAbi, undefined, true>[number];
export type BondLog = GetContractEventsReturnType<typeof advanceBondAbi, undefined, true>[number];
export type DealLog = EscrowLog | BondLog;

/** One money movement, always tied to the transaction that made it. */
export interface LedgerEntry {
  label: string;
  asset: "MUSD" | "BTC";
  amount: bigint;
  tx: Hex;
}

export interface TimelineEntry {
  event: DealLog["eventName"];
  tx: Hex;
  block: bigint;
  /** Block time (unix seconds), when the RPC includes it in the log. */
  at: bigint | undefined;
  /** Attestations only: who signed, the evidence hash and the signed issue time. */
  attestation?: { kind: AttestationKind; signer: Address; evidenceHash: Hex; issuedAt: bigint };
}

export interface BondView {
  status: BondStatus;
  btcHeld: bigint;
  musdHeld: bigint;
  /** Coverage reported by the last bond event; the live value needs `coverageBps()`. */
  lastCoverageBps: bigint | undefined;
  /** MUSD a claim could not pay (BTC crash); 0 if none. */
  shortfall: bigint;
}

/** A deal reconstructed from escrow and bond events (ARCHITECTURE §5, §8). */
export interface DealView {
  id: bigint;
  buyer: Address;
  supplier: Address;
  token: Address;
  advanceAmount: bigint;
  balanceAmount: bigint;
  termsHash: Hex;
  state: DealState;
  arbiterAccepted: boolean;
  /** Bond call that failed and awaits `retryBondSettlement`; None otherwise. */
  bondPending: BondSettlement;
  /** MUSD the escrow holds for this deal: escrowed balance + advance fee until settlement. */
  escrowed: bigint;
  paidToSupplier: bigint;
  refundedToBuyer: bigint;
  fees: bigint;
  bond: BondView;
  timeline: TimelineEntry[];
  ledger: LedgerEntry[];
}

const TERMINAL = new Set<DealState>([
  DealState.Released,
  DealState.Resolved,
  DealState.SupplierDefaulted,
  DealState.BuyerDefaulted,
  DealState.Cancelled,
]);

const byChainOrder = (a: DealLog, b: DealLog) =>
  a.blockNumber === b.blockNumber
    ? a.logIndex - b.logIndex // block-wide on Mezo (VERIFIED-FACTS)
    : a.blockNumber < b.blockNumber
      ? -1
      : 1;

/** Reduces escrow + bond logs (any order) into one view per deal. Pure. */
export function reduceDeals(logs: readonly DealLog[]): Map<bigint, DealView> {
  const deals = new Map<bigint, DealView>();
  for (const log of [...logs].sort(byChainOrder)) {
    if (log.eventName === "DealCreated") {
      const a = log.args;
      deals.set(a.dealId, {
        id: a.dealId,
        buyer: a.buyer,
        supplier: a.supplier,
        token: a.token,
        advanceAmount: a.advanceAmount,
        balanceAmount: a.balanceAmount,
        termsHash: a.termsHash,
        state: DealState.Created,
        arbiterAccepted: false,
        bondPending: BondSettlement.None,
        escrowed: 0n,
        paidToSupplier: 0n,
        refundedToBuyer: 0n,
        fees: 0n,
        bond: {
          status: BondStatus.None,
          btcHeld: 0n,
          musdHeld: 0n,
          lastCoverageBps: undefined,
          shortfall: 0n,
        },
        timeline: [],
        ledger: [],
      });
    }
    if (!("dealId" in log.args)) continue; // config and ownership events
    const deal = deals.get(log.args.dealId);
    if (deal) apply(deal, log);
  }
  return deals;
}

function apply(deal: DealView, log: DealLog) {
  const tx = log.transactionHash;
  const entry: TimelineEntry = {
    event: log.eventName,
    tx,
    block: log.blockNumber,
    // 0 is Mezo's placeholder for "not provided" (VERIFIED-FACTS), never a real block time
    at: log.blockTimestamp ? log.blockTimestamp : undefined,
  };
  deal.timeline.push(entry);
  const money = (label: string, amount: bigint, asset: LedgerEntry["asset"] = "MUSD") => {
    if (amount > 0n) deal.ledger.push({ label, asset, amount, tx });
  };
  const settle = (state: DealState) => {
    deal.state = state;
    deal.escrowed = 0n; // terminal deals hold nothing (invariant #2)
  };
  const bond = deal.bond;

  switch (log.eventName) {
    case "DealAccepted":
      deal.state = DealState.Accepted;
      break;
    case "ArbiterAccepted":
      deal.arbiterAccepted = true;
      break;
    case "AdvanceFunded":
      deal.state = DealState.AdvancePaid;
      deal.paidToSupplier += log.args.toSupplier;
      deal.escrowed += log.args.feeHeld;
      money("Advance paid to the supplier", log.args.toSupplier);
      money("Advance fee held in escrow", log.args.feeHeld);
      break;
    case "Attested": {
      const { kind, signer, evidenceHash, issuedAt } = log.args;
      entry.attestation = { kind: kind as AttestationKind, signer, evidenceHash, issuedAt };
      if (kind === AttestationKind.ReadyInspected) deal.state = DealState.GoodsReady;
      if (kind === AttestationKind.Shipped) deal.state = DealState.Shipped;
      break;
    }
    case "BalanceFunded":
      deal.state = DealState.BalanceFunded;
      deal.escrowed += log.args.amount;
      money("Balance escrowed", log.args.amount);
      break;
    case "Disputed":
      deal.state = DealState.Disputed;
      break;
    case "Released":
      settle(DealState.Released);
      deal.paidToSupplier += log.args.toSupplier;
      deal.fees += log.args.fee;
      money("Balance released to the supplier", log.args.toSupplier);
      money("Fees", log.args.fee);
      break;
    case "Resolved":
      settle(DealState.Resolved);
      deal.paidToSupplier += log.args.toSupplier;
      deal.refundedToBuyer += log.args.toBuyer;
      deal.fees += log.args.fee;
      money("Arbiter's share to the supplier", log.args.toSupplier);
      money("Arbiter's refund to the buyer (escrow)", log.args.toBuyer);
      money("Fees", log.args.fee);
      break;
    case "SupplierDefaulted":
      settle(DealState.SupplierDefaulted);
      deal.refundedToBuyer += log.args.refundedToBuyer;
      money("Refunded to the buyer (escrow)", log.args.refundedToBuyer);
      break;
    case "BuyerDefaulted":
      settle(DealState.BuyerDefaulted);
      deal.fees += log.args.fee;
      money("Fees", log.args.fee);
      break;
    case "DealCancelled":
      settle(DealState.Cancelled);
      deal.refundedToBuyer += log.args.refundedToBuyer;
      money("Refunded to the buyer", log.args.refundedToBuyer);
      break;
    case "BondSettlementFailed":
      deal.bondPending = log.args.action as BondSettlement;
      break;
    case "BondSettled":
      deal.bondPending = BondSettlement.None;
      break;
    case "BondPosted":
      bond.status = BondStatus.Active;
      bond.btcHeld += log.args.btcAmount;
      bond.lastCoverageBps = log.args.coverageBps;
      money("Bond posted", log.args.btcAmount, "BTC");
      break;
    case "BondToppedUp":
      bond.btcHeld += log.args.btcAmount;
      bond.lastCoverageBps = log.args.coverageBps;
      money("Bond topped up", log.args.btcAmount, "BTC");
      break;
    case "BondWithdrawn":
      bond.status = BondStatus.Released;
      bond.btcHeld = 0n;
      money("Bond withdrawn by the bonder", log.args.btcAmount, "BTC");
      break;
    case "BondProtected":
      bond.status = BondStatus.Protected;
      bond.btcHeld -= log.args.btcSold;
      bond.musdHeld += log.args.musdReceived;
      bond.lastCoverageBps = log.args.coverageBefore;
      money("Bond BTC sold to protect the advance", log.args.btcSold, "BTC");
      money("MUSD now held by the bond", log.args.musdReceived);
      break;
    case "BondClaimed":
      bond.status = BondStatus.Claimed; // a claim closes the bond; leftovers follow in BondReleased
      bond.btcHeld = 0n;
      bond.musdHeld = 0n;
      deal.refundedToBuyer += log.args.paid;
      money("Advance repaid to the buyer by the bond", log.args.paid);
      break;
    case "BondShortfall":
      bond.shortfall = log.args.requested - log.args.paid;
      break;
    case "BondReleased":
      if (bond.status !== BondStatus.Claimed) bond.status = BondStatus.Released;
      bond.btcHeld = 0n;
      bond.musdHeld = 0n;
      money("Bond BTC returned to the bonder", log.args.btcReturned, "BTC");
      money("Bond MUSD returned to the bonder", log.args.musdReturned);
      break;
  }
  if (TERMINAL.has(deal.state)) deal.escrowed = 0n;
}
