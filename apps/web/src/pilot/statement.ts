import { getAddress, isAddress, type Address, type Hex } from "viem";

/**
 * Plain-text statement an outside participant signs with the wallet that took part (PLAN 9.3).
 * It proves control of the key, not identity; `pilot verify` checks it against the deal on chain.
 * Keep the line format stable: the verify script parses it.
 */
export interface StatementInput {
  dealId: bigint;
  escrow: Address;
  role: string;
  wallet: Address;
  date: string; // YYYY-MM-DD
  city?: string;
  describeAs?: string;
}

const clean = (s: string | undefined) =>
  (s ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 80);

export function statementText(s: StatementInput): string {
  return [
    "Wasit test deal statement",
    `Deal: #${s.dealId} on escrow ${s.escrow}, Mezo testnet (chain 31611)`,
    `Role: ${s.role}`,
    `Wallet: ${s.wallet}`,
    `Date: ${s.date}`,
    `City: ${clean(s.city) || "not given"}`,
    `Describe me as: ${clean(s.describeAs) || "not given"}`,
    "- This wallet is mine. Its key was created on my device and the Wasit team has never held it.",
    "- This was a test network. No real money and no real goods were involved.",
    "- Wasit may publish this statement and describe me as written above.",
  ].join("\n");
}

export interface SignedStatement {
  message: string;
  address: Address;
  signature: Hex;
}

/** Fields read back from a statement's text; undefined if it is not one. */
export function parseStatement(message: string) {
  const line = (key: string) =>
    message
      .split("\n")
      .find((l) => l.startsWith(`${key}: `))
      ?.slice(key.length + 2);
  const deal = line("Deal")?.match(/^#(\d+) on escrow (0x[0-9a-fA-F]{40}),/);
  const wallet = line("Wallet");
  const role = line("Role");
  if (!message.startsWith("Wasit test deal statement\n") || !deal || !role || !wallet) return;
  if (!isAddress(deal[2]!) || !isAddress(wallet)) return;
  return {
    dealId: BigInt(deal[1]!),
    escrow: getAddress(deal[2]),
    role,
    wallet: getAddress(wallet),
    date: line("Date"),
    city: line("City"),
    describeAs: line("Describe me as"),
  };
}
