import { BPS, DealState, wasitEscrowAbi } from "@wasit/sdk";
import { ArrowLeft, CircleAlert, CircleCheck, CircleX, LoaderCircle, Scale } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";
import { isAddressEqual, keccak256, stringToBytes, zeroAddress, type Hex } from "viem";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { useDeal } from "@/data/useDeals";
import { ActionStatus } from "@/deals/ActionStatus";
import { Timeline } from "@/deals/DealHistory";
import { partyName } from "@/deals/DealPage";
import { deadlinesOf } from "@/deals/dealStatus";
import { hashFile, summarize } from "@/deals/terms";
import { useDealLive, useNow } from "@/deals/useDealLive";
import { useDealTx } from "@/deals/useDealTx";
import { useDeployment } from "@/deployment";
import { formatMusd, formatRelative, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { splitPreview } from "./split";

function Centered({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-lg space-y-4 py-16 text-center">{children}</div>;
}

function Row({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
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

/** Checks a file or a text the parties sent against a hash recorded on-chain. */
function HashCheck({
  id,
  label,
  expected,
  mode,
}: {
  id: string;
  label: string;
  expected: Hex;
  mode: "file" | "text";
}) {
  const [actual, setActual] = useState<Hex>();
  const match = actual && actual.toLowerCase() === expected.toLowerCase();
  return (
    <div className="space-y-2">
      <Field id={id} label={label}>
        {(aria) =>
          mode === "file" ? (
            <input
              {...aria}
              type="file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void hashFile(f).then(setActual);
                else setActual(undefined);
              }}
              className="block w-full text-sm file:me-4 file:rounded-md file:border-0 file:bg-muted file:px-4 file:py-2 file:text-sm file:font-semibold"
            />
          ) : (
            <textarea
              {...aria}
              rows={3}
              onChange={(e) =>
                setActual(
                  e.target.value.trim()
                    ? keccak256(stringToBytes(e.target.value.trim()))
                    : undefined,
                )
              }
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
            />
          )
        }
      </Field>
      <p className="font-mono text-xs break-all text-muted-foreground">On-chain: {expected}</p>
      {actual && (
        <p
          className={cn(
            "flex items-center gap-1.5 text-sm font-semibold",
            match ? "text-success" : "text-destructive",
          )}
        >
          {match ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}
          {match
            ? "Matches what was recorded."
            : "Does not match: this is not the recorded version."}
        </p>
      )}
    </div>
  );
}

function Slider({
  id,
  label,
  value,
  onChange,
  disabled,
  left,
  right,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  left: string;
  right: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span className="amount text-lg font-semibold">{value / 100}%</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={BPS}
        step={100}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--gold)] disabled:opacity-40"
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

/**
 * `/arbiter/:id`: the named arbiter reviews a disputed deal (attestations, terms and reason
 * checked against their hashes), sets the balance split and how much of the advance the bond pays
 * back, sees exactly who receives what, and signs the ruling before `ruleBy`.
 */
export function ArbiterPage() {
  const { id: raw } = useParams();
  const { search } = useLocation();
  const id = raw && /^\d+$/.test(raw) ? BigInt(raw) : undefined;
  const { address } = useAccount();
  const d = useDeployment();
  const live = useDealLive(id);
  const history = useDeal(id);
  const now = useNow();
  const tx = useDealTx();
  const [toSupplierBps, setToSupplier] = useState(5_000);
  const [refundBps, setRefund] = useState(0);
  const [armed, setArmed] = useState(false);

  const back = (
    <Link
      to={`/deals/${raw}${search}`}
      className="inline-flex items-center gap-1 text-sm text-gold hover:underline"
    >
      <ArrowLeft className="size-4" /> Deal #{raw}
    </Link>
  );
  if (id === undefined || live.isError || (live.data && !live.data.found))
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">Deal not found</h1>
        <p className="text-muted-foreground">
          Check the link, or reload if Mezo testnet did not answer.
        </p>
      </Centered>
    );
  if (!live.data)
    return (
      <Centered>
        <LoaderCircle aria-hidden className="mx-auto size-6 animate-spin text-gold" />
      </Centered>
    );

  const { deal, bond, coverageBps, simulated } = live.data;
  const view = history.deal;
  if (deal.state !== DealState.Disputed && tx.status.phase !== "confirmed")
    return (
      <Centered>
        <Scale aria-hidden className="mx-auto size-8 text-gold" />
        <h1 className="text-2xl font-semibold">No open dispute on deal #{id.toString()}</h1>
        <p className="text-muted-foreground">
          The arbiter rules only after the buyer disputes a shipment. Before the advance, the
          arbiter accepts the role from the deal page.
        </p>
        {back}
      </Centered>
    );

  const { ruleBy } = deadlinesOf(deal);
  const lapsed = ruleBy !== undefined && now > ruleBy;
  const isArbiter = !!address && isAddressEqual(address, deal.terms.arbiter);
  const bonded = deal.terms.bonder !== zeroAddress;
  const s = splitPreview(deal, toSupplierBps, bonded ? refundBps : 0);
  const net = summarize(deal.terms).netAdvance;
  const bondValue =
    coverageBps !== undefined ? (bond.covered * coverageBps) / BigInt(BPS) : undefined;
  const short = bondValue !== undefined && s.claimAmount > bondValue;

  const rule = () =>
    void tx.run([
      {
        label: "Sign the ruling",
        request: {
          address: d.escrow,
          abi: wasitEscrowAbi,
          functionName: "resolve",
          args: [id, toSupplierBps, bonded ? refundBps : 0],
        },
      },
    ]);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        {back}
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Dispute on deal #{id.toString()}
        </h1>
        {ruleBy !== undefined && (
          <p
            className={cn(
              "text-sm",
              lapsed ? "font-semibold text-warning" : "text-muted-foreground",
            )}
          >
            {lapsed
              ? `The ruling period ended ${formatRelative(ruleBy, now)}. The arbiter can no longer rule; anyone can release the balance to the supplier from the deal page.`
              : `Ruling due ${formatRelative(ruleBy, now)} (${formatTime(ruleBy)}). Without a ruling by then, anyone can release the balance to the supplier.`}
          </p>
        )}
      </header>

      <div className="grid items-start gap-8 lg:grid-cols-[1fr_26rem]">
        <div className="min-w-0 space-y-8">
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>What is at stake</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Row label="Balance in escrow">{formatMusd(deal.balanceHeld)}</Row>
                <Row label="Advance fee in escrow">{formatMusd(deal.advanceFeeHeld)}</Row>
                <Row
                  label="Advance already paid to the supplier"
                  note={bonded ? "backed by the BTC bond" : "no bond: cannot be paid back"}
                >
                  {formatMusd(net)}
                </Row>
                {bonded && (
                  <Row
                    label="Bond value today"
                    note={
                      simulated || d.simulatedPriceFeed
                        ? "Simulated price feed"
                        : "at the oracle price"
                    }
                  >
                    {bondValue !== undefined ? formatMusd(bondValue) : "price unavailable"}
                  </Row>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card className="gap-5">
            <CardHeader>
              <CardTitle>Check what the parties send you</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {view?.disputeReasonHash && (
                <HashCheck
                  id="reason"
                  label="Buyer's written reason"
                  expected={view.disputeReasonHash}
                  mode="text"
                />
              )}
              <HashCheck
                id="terms"
                label="Terms document"
                expected={deal.terms.termsHash}
                mode="file"
              />
              <p className="text-xs text-muted-foreground">
                Files are hashed on this device. A matching hash shows the file is the one recorded;
                it does not show that what it says is true.
              </p>
            </CardContent>
          </Card>

          {view && <Timeline deal={view} nameOf={(a) => partyName(deal.terms, a)} />}
        </div>

        <aside className="order-first space-y-6 lg:sticky lg:top-24 lg:order-none">
          <Card className="gap-5 border-gold/40">
            <CardHeader>
              <CardTitle>Ruling</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <Slider
                id="split"
                label="Balance to the supplier"
                value={toSupplierBps}
                onChange={setToSupplier}
                disabled={lapsed}
                left="All to the buyer"
                right="All to the supplier"
              />
              <Slider
                id="refund"
                label="Advance paid back by the bond"
                value={bonded ? refundBps : 0}
                onChange={setRefund}
                disabled={!bonded || lapsed}
                left="None"
                right="All of it"
              />
              {!bonded && (
                <p className="text-xs text-muted-foreground">
                  This deal has no bond, so the advance cannot be paid back.
                </p>
              )}

              <dl className="divide-y border-t">
                <Row label="Supplier receives" note="balance share after the fee">
                  {formatMusd(s.toSupplier)}
                </Row>
                <Row
                  label="Buyer receives from escrow"
                  note="balance not awarded + share of the advance fee"
                >
                  {formatMusd(s.toBuyer)}
                </Row>
                {bonded && (
                  <Row
                    label="Buyer receives from the bond"
                    note="paid from the bond's MUSD, then BTC sold"
                  >
                    {s.claimAmount > 0n ? `up to ${formatMusd(s.claimAmount)}` : formatMusd(0n)}
                  </Row>
                )}
                <Row label="Protocol fee">{formatMusd(s.earned)}</Row>
              </dl>
              {short && (
                <p className="flex gap-2 text-sm text-warning">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  The bond is worth about {formatMusd(bondValue)} today, less than this claim. The
                  buyer would get what the bond holds, not more.
                </p>
              )}

              {isArbiter && !lapsed ? (
                <div className="space-y-2">
                  <Button
                    className="w-full"
                    size="lg"
                    variant={armed ? "default" : "outline"}
                    disabled={tx.running || tx.status.phase === "confirmed"}
                    onClick={() => (armed ? rule() : setArmed(true))}
                  >
                    {armed ? "Yes, sign this ruling" : "Sign ruling"}
                  </Button>
                  {armed && !tx.running && tx.status.phase === "idle" && (
                    <p className="text-xs text-muted-foreground">
                      A ruling is final and pays out at once.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {lapsed
                    ? "The ruling period is over."
                    : "Only the deal's named arbiter can sign a ruling. Anyone can use this page to preview one."}
                </p>
              )}
              <ActionStatus tx={tx} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
