import { useQuery } from "@tanstack/react-query";
import { deployments, wasitEscrowAbi, type DeploymentName } from "@wasit/sdk";
import { ExternalLink, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { publicClient } from "@/data/client";
import { createLogStore } from "@/data/events";
import { percent } from "@/landing/params";
import { formatMusd } from "@/lib/format";
import { explorerTx } from "@/lib/links";
import { agentsFor, breakEvenVolume, feeOn, observe, troveCost, type Observed } from "./model";

const M = 10n ** 18n;
/** The live sets. demo-sim is left out: it runs on a simulated price feed. */
const SETS: { name: DeploymentName; label: string }[] = [
  { name: "mezo-testnet", label: "BTC bond" },
  { name: "mezo-testnet-trove", label: "Trove bond" },
];
const stores = new Map<DeploymentName, ReturnType<typeof createLogStore>>();

function useObserved() {
  return useQuery({
    queryKey: ["economics"],
    staleTime: 60_000,
    queryFn: async () =>
      Promise.all(
        SETS.map(async ({ name, label }) => {
          let sync = stores.get(name);
          if (!sync) stores.set(name, (sync = createLogStore(publicClient, deployments[name])));
          const [logs, feeBps] = await Promise.all([
            sync(),
            publicClient.readContract({
              address: deployments[name].escrow,
              abi: wasitEscrowAbi,
              functionName: "defaultFeeBps",
            }),
          ]);
          return { name, label, feeBps: BigInt(feeBps), observed: observe(logs) };
        }),
      ),
  });
}

function Kind({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase">
      {children}
    </span>
  );
}

function Section({ kind, title, children }: { kind: string; title: string; children: ReactNode }) {
  return (
    <Card className="gap-4">
      <CardHeader className="flex flex-wrap items-center gap-3">
        <Kind>{kind}</Kind>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm leading-relaxed">{children}</CardContent>
    </Card>
  );
}

function Source({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-gold hover:underline"
    >
      {children} <ExternalLink aria-hidden className="size-3" />
    </a>
  );
}

function ObservedTable({
  sets,
}: {
  sets: { label: string; feeBps: bigint; observed: Observed }[];
}) {
  const all = sets.flatMap((s) => s.observed.rows.map((r) => ({ ...r, set: s.label })));
  const team = sets.reduce((n, s) => n + s.observed.team.fees, 0n);
  const teamSettled = sets.reduce((n, s) => n + s.observed.team.settled, 0n);
  const outside = sets.reduce((n, s) => n + s.observed.outside.fees, 0n);
  const outsideCount = sets.reduce((n, s) => n + s.observed.outside.count, 0);
  return (
    <>
      <p>
        Fee set on chain:{" "}
        {sets.map((s) => (
          <span key={s.label} className="me-3 font-semibold">
            {s.label} {percent(s.feeBps)}
          </span>
        ))}
        of the value settled to the supplier (capped at 1% in the contract). No fee on refunds.
      </p>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-4">
          <dt className="text-muted-foreground">Team deals that paid a fee</dt>
          <dd className="mt-1 text-lg font-semibold">
            {formatMusd(team)} on {formatMusd(teamSettled, 0)} settled
          </dd>
        </div>
        <div className="rounded-lg border p-4">
          <dt className="text-muted-foreground">Deals with someone outside the team</dt>
          <dd className="mt-1 text-lg font-semibold">
            {outsideCount === 0
              ? "None settled yet"
              : `${formatMusd(outside)} from ${outsideCount}`}
          </dd>
        </div>
      </dl>
      <p className="text-muted-foreground">
        All of this is test tokens on Mezo testnet. Team deals are the team&apos;s own wallets
        trading with each other, so their fees are a check that the arithmetic works, not revenue.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="text-xs text-muted-foreground uppercase">
            <tr>
              <th className="py-2">Deal</th>
              <th>Who</th>
              <th className="text-end">To supplier</th>
              <th className="text-end">Fee</th>
              <th className="text-end">Transaction</th>
            </tr>
          </thead>
          <tbody>
            {all.map((r) => (
              <tr key={`${r.set}-${r.dealId}`} className="border-t">
                <td className="py-2">
                  {r.set} #{r.dealId.toString()}
                </td>
                <td>{r.outside ? "Outside" : "Team"}</td>
                <td className="text-end">{formatMusd(r.toSupplier)}</td>
                <td className="text-end">{formatMusd(r.fee)}</td>
                <td className="text-end">
                  <Source href={explorerTx(r.tx)}>
                    {r.tx.slice(0, 8)}…{r.tx.slice(-4)}
                  </Source>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** `/economics` (PLAN 10.1): a labeled model on testnet volume. */
export function EconomicsPage() {
  const q = useObserved();
  const fee = q.data?.[0]?.feeBps ?? 50n;
  const order = 3_000n * M;
  // Assumptions, shown as ranges (never one number)
  const size = { low: 3_000n * M, high: 20_000n * M };
  const deals = { low: 2n, high: 10n };
  const cost = { low: 300n * M, high: 1_500n * M };
  const perAgent = {
    low: feeOn(size.low * deals.low, fee),
    high: feeOn(size.high * deals.high, fee),
  };
  const breakEven = { low: breakEvenVolume(cost.low, fee), high: breakEvenVolume(cost.high, fee) };
  const agents = {
    low: agentsFor(breakEven.low, size.high, deals.high),
    high: agentsFor(breakEven.high, size.low, deals.low),
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-3">
        <p className="text-xs font-semibold tracking-[0.2em] text-gold uppercase">Fee economics</p>
        <h1 className="text-3xl font-semibold tracking-tight">What Wasit would earn: a model</h1>
        <p className="text-lg leading-relaxed">
          This page is a model built on test-network volume. No sourcing agent has paid Wasit a fee:
          every deal so far ran on Mezo testnet, with test tokens.
        </p>
        <p className="leading-relaxed text-muted-foreground">
          Three kinds of number are kept apart: what was <strong>observed</strong> on chain, what
          others <strong>publish</strong> (with the source next to it), and what we{" "}
          <strong>assume</strong>, always shown as a range.
        </p>
      </header>

      <Section kind="Observed" title="Fees on Mezo testnet, read from the contracts">
        {q.data ? (
          <ObservedTable sets={q.data} />
        ) : q.isError ? (
          <p>Mezo testnet did not answer. Reload to try again.</p>
        ) : (
          <LoaderCircle aria-hidden className="size-5 animate-spin text-gold" />
        )}
      </Section>

      <Section kind="Published" title="What the alternatives charge">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-xs text-muted-foreground uppercase">
              <tr>
                <th className="py-2">Route</th>
                <th>Published price</th>
                <th className="text-end">On a 3,000 order</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-t">
                <td className="py-2 font-semibold">Wasit</td>
                <td>{percent(fee)} of value settled to the supplier (on chain, above)</td>
                <td className="text-end">{formatMusd(feeOn(order, fee))}</td>
              </tr>
              <tr className="border-t">
                <td className="py-2 font-semibold">Escrow.com</td>
                <td>
                  2.6% (minimum 50 USD) up to 5,000 USD; 2.4% from 5,000 to 50,000 USD.{" "}
                  <Source href="https://www.escrow.com/fee-calculator">Fee calculator</Source>, read
                  14 Nov 2026
                </td>
                <td className="text-end">78 USD</td>
              </tr>
              <tr className="border-t">
                <td className="py-2 font-semibold">Alibaba.com Trade Assurance</td>
                <td>
                  3% of the order, charged to the seller; only for orders on Alibaba.com.{" "}
                  <Source href="https://activity.alibaba.com/ggs/trade_assurance.html">
                    Trade Assurance page
                  </Source>{" "}
                  (undated)
                </td>
                <td className="text-end">90 USD</td>
              </tr>
              <tr className="border-t">
                <td className="py-2 font-semibold">Bank letter of credit</td>
                <td>
                  One published tariff: DBS Singapore charges 1/8% a month for an import LC, at
                  least two months and at least S$80, plus S$100 SWIFT, before the exporter&apos;s
                  bank charges.{" "}
                  <Source href="https://dbs.com.sg/corporate/forms-and-guides/trade-finance-service-fees">
                    DBS tariff
                  </Source>
                  , read 14 Nov 2026. And it may be refused: 41% of SME trade-finance requests were
                  rejected (Asian Development Bank, Global Trade Finance Gap Survey, February 2026).
                </td>
                <td className="text-end">at least S$180</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground">
          These are not like-for-like: Escrow.com holds the whole payment, Trade Assurance works
          only on its own marketplace, and a letter of credit is a bank&apos;s promise. Wasit holds
          the balance and backs the advance with a BTC bond, with limits.
        </p>
      </Section>

      <Section kind="Protocol" title="What the bond poster pays in trove mode">
        <p>
          Mezo&apos;s MUSD system charges the trove 0.1% once and 1% a year on what it owes (read on
          chain). For a 1,800 MUSD trove that is about {formatMusd(troveCost(1_800n * M, 30n))} for
          30 days, {formatMusd(troveCost(1_800n * M, 60n))} for 60 and{" "}
          {formatMusd(troveCost(1_800n * M, 90n))} for 90. A fork test measured 3.44 MUSD for 30
          days. That is the sourcing agent&apos;s cost of vouching for a supplier with a trove bond.
        </p>
      </Section>

      <Section kind="Assumed" title="A model of what it could earn, not a forecast">
        <table className="w-full text-left">
          <tbody className="align-top">
            <tr className="border-b">
              <td className="py-2 font-semibold">Order size</td>
              <td>
                {formatMusd(size.low, 0)} to {formatMusd(size.high, 0)}
              </td>
              <td className="text-muted-foreground">
                Chosen to start where trove mode makes sense (its 1,800 MUSD minimum); not market
                data
              </td>
            </tr>
            <tr className="border-b">
              <td className="py-2 font-semibold">Deals per agent per month</td>
              <td>
                {deals.low.toString()} to {deals.high.toString()}
              </td>
              <td className="text-muted-foreground">An assumption; no agent has used Wasit yet</td>
            </tr>
            <tr>
              <td className="py-2 font-semibold">Monthly running cost</td>
              <td>
                {formatMusd(cost.low, 0).replace("MUSD", "USD")} to{" "}
                {formatMusd(cost.high, 0).replace("MUSD", "USD")}
              </td>
              <td className="text-muted-foreground">
                An assumption for hosting, data access and a share of a security review; not quotes
              </td>
            </tr>
          </tbody>
        </table>
        <ul className="list-disc space-y-1 ps-5">
          <li>
            Fees from one agent a month, at {percent(fee)}: {formatMusd(perAgent.low, 0)} to{" "}
            {formatMusd(perAgent.high, 0)}.
          </li>
          <li>
            <strong>Break-even:</strong> fees cover the running cost at{" "}
            {formatMusd(breakEven.low, 0)} to {formatMusd(breakEven.high, 0)} settled per month,
            which is {agents.low.toString()} to {agents.high.toString()} agents at the assumed
            activity.
          </li>
        </ul>
        <p className="text-muted-foreground">
          Every input above is an assumption. The only numbers here that happened are in the
          Observed section.
        </p>
      </Section>
    </div>
  );
}
