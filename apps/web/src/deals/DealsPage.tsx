import { useQuery } from "@tanstack/react-query";
import { wasitEscrowAbi, type Deal } from "@wasit/sdk";
import { ArrowRight, LoaderCircle, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { useAccount } from "wagmi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { publicClient } from "@/data/client";
import { useDeployment } from "@/deployment";
import { formatMusd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DEAL_STATE, ROLE_LABEL } from "./DealPage";
import { nextStep, rolesOf } from "./dealStatus";
import { useNow } from "./useDealLive";

/** Every deal of the active deployment, newest first, read with `getDeal` (ids start at 1). */
function useDealList() {
  const d = useDeployment();
  return useQuery({
    queryKey: ["deal-list", d.name],
    refetchInterval: 15_000,
    queryFn: async () => {
      const escrow = { address: d.escrow, abi: wasitEscrowAbi } as const;
      const next = await publicClient.readContract({ ...escrow, functionName: "nextDealId" });
      const ids = Array.from(
        { length: Math.max(0, Number(next) - 1) },
        (_, i) => next - 1n - BigInt(i),
      );
      const deals = await Promise.all(
        ids.map((id) =>
          publicClient.readContract({ ...escrow, functionName: "getDeal", args: [id] }),
        ),
      );
      return ids.map((id, i) => ({ id, deal: deals[i] as Deal }));
    },
  });
}

/** `/deals`: the connected wallet's deals (any role), or every deal on the deployment. */
export function DealsPage() {
  const { address } = useAccount();
  const { search } = useLocation();
  const list = useDealList();
  const now = useNow(15_000);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const showAll = !address || scope === "all";
  const rows = (list.data ?? [])
    .map((r) => ({ ...r, roles: rolesOf(r.deal.terms, address) }))
    .filter((r) => showAll || r.roles.length > 0);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="eyebrow">Deals</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {showAll ? "All deals" : "Your deals"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {address
              ? "Deals where your wallet is the buyer, supplier, bond poster, inspector, carrier or arbiter."
              : "Every deal on this deployment is public on-chain. Connect a wallet to see yours."}
          </p>
        </div>
        <Button asChild>
          <Link to={`/deals/new${search}`}>
            <Plus /> New deal
          </Link>
        </Button>
      </header>

      {address && (
        <div
          role="group"
          aria-label="Which deals"
          className="inline-flex rounded-lg border bg-card p-1"
        >
          {(["mine", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={scope === s}
              onClick={() => setScope(s)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-semibold transition-colors",
                scope === s
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s === "mine" ? "Mine" : "All"}
            </button>
          ))}
        </div>
      )}

      {list.isPending ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle aria-hidden className="size-4 animate-spin text-gold" /> Reading deals from
          Mezo testnet…
        </p>
      ) : list.isError ? (
        <p role="alert" className="rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm">
          Mezo testnet did not answer. Deals and funds are not affected; reload to try again.
        </p>
      ) : rows.length === 0 ? (
        <Card className="items-center gap-4 py-12 text-center">
          <p className="font-semibold">
            {showAll ? "No deals on this deployment yet." : "No deals with this wallet yet."}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            A buyer creates a deal; the supplier, arbiter and others named in it see it here once
            they connect.
          </p>
          <Button asChild variant="outline">
            <Link to={`/deals/new${search}`}>Create a deal</Link>
          </Button>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map(({ id, deal, roles }) => {
            const state = DEAL_STATE[deal.state] ?? { label: "Unknown", tone: "outline" as const };
            const step = nextStep({
              deal,
              bond: undefined,
              coverageBps: undefined,
              now,
              account: address,
            });
            const yourTurn = !!step.party && step.party !== "anyone" && roles.includes(step.party);
            return (
              <li key={id.toString()}>
                <Link
                  to={`/deals/${id}${search}`}
                  className="group flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card p-5 transition-colors hover:border-gold/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                >
                  <span className="text-lg font-semibold">#{id.toString()}</span>
                  <Badge variant={state.tone}>{state.label}</Badge>
                  <span className="text-sm font-semibold">
                    {formatMusd(deal.terms.advanceAmount + deal.terms.balanceAmount)}
                  </span>
                  {roles.length > 0 && (
                    <span className="text-sm text-muted-foreground">
                      You: {roles.map((r) => ROLE_LABEL[r].toLowerCase()).join(", ")}
                    </span>
                  )}
                  <span className="ms-auto flex items-center gap-2 text-sm">
                    {yourTurn && <Badge variant="warning">Your turn</Badge>}
                    <ArrowRight
                      aria-hidden
                      className="size-4 text-muted-foreground group-hover:text-gold"
                    />
                    <span className="sr-only">Open deal {id.toString()}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
