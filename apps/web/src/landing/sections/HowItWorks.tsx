import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Icon3D, type Icon3DName } from "../icons/Icon3D";
import { exampleDeal, params, percent, usd } from "../params";
import { Reveal } from "../Reveal";

const STEPS: { icon: Icon3DName; title: string; body: string }[] = [
  {
    icon: "handshake",
    title: "Agree the terms",
    body: "Amounts, deadlines, who attests and the arbiter are fixed before any money moves.",
  },
  {
    icon: "money-bag",
    title: "Advance, backed by BTC",
    body: "The buyer pays 30% in MUSD. The supplier, or their sourcing agent, locks a BTC bond.",
  },
  {
    icon: "package",
    title: "Signed attestations",
    body: "An inspector signs that the goods are ready, a carrier that they shipped.",
  },
  {
    icon: "balance-scale",
    title: "Release or refund",
    body: "After a challenge window the 70% goes to the supplier. Disputes go to the arbiter.",
  },
];

const example = exampleDeal(10_000n, 3_000n, 15_000n);

/** Four steps on ivory paper, then one worked example of where every dollar sits. */
export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-title"
      className="theme-paper scroll-mt-20 py-16 sm:py-20"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)] lg:gap-14">
          <Reveal className="space-y-5 lg:pt-6">
            <p className="eyebrow">How it works</p>
            <h2
              id="how-title"
              className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-[2.25rem]"
            >
              Every rule is fixed before the first dollar moves.
            </h2>
            <p className="text-[1.05rem] leading-relaxed text-muted-foreground">
              Wasit is a set of contracts on Mezo, not a company holding your money. Funds move only
              by the agreed rules: signatures from the named parties, the arbiter&apos;s ruling, or
              a deadline in the terms passing.
            </p>
            <Button asChild size="lg" className="mt-2">
              <Link to="/deals/new">
                Start a deal <ArrowRight aria-hidden className="rtl:-scale-x-100" />
              </Link>
            </Button>
          </Reveal>

          <ol className="grid content-start gap-x-4 gap-y-8 pt-4 sm:grid-cols-2 xl:grid-cols-4 [&>li]:h-full">
            {STEPS.map(({ icon, title, body }, i) => (
              <li key={title}>
                <Reveal delay={i * 100} className="h-full">
                  <div className="relative flex h-full flex-col rounded-2xl border border-border bg-card px-5 pt-7 pb-4 shadow-[0_1px_0_rgb(17_26_38/0.04),0_16px_40px_-28px_rgb(17_26_38/0.45)]">
                    <span className="absolute -top-4 start-5 grid size-8 place-items-center rounded-full bg-gold-400 text-sm font-bold text-navy-950 shadow-[0_4px_12px_-4px_var(--gold-500)]">
                      {i + 1}
                    </span>
                    <h3 className="text-[1.05rem] font-semibold">{title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
                    <Icon3D name={icon} className="mx-auto mt-auto size-20 pt-3" />
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>

        <Reveal className="mt-12">
          <figure className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-lg font-semibold">Example: a $10,000 order</span>
              <span className="text-sm text-muted-foreground">
                30% advance, bond at 150% of the advance, {percent(params.feeBps)} service fee
              </span>
            </figcaption>
            <div className="mt-6 flex h-3 overflow-hidden rounded-full" aria-hidden>
              <span className="w-[30%] bg-gold-500" />
              <span className="w-[70%] bg-navy-900" />
            </div>
            <dl className="mt-6 grid gap-6 md:grid-cols-3">
              <Line
                term={`Advance ${usd(example.advance)}`}
                tone="bg-gold-500"
                detail={`${usd(example.netAdvance)} reaches the supplier at once to start production. A BTC bond worth about ${usd(example.bondValue)} backs it.`}
              />
              <Line
                term={`Balance ${usd(example.balance)}`}
                tone="bg-navy-900"
                detail={`Held in MUSD escrow. ${usd(example.toSupplierOnRelease)} goes to the supplier after the signed attestations and the challenge window.`}
              />
              <Line
                term={`Fee ${usd(example.totalFee)}`}
                tone="bg-steel-400"
                detail="Charged only on value that stays with the supplier: returned to the buyer on a refund, nothing on the bond, and the bonder earns nothing for guaranteeing."
              />
            </dl>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}

function Line({ term, detail, tone }: { term: string; detail: string; tone: string }) {
  return (
    <div className="space-y-2">
      <dt className="flex items-center gap-2 font-semibold">
        <span aria-hidden className={`size-2.5 rounded-full ${tone}`} />
        <span className="amount">{term}</span>
      </dt>
      <dd className="text-sm leading-relaxed text-muted-foreground">{detail}</dd>
    </div>
  );
}
