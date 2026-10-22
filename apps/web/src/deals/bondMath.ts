import { BPS } from "@wasit/sdk";

const E18 = 10n ** 18n;
const bps = BigInt(BPS);

/** Coverage in bps exactly as `AdvanceBond._coverage` computes it (rounded down). */
export function coverageOf(btc: bigint, musd: bigint, covered: bigint, price: bigint): bigint {
  if (covered === 0n) return 0n;
  return (((btc * price) / E18 + musd) * bps) / covered;
}

/** Smallest BTC amount (18 decimals) whose coverage reaches `ratioBps` at `price`. */
export function btcForCoverage(covered: bigint, ratioBps: bigint, price: bigint): bigint {
  if (price === 0n) return 0n;
  // value needed in MUSD, rounded up, then BTC rounded up; one wei of slack covers both roundings
  const value = (covered * ratioBps + bps - 1n) / bps;
  return (value * E18 + price - 1n) / price + 1n;
}

/** Amount to suggest: 1% above the minimum, so a small price move before mining cannot fail it. */
export const withMargin = (amount: bigint) => amount + amount / 100n;
