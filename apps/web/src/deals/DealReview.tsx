import type { DealTerms } from "@wasit/sdk";
import { CircleAlert, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { zeroAddress, type Address } from "viem";
import { Card } from "@/components/ui/card";
import { percent } from "@/landing/params";
import { formatDuration, formatMusd } from "@/lib/format";
import { explorerAddress } from "@/lib/links";
import { PERIODS } from "./terms";
import { selfAttestations, summarize } from "./terms";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t px-6 py-6 sm:px-8">
      <h2 className="eyebrow">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm">
        {label}
        {note && <span className="block text-xs text-muted-foreground">{note}</span>}
      </dt>
      <dd className="text-end text-sm font-semibold whitespace-nowrap">{children}</dd>
    </div>
  );
}

function Party({ role, address }: { role: string; address: Address }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm">{role}</dt>
      <dd className="min-w-0">
        <a
          href={explorerAddress(address)}
          target="_blank"
          rel="noreferrer"
          title={address}
          className="inline-flex items-center gap-1.5 font-mono text-xs hover:text-gold hover:underline"
        >
          <span className="hidden md:inline">{address}</span>
          <span className="md:hidden">
            {address.slice(0, 8)}…{address.slice(-6)}
          </span>
          <ExternalLink aria-hidden className="size-3 shrink-0" />
        </a>
      </dd>
    </div>
  );
}

const SECONDS: Record<(typeof PERIODS)[number]["key"], keyof DealTerms> = {
  production: "productionPeriod",
  balanceWindow: "balanceWindow",
  shipping: "shippingPeriod",
  challenge: "challengeWindow",
  arbitration: "arbitrationPeriod",
};

/** The terms exactly as `createDeal` will store them, laid out as one document. */
export function DealReview({ terms, termsFileName }: { terms: DealTerms; termsFileName: string }) {
  const hasBond = terms.bonder !== zeroAddress;
  const s = summarize(terms);
  const selfSigned = selfAttestations(terms);
  const upfrontPct = Number((terms.advanceAmount * 10_000n) / s.total) / 100;

  return (
    <Card className="gap-0 py-0">
      <header className="space-y-4 px-6 py-7 sm:px-8">
        <p className="text-sm text-muted-foreground">Order value</p>
        <p className="text-4xl font-semibold tracking-tight">{formatMusd(s.total)}</p>
        <div className="flex h-2.5 overflow-hidden rounded-full">
          <div className="bg-gold" style={{ width: `${upfrontPct}%` }} />
          <div className="flex-1 bg-navy-700" />
        </div>
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="me-2 inline-block size-2 rounded-full bg-gold" />
            {formatMusd(terms.advanceAmount)} upfront ({upfrontPct}%)
          </span>
          <span>
            <span className="me-2 inline-block size-2 rounded-full bg-navy-700" />
            {formatMusd(terms.balanceAmount)} in escrow
          </span>
        </div>
      </header>

      <Section title="Money">
        <dl className="divide-y">
          <Row
            label="Supplier receives when you pay the advance"
            note={`after the ${percent(terms.feeBps)} fee`}
          >
            {formatMusd(s.netAdvance)}
          </Row>
          <Row label="Supplier receives on release" note={`after the ${percent(terms.feeBps)} fee`}>
            {formatMusd(s.netBalance)}
          </Row>
          <Row label="Protocol fee" note="returned to you if the supplier defaults">
            {formatMusd(s.advanceFee + s.balanceFee)}
          </Row>
          <Row
            label="BTC bond"
            note={
              hasBond
                ? `${percent(terms.bondRatioBps)} of what the supplier receives upfront`
                : "the advance is unprotected"
            }
          >
            {hasBond ? `≥ ${formatMusd(s.bondTarget)}` : "None"}
          </Row>
        </dl>
      </Section>

      <Section title="People">
        <dl className="divide-y">
          <Party role="Buyer (you)" address={terms.buyer} />
          <Party role="Supplier" address={terms.supplier} />
          <Party role="Inspector" address={terms.inspector} />
          <Party role="Carrier" address={terms.carrier} />
          <Party role="Arbiter" address={terms.arbiter} />
          {hasBond && <Party role="Posts the BTC" address={terms.bonder} />}
        </dl>
        {selfSigned.length > 0 && (
          <div className="flex gap-3 rounded-lg bg-warning/15 px-4 py-3 text-sm leading-relaxed">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="space-y-1">
              {selfSigned.map((w) => (
                <p key={w}>{w}</p>
              ))}
              <p>
                This is allowed, but nobody independent checks that step. Name someone else if you
                can.
              </p>
            </div>
          </div>
        )}
      </Section>

      <Section title="Deadlines">
        <dl className="divide-y">
          {PERIODS.map((p) => (
            <Row key={p.key} label={p.label}>
              {formatDuration(Number(terms[SECONDS[p.key]]))}
            </Row>
          ))}
        </dl>
      </Section>

      <Section title="Terms document">
        <p className="text-sm font-semibold break-all">{termsFileName}</p>
        <p className="font-mono text-xs break-all text-muted-foreground">{terms.termsHash}</p>
      </Section>
    </Card>
  );
}
