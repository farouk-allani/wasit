import { AttestationKind } from "@wasit/sdk";
import { ExternalLink } from "lucide-react";
import type { Address, Hash } from "viem";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DealView, TimelineEntry } from "@/data/dealModel";
import { formatBtc, formatMusd, formatTime } from "@/lib/format";
import { explorerTx } from "@/lib/links";

const EVENT_LABEL: Partial<Record<TimelineEntry["event"], string>> = {
  DealCreated: "Deal created by the buyer",
  DealAccepted: "Terms accepted by the supplier",
  ArbiterAccepted: "Arbiter accepted the role",
  DealCancelled: "Deal cancelled",
  AdvanceFunded: "Advance paid",
  BalanceFunded: "Balance put in escrow",
  Disputed: "Buyer opened a dispute",
  DisputeLapsed: "Arbiter did not rule in time; the dispute lapsed",
  Released: "Balance released to the supplier",
  Resolved: "Arbiter ruled",
  SupplierDefaulted: "Supplier missed a deadline: buyer refunded",
  BuyerDefaulted: "Buyer did not fund the balance in time",
  BondSettled: "Bond settled",
  BondSettlementFailed: "Bond settlement failed; anyone can retry it",
  BondPosted: "BTC bond posted",
  BondToppedUp: "BTC bond topped up",
  BondWithdrawn: "BTC bond withdrawn",
  BondProtected: "Bond protected: BTC sold for MUSD",
  BondClaimed: "Bond paid the advance back to the buyer",
  BondShortfall: "Bond could not cover the full advance",
  BondReleased: "Bond returned to the bonder",
};

const ATTESTATION_LABEL: Record<number, string> = {
  [AttestationKind.ReadyInspected]: "Inspector signed: goods ready and inspected",
  [AttestationKind.Shipped]: "Carrier signed: goods shipped",
};

const short = (v: string) => `${v.slice(0, 8)}…${v.slice(-6)}`;

function TxLink({ hash }: { hash: Hash }) {
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-gold hover:underline"
    >
      {short(hash)}
      <ExternalLink aria-hidden className="size-3" />
      <span className="sr-only">(view on the Mezo testnet explorer)</span>
    </a>
  );
}

/** Every event of the deal in chain order, with who signed what for attestations. */
export function Timeline({ deal, nameOf }: { deal: DealView; nameOf: (a: Address) => string }) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-5 border-s-2 border-border ps-6">
          {deal.timeline.map((e, i) => {
            const label = e.attestation
              ? ATTESTATION_LABEL[e.attestation.kind]
              : (EVENT_LABEL[e.event] ?? e.event);
            return (
              <li key={`${e.tx}-${i}`} className="relative">
                <span
                  aria-hidden
                  className="absolute top-1.5 -start-[1.95rem] size-3 rounded-full border-2 border-gold bg-card"
                />
                <p className="text-sm font-semibold">{label}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{e.at ? formatTime(e.at) : `block ${e.block.toString()}`}</span>
                  <TxLink hash={e.tx} />
                </p>
                {e.attestation && (
                  <dl className="mt-2 space-y-1 rounded-md bg-muted/60 px-3 py-2 text-xs">
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">Signed by</dt>
                      <dd className="font-mono" title={e.attestation.signer}>
                        {nameOf(e.attestation.signer)}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">Evidence hash</dt>
                      <dd className="font-mono break-all">{e.attestation.evidenceHash}</dd>
                    </div>
                    <p className="text-muted-foreground">
                      The hash proves the evidence file was not altered afterwards. It does not
                      prove the goods themselves.
                    </p>
                  </dl>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

/** Each movement of money or collateral, tied to the transaction that made it. */
export function Ledger({ deal }: { deal: DealView }) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Money ledger</CardTitle>
      </CardHeader>
      <CardContent>
        {deal.ledger.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No money has moved yet. Creating and accepting a deal moves nothing.
          </p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Money movements of this deal</caption>
            <thead className="sr-only">
              <tr>
                <th>What</th>
                <th>Amount</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {deal.ledger.map((l, i) => (
                <tr key={`${l.tx}-${i}`}>
                  <td className="py-2.5 pe-3">{l.label}</td>
                  <td className="py-2.5 pe-3 text-end font-semibold whitespace-nowrap">
                    {l.asset === "BTC" ? formatBtc(l.amount) : formatMusd(l.amount)}
                  </td>
                  <td className="hidden py-2.5 text-end sm:table-cell">
                    <TxLink hash={l.tx} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
