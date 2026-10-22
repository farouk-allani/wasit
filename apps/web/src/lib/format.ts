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

/** A BTC amount (18 decimals on Mezo), truncated to `maxDecimals`, trailing zeros dropped. */
export function formatBtc(amount: bigint, maxDecimals = 6): string {
  const [whole = "0", fraction = ""] = formatUnits(amount, 18).split(".");
  const decimals = fraction.slice(0, maxDecimals).replace(/0+$/, "");
  return `${whole}${decimals ? `.${decimals}` : ""} BTC`;
}

/** A unix time in seconds as a short local date and time, e.g. "22 Oct, 19:55". */
export function formatTime(unix: bigint): string {
  return new Date(Number(unix) * 1000).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Distance from `now` to `at` (unix seconds), e.g. "in 4 min", "2 h ago". */
export function formatRelative(at: bigint, now: bigint): string {
  const diff = Number(at - now);
  if (Math.abs(diff) < 60) return diff >= 0 ? "in under a minute" : "just now";
  const span = formatDuration(
    Math.abs(diff) < 86_400 ? Math.abs(diff) : Math.abs(diff) - (Math.abs(diff) % 3_600),
  );
  return diff > 0 ? `in ${span}` : `${span} ago`;
}
