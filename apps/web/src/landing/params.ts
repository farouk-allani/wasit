import { BPS } from "@wasit/sdk";
import config from "../../../../deployments/config/mezo-testnet.json";

/**
 * Parameters of the live testnet deployment, read from its deploy config (the file Deploy.s.sol
 * reads) so the landing copy cannot drift from what the contracts enforce.
 */
export const params = {
  feeBps: BigInt(config.feeBps),
  topUpRatioBps: config.topUpRatioBps,
  protectRatioBps: config.protectRatioBps,
  maxSlippageBps: config.maxSlippageBps,
};

export const percent = (bps: number | bigint) => `${Number(bps) / 100}%`;

/** Worked example for a whole-dollar order; bigint all the way (no floats for money). */
export function exampleDeal(orderUsd: bigint, advanceBps: bigint, bondRatioBps: bigint) {
  const bps = BigInt(BPS);
  const advance = (orderUsd * advanceBps) / bps;
  const balance = orderUsd - advance;
  const advanceFee = (advance * params.feeBps) / bps;
  const netAdvance = advance - advanceFee;
  const balanceFee = (balance * params.feeBps) / bps;
  return {
    advance,
    balance,
    advanceFee,
    netAdvance,
    bondValue: (netAdvance * bondRatioBps) / bps,
    toSupplierOnRelease: balance - balanceFee,
    totalFee: advanceFee + balanceFee,
  };
}

export const usd = (amount: bigint) => `$${amount.toLocaleString("en-US")}`;
