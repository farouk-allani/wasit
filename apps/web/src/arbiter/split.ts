import { BPS, type Deal } from "@wasit/sdk";
import { feeOn } from "@/deals/terms";

const bps = BigInt(BPS);
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export interface SplitPreview {
  /** Balance share paid to the supplier, after its fee. */
  toSupplier: bigint;
  /** Paid by the escrow to the buyer: balance not awarded + refunded share of the advance fee. */
  toBuyer: bigint;
  /** Part of the net advance the bond is asked to pay the buyer (it may hold less). */
  claimAmount: bigint;
  /** Protocol fee kept. */
  earned: bigint;
}

/**
 * What `resolve(toSupplierBps, advanceRefundBps)` pays, exactly as `WasitEscrow._split`:
 * fees round down, refunds round up (ARCHITECTURE §5).
 */
export function splitPreview(
  deal: Pick<Deal, "balanceHeld" | "advanceFeeHeld" | "terms">,
  toSupplierBps: number,
  advanceRefundBps: number,
): SplitPreview {
  const held = deal.balanceHeld;
  const advanceFee = deal.advanceFeeHeld;
  const share = (held * BigInt(toSupplierBps)) / bps;
  const shareFee = feeOn(share, deal.terms.feeBps);
  const feeRefund = ceilDiv(advanceFee * BigInt(advanceRefundBps), bps);
  const netAdvance = deal.terms.advanceAmount - feeOn(deal.terms.advanceAmount, deal.terms.feeBps);
  return {
    toSupplier: share - shareFee,
    toBuyer: held - share + feeRefund,
    claimAmount: ceilDiv(netAdvance * BigInt(advanceRefundBps), bps),
    earned: shareFee + advanceFee - feeRefund,
  };
}
