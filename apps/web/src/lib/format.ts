import { formatUnits } from "viem";

/** MUSD has 18 decimals (VERIFIED-FACTS, MUSD token). */
export const MUSD_DECIMALS = 18;

/**
 * An MUSD amount with thousands separators, exact from the bigint (no float rounding). Shows up to
 * `maxDecimals` decimals, truncated, and drops trailing zeros.
 */
export function formatMusd(amount: bigint, maxDecimals = 2): string {
  const [whole = "0", fraction = ""] = formatUnits(amount, MUSD_DECIMALS).split(".");
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimals = fraction.slice(0, maxDecimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${grouped}${decimals ? `.${decimals}` : ""} MUSD`;
}

/** A duration in seconds as the largest whole units, e.g. "14 days", "2 h 30 min". */
export function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const parts = [
    days && `${days} ${days === 1 ? "day" : "days"}`,
    hours && `${hours} h`,
    minutes && `${minutes} min`,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : `${seconds} s`;
}
