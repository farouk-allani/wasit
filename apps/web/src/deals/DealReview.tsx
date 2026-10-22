import type { DealTerms } from "@wasit/sdk";
import { zeroAddress, type Address } from "viem";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration, formatMusd } from "@/lib/format";
import { explorerAddress } from "@/lib/links";
import { percent } from "@/landing/params";
import { summarize } from "./terms";

type Money = Pick<DealTerms, "advanceAmount" | "balanceAmount" | "feeBps" | "bondRatioBps">;

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-sm text-muted-foreground">
        {label}
        {note && <span className="block text-xs text-muted-foreground/80">{note}</span>}
      </dt>
      <dd className="amount text-end text-sm font-semibold whitespace-nowrap">{value}</dd>
    </div>
  );
}

/** Where every MUSD of the deal goes; used live beside the form and on the review screen. */
export function MoneySummary({ terms, hasBond }: { terms: Money; hasBond: boolean }) {
  const s = summarize(terms);
  return (
    <dl className="divide-y divide-border">
      <Row label="Order total" value={formatMusd(s.total)} />
      <Row
        label="Supplier gets when you fund the advance"
        value={formatMusd(s.netAdvance)}
        note={`advance less ${percent(terms.feeBps)} fee`}
      />
      <Row
        label="Supplier gets on release"
        value={formatMusd(s.netBalance)}
        note={`balance less ${percent(terms.feeBps)} fee`}
      />
      <Row
        label="Protocol fee"
        value={formatMusd(s.advanceFee + s.balanceFee)}
        note="returned to you if the supplier defaults"
      />
      <Row
        label="BTC bond to post"
        value={hasBond ? `≥ ${formatMusd(s.bondTarget)}` : "None"}
        note={
          hasBond ? `${percent(terms.bondRatioBps)} of the net advance, valued in MUSD` : undefined
        }
      />
    </dl>
  );
}

function AddressRow({ label, address }: { label: string; address: Address }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        <a
          href={explorerAddress(address)}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-sm break-all hover:text-gold hover:underline"
        >
          {address}
        </a>
      </dd>
    </div>
  );
}

/** Everything the buyer is about to sign, as it will be stored on-chain. */
export function DealReview({ terms, termsFileName }: { terms: DealTerms; termsFileName: string }) {
  const hasBond = terms.bonder !== zeroAddress;
  const periods = [
    ["Production", terms.productionPeriod],
    ["Balance window", terms.balanceWindow],
    ["Shipping", terms.shippingPeriod],
    ["Challenge window", terms.challengeWindow],
    ["Arbitration", terms.arbitrationPeriod],
  ] as const;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Parties</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            <AddressRow label="Buyer (you)" address={terms.buyer} />
            <AddressRow label="Supplier" address={terms.supplier} />
            <AddressRow label="Arbiter" address={terms.arbiter} />
            <AddressRow label="Inspector" address={terms.inspector} />
            <AddressRow label="Carrier" address={terms.carrier} />
            {hasBond && <AddressRow label="Bonder" address={terms.bonder} />}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Money</CardTitle>
        </CardHeader>
        <CardContent>
          <MoneySummary terms={terms} hasBond={hasBond} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Deadlines</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            {periods.map(([label, seconds]) => (
              <Row key={label} label={label} value={formatDuration(seconds)} />
            ))}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Terms document</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="font-medium">{termsFileName}</p>
          <p className="font-mono text-xs break-all text-muted-foreground">{terms.termsHash}</p>
          <p className="text-muted-foreground">
            Only this fingerprint goes on-chain. Keep the file.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
