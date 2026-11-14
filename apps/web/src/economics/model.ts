import { isAddressEqual, type Address, type Hash } from "viem";
import type { DealLog } from "@/data/dealModel";

/**
 * Wallets the team holds on Mezo testnet: the seven accounts of the team mnemonic and the two
 * test wallets made for the team's own dry runs (EVIDENCE.md). A deal where every address that
 * acted is in this list is a team deal, never an outside one.
 */
export const TEAM: readonly Address[] = [
  "0x400b1e116dF4e79b9d34641Dc79175c7BC1aeD36", // deployer
  "0xC932A7b94E0C0E9c5dAD3cf9547ad51FB865130b", // buyer
  "0xAE52F1f55BD606cF385E7EE6D85E7c689D0CCE77", // supplier
  "0x45Be78315AEc0372011db5c526445eFEB86B65Cf", // agent / bonder
  "0xb81e05e23A4b0030173B78A20757Bbe9b749c9e9", // inspector
  "0x230cf226b6Ce0Ff7691f7046D3bA8Ed0aCe58ef2", // carrier
  "0x74E33B865eA1397F5fCB6fbb41Cb2fec8EC8B6CB", // arbiter
  "0x78E56fcf252A60e8B6E2C429F6A953D5fFf949b0", // team dry run, deal #7
  "0xf9379Fb4f548E70b836E79BdD9dA335f133E459d", // Farouk's phone dry run, deal #8
];
export const isTeam = (a: Address) => TEAM.some((t) => isAddressEqual(t, a));

/** One deal that paid a fee, with the transaction that settled it. */
export interface FeeRow {
  dealId: bigint;
  toSupplier: bigint;
  fee: bigint;
  tx: Hash;
  outside: boolean;
}

export interface Observed {
  rows: FeeRow[];
  deals: number;
  team: { settled: bigint; fees: bigint; count: number };
  outside: { settled: bigint; fees: bigint; count: number };
}

type Args = Record<string, unknown>;

/**
 * Fees actually earned on chain: `Released` and `Resolved` pay the supplier (balance part; the net
 * advance was paid at `AdvanceFunded` and is added here) and earn a fee,
 * `BuyerDefaulted` earns the advance fee only. A deal is outside when any address that acted on it
 * (buyer, supplier, signer, arbiter, bond poster) is not a team wallet.
 */
export function observe(logs: DealLog[]): Observed {
  const actors = new Map<bigint, Address[]>();
  const advance = new Map<bigint, bigint>();
  const deals = new Set<bigint>();
  const settled: Omit<FeeRow, "outside">[] = [];
  for (const log of logs) {
    const a = log.args as Args;
    const id = a.dealId as bigint | undefined;
    if (id === undefined) continue;
    const add = (x: unknown) => {
      if (typeof x === "string") actors.set(id, [...(actors.get(id) ?? []), x as Address]);
    };
    switch (log.eventName) {
      case "DealCreated":
        deals.add(id);
        add(a.buyer);
        add(a.supplier);
        break;
      case "Attested":
        add(a.signer);
        break;
      case "ArbiterAccepted":
        add(a.arbiter);
        break;
      case "BondPosted":
        add(a.bonder);
        break;
      case "AdvanceFunded":
        advance.set(id, a.toSupplier as bigint);
        break;
      case "Released":
      case "Resolved":
        settled.push({
          dealId: id,
          toSupplier: a.toSupplier as bigint,
          fee: a.fee as bigint,
          tx: log.transactionHash,
        });
        break;
      case "BuyerDefaulted":
        settled.push({ dealId: id, toSupplier: 0n, fee: a.fee as bigint, tx: log.transactionHash });
        break;
    }
  }
  const rows = settled
    .map((r) => ({
      ...r,
      // the advance reached the supplier when it was funded; Released/Resolved pay the balance part
      toSupplier: r.toSupplier + (r.toSupplier > 0n ? (advance.get(r.dealId) ?? 0n) : 0n),
      outside: (actors.get(r.dealId) ?? []).some((x) => !isTeam(x)),
    }))
    .sort((x, y) => (x.dealId < y.dealId ? -1 : 1));
  const sum = (outside: boolean) => {
    const rs = rows.filter((r) => r.outside === outside);
    return {
      settled: rs.reduce((n, r) => n + r.toSupplier, 0n),
      fees: rs.reduce((n, r) => n + r.fee, 0n),
      count: rs.length,
    };
  };
  return { rows, deals: deals.size, team: sum(false), outside: sum(true) };
}

/** Fee on `value` at `feeBps` (the escrow takes it on value settled to the supplier). */
export const feeOn = (value: bigint, feeBps: bigint) => (value * feeBps) / 10_000n;

/** Monthly settled volume at which fees equal `monthlyCost`. */
export const breakEvenVolume = (monthlyCost: bigint, feeBps: bigint) =>
  (monthlyCost * 10_000n + feeBps - 1n) / feeBps;

/** Agents needed to settle `volume` a month at `dealSize` × `dealsPerMonth` each (rounded up). */
export const agentsFor = (volume: bigint, dealSize: bigint, dealsPerMonth: bigint) =>
  (volume + dealSize * dealsPerMonth - 1n) / (dealSize * dealsPerMonth);

/** What a trove-mode bond poster pays: 0.1% fee on the draw plus simple interest on the debt. */
export function troveCost(
  drawn: bigint,
  days: bigint,
  rateBps = 100n,
  gasComp = 200n * 10n ** 18n,
) {
  const fee = drawn / 1_000n;
  const debt = drawn + fee + gasComp;
  return fee + (debt * rateBps * days) / (10_000n * 365n);
}
