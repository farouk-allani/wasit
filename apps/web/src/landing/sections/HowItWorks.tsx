import { ArrowLeftRight, Bitcoin, FileSignature, Stamp, type LucideIcon } from "lucide-react";
import { exampleDeal, params, percent, usd } from "../params";
import { Reveal } from "../Reveal";

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: FileSignature,
    title: "Agree the terms",
    body: "Buyer and supplier fix the amounts, the advance share, who attests, every deadline, the challenge window and the arbiter before any money moves.",
  },
  {
    icon: Bitcoin,
    title: "Advance, backed by BTC",
    body: "The buyer pays the advance in MUSD straight to the supplier. The supplier, or a sourcing agent who vouches for them, posts a BTC bond that backs it.",
  },
  {
    icon: Stamp,
    title: "Signed attestations",
    body: "An inspector signs that the goods are ready, a carrier that they shipped. Each signature carries a fingerprint of the evidence file.",
  },
  {
    icon: ArrowLeftRight,
    title: "Release or refund",
    body: "After the challenge window the balance goes to the supplier. A dispute goes to the named arbiter; if the supplier defaults, the buyer claims the bond.",
  },
];

const example = exampleDeal(10_000n, 3_000n, 15_000n);

/** Four steps on ivory paper, then one worked example of where every dollar sits. */
export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-title"
      className="theme-paper scroll-mt-20 py-24 sm:py-32"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="max-w-2xl space-y-5">
          <p className="eyebrow">How it works</p>
          <h2
            id="how-title"
            className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-[2.6rem]"
          >
            Every rule is fixed before the first dollar moves.
          </h2>
          <p className="text-[1.05rem] leading-relaxed text-muted-foreground">
            Wasit is a set of contracts on Mezo, not a company holding your money. Funds move only
            by the agreed rules: signatures from the named parties, the arbiter&apos;s ruling, or a
            deadline in the terms passing.
          </p>
        </Reveal>

        <ol className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4 [&>li]:h-full">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title}>
              <Reveal delay={i * 100} className="h-full">
                <div className="relative flex h-full flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-[0_1px_0_rgb(17_26_38/0.04),0_12px_32px_-24px_rgb(17_26_38/0.35)]">
                  <span className="flex items-center justify-between">
                    <span className="grid size-11 place-items-center rounded-lg bg-navy-900 text-gold-400">
                      <Icon aria-hidden className="size-5" />
                    </span>
                    <span className="font-display text-sm tracking-[0.2em] text-muted-foreground">
                      0{i + 1}
                    </span>
                  </span>
                  <h3 className="text-lg font-semibold">{title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>

        <Reveal className="mt-16">
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
