import { DealState, type Deal } from "@wasit/sdk";
import { CircleAlert, Clock, ExternalLink, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";
import { zeroAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDeal } from "@/data/useDeals";
import { formatMusd, formatRelative, formatTime } from "@/lib/format";
import { explorerAddress } from "@/lib/links";
import { cn } from "@/lib/utils";
import { BondPanel } from "./BondPanel";
import { DealActions } from "./DealActions";
import { Ledger, Timeline } from "./DealHistory";
import {
  dealActions,
  nextStep,
  rolesOf,
  type DealSnapshot,
  type NextStep,
  type Role,
} from "./dealStatus";
import { summarize } from "./terms";
import { useDealLive, useNow, useWalletFunds } from "./useDealLive";

export const DEAL_STATE: Record<
  number,
  { label: string; tone: "default" | "success" | "warning" | "destructive" | "outline" }
> = {
  [DealState.Created]: { label: "Awaiting supplier", tone: "outline" },
  [DealState.Accepted]: { label: "Accepted", tone: "outline" },
  [DealState.AdvancePaid]: { label: "In production", tone: "default" },
  [DealState.GoodsReady]: { label: "Goods ready", tone: "default" },
  [DealState.BalanceFunded]: { label: "Balance in escrow", tone: "default" },
  [DealState.Shipped]: { label: "Shipped", tone: "default" },
  [DealState.Disputed]: { label: "Disputed", tone: "warning" },
  [DealState.Released]: { label: "Released", tone: "success" },
  [DealState.Resolved]: { label: "Resolved", tone: "success" },
  [DealState.SupplierDefaulted]: { label: "Supplier defaulted", tone: "destructive" },
  [DealState.BuyerDefaulted]: { label: "Buyer defaulted", tone: "destructive" },
  [DealState.Cancelled]: { label: "Cancelled", tone: "outline" },
};

export const ROLE_LABEL: Record<Role | "anyone", string> = {
  buyer: "Buyer",
  supplier: "Supplier",
  bonder: "Bond poster",
  inspector: "Inspector",
  carrier: "Carrier",
  arbiter: "Arbiter",
  anyone: "Anyone",
};

/** "Inspector & carrier" for a named party, else a shortened address. */
export function partyName(terms: Deal["terms"], address: Address) {
  const roles = rolesOf(terms, address);
  if (!roles.length) return `${address.slice(0, 8)}…${address.slice(-6)}`;
  const names = roles.map((r) => ROLE_LABEL[r].toLowerCase());
  const joined = names.join(" & ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-lg space-y-4 py-16 text-center">{children}</div>;
}

function NextStepBanner({ step, now, youAct }: { step: NextStep; now: bigint; youAct: boolean }) {
  return (
    <div
      className={cn(
        "flex gap-4 rounded-xl border p-5",
        step.overdue ? "border-warning/50 bg-warning/10" : "border-gold/40 bg-card",
      )}
    >
      {step.overdue ? (
        <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
      ) : (
        <Clock aria-hidden className="mt-0.5 size-5 shrink-0 text-gold" />
      )}
      <div className="space-y-1">
        <p className="font-semibold">
          {step.title}
          {youAct && step.party && <span className="text-gold"> That is you.</span>}
        </p>
        {step.due !== undefined && (
          <p className="text-sm text-muted-foreground">
            {step.overdue ? "Deadline passed " : "Due "}
            {formatRelative(step.due, now)} ({formatTime(step.due)}).
            {step.overdue && " The deal can now be closed by the action shown on this page."}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-sm">
        {label}
        {note && <span className="block text-xs text-muted-foreground">{note}</span>}
      </dt>
      <dd className="text-end text-sm font-semibold whitespace-nowrap">{children}</dd>
    </div>
  );
}

/** Paid, refunded and fees come from the event history; until it loads they are unknown, not 0. */
function MoneyCard({
  deal,
  totals,
  historyError,
}: {
  deal: Deal;
  totals: { paid: bigint; refunded: bigint; fees: bigint } | undefined;
  historyError: boolean;
}) {
  const fromHistory = (amount: bigint | undefined) =>
    amount !== undefined ? (
      formatMusd(amount)
    ) : (
      <span className="font-normal text-muted-foreground">
        {historyError ? "unavailable" : "loading…"}
      </span>
    );
  const s = summarize(deal.terms);
  const upfrontPct = Number((deal.terms.advanceAmount * 10_000n) / s.total) / 100;
  return (
    <Card className="gap-5">
      <CardHeader>
        <p className="text-sm text-muted-foreground">Order value</p>
        <p className="text-4xl font-semibold tracking-tight">{formatMusd(s.total)}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="flex h-2.5 overflow-hidden rounded-full">
            <div className="bg-gold" style={{ width: `${upfrontPct}%` }} />
            <div className="flex-1 bg-navy-700" />
          </div>
          <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="me-2 inline-block size-2 rounded-full bg-gold" />
              {formatMusd(deal.terms.advanceAmount)} upfront
            </span>
            <span>
              <span className="me-2 inline-block size-2 rounded-full bg-navy-700" />
              {formatMusd(deal.terms.balanceAmount)} balance
            </span>
          </div>
        </div>
        <dl className="divide-y border-t">
          <Row label="Held in escrow now" note="balance plus the advance fee, until settlement">
            {formatMusd(deal.balanceHeld + deal.advanceFeeHeld)}
          </Row>
          <Row label="Paid to the supplier">{fromHistory(totals?.paid)}</Row>
          <Row label="Refunded to the buyer">{fromHistory(totals?.refunded)}</Row>
          <Row label="Protocol fees">{fromHistory(totals?.fees)}</Row>
        </dl>
      </CardContent>
    </Card>
  );
}

function PartiesCard({ deal, account }: { deal: Deal; account: Address | undefined }) {
  const t = deal.terms;
  const rows: [Role, Address][] = [
    ["buyer", t.buyer],
    ["supplier", t.supplier],
    ["inspector", t.inspector],
    ["carrier", t.carrier],
    ["arbiter", t.arbiter],
    ...(t.bonder !== zeroAddress ? [["bonder", t.bonder] as [Role, Address]] : []),
  ];
  const mine = rolesOf(t, account);
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>People</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="divide-y">
          {rows.map(([role, address]) => (
            <div key={role} className="flex items-baseline justify-between gap-3 py-2">
              <dt className="text-sm">
                {ROLE_LABEL[role]}
                {mine.includes(role) && <span className="ms-1.5 text-xs text-gold">(you)</span>}
                {role === "arbiter" && (
                  <span className="block text-xs text-muted-foreground">
                    {deal.arbiterAccepted ? "accepted the role" : "has not accepted yet"}
                  </span>
                )}
              </dt>
              <dd>
                <a
                  href={explorerAddress(address)}
                  target="_blank"
                  rel="noreferrer"
                  title={address}
                  className="inline-flex items-center gap-1 font-mono text-xs hover:text-gold hover:underline"
                >
                  {address.slice(0, 8)}…{address.slice(-6)}
                  <ExternalLink aria-hidden className="size-3" />
                </a>
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 space-y-1 border-t pt-4">
          <p className="text-xs text-muted-foreground">Terms document hash</p>
          <p className="font-mono text-xs break-all">{t.termsHash}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * `/deals/:id`: where the deal stands, who acts next, the money so far, and the actions the
 * connected wallet can take. State comes from the contracts; timeline and ledger from events.
 */
export function DealPage() {
  const { id: raw } = useParams();
  const { search } = useLocation();
  const id = raw && /^\d+$/.test(raw) ? BigInt(raw) : undefined;
  const { address } = useAccount();
  const live = useDealLive(id);
  const history = useDeal(id);
  const now = useNow();
  const funds = useWalletFunds(address);

  if (id === undefined)
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">That is not a deal number</h1>
        <Link to={`/deals${search}`} className="text-gold hover:underline">
          Back to deals
        </Link>
      </Centered>
    );
  if (live.isPending)
    return (
      <Centered>
        <LoaderCircle aria-hidden className="mx-auto size-6 animate-spin text-gold" />
        <p className="text-muted-foreground">Reading deal #{id.toString()} from Mezo testnet…</p>
      </Centered>
    );
  if (live.isError)
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">Could not read the deal</h1>
        <p className="text-muted-foreground">
          Mezo testnet did not answer. Your funds are not affected; reload to try again.
        </p>
      </Centered>
    );
  if (!live.data.found)
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">Deal #{id.toString()} does not exist</h1>
        <p className="text-muted-foreground">Check the number, or the deployment in the link.</p>
      </Centered>
    );

  const { deal, bond, coverageBps, btcPrice, priceError, simulated } = live.data;
  const snapshot: DealSnapshot = { deal, bond, coverageBps, now, account: address };
  const step = nextStep(snapshot);
  const actions = dealActions(snapshot);
  const roles = rolesOf(deal.terms, address);
  const state = DEAL_STATE[deal.state] ?? { label: "Unknown", tone: "outline" as const };
  const view = history.deal;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="eyebrow">Deal</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">#{id.toString()}</h1>
          <Badge variant={state.tone} className="text-sm">
            {state.label}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {roles.length
            ? `You are the ${roles.map((r) => ROLE_LABEL[r].toLowerCase()).join(" and ")} on this deal.`
            : address
              ? "Your wallet has no role on this deal. Some steps are open to anyone."
              : "Connect a wallet to act on this deal."}
        </p>
      </header>

      <NextStepBanner
        step={step}
        now={now}
        youAct={!!step.party && (step.party === "anyone" || roles.includes(step.party))}
      />

      <div className="grid items-start gap-8 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-8">
          <MoneyCard
            deal={deal}
            totals={
              view && {
                paid: view.paidToSupplier,
                refunded: view.refundedToBuyer,
                fees: view.fees,
              }
            }
            historyError={history.isError}
          />
          {view ? (
            <>
              <Timeline deal={view} nameOf={(a) => partyName(deal.terms, a)} />
              <Ledger deal={view} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {history.isError
                ? "Could not load the deal's history."
                : "Loading the deal's history…"}
            </p>
          )}
        </div>
        <aside className="order-first space-y-6 lg:sticky lg:top-24 lg:order-none">
          <DealActions
            dealId={id}
            deal={deal}
            actions={actions}
            account={address}
            funds={funds.data}
          />
          <BondPanel
            dealId={id}
            deal={deal}
            bond={bond}
            coverageBps={coverageBps}
            btcPrice={btcPrice}
            priceError={priceError}
            simulated={simulated}
            actions={actions}
            account={address}
            btcAllowance={funds.data?.btcAllowance}
          />
          <PartiesCard deal={deal} account={address} />
        </aside>
      </div>
    </div>
  );
}
