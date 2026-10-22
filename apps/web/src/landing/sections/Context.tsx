import { Reveal } from "../Reveal";

const FACTS = [
  {
    value: "30 / 70",
    label: "Common sourcing terms: a deposit to start production, the balance before shipping",
  },
  { value: "$2.5T", label: "Global trade finance gap in 2025" },
  { value: "41%", label: "Of SME trade finance requests rejected" },
];

/** The problem, in the PRD's words: the advance is the exposure. Statistics are context only. */
export function Context() {
  return (
    <section aria-labelledby="context-title" className="bg-navy-950 py-24 sm:py-32">
      <div className="mx-auto grid max-w-7xl gap-14 px-4 sm:px-6 lg:grid-cols-2 lg:gap-20 lg:px-8">
        <Reveal className="space-y-6">
          <p className="eyebrow">The problem</p>
          <h2
            id="context-title"
            className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-[2.6rem]"
          >
            The deposit leaves before the goods exist.
          </h2>
          <div className="space-y-4 text-[1.05rem] leading-relaxed text-foreground/75">
            <p>
              More importers pay foreign suppliers in stablecoins: faster than a wire, and final. A
              stablecoin transfer has no buyer protection, and the production deposit is sent before
              anything is made.
            </p>
            <p>
              The usual fallbacks are a marketplace&apos;s own buyer protection, which works only on
              that marketplace, or a bank letter of credit, which is slow, costly and often out of
              reach for small firms.
            </p>
          </div>
        </Reveal>

        <div className="grid content-start gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          {FACTS.map((fact, i) => (
            <Reveal key={fact.value} delay={i * 120}>
              <div className="h-full rounded-xl border border-border bg-navy-900/60 p-6">
                <p className="amount text-4xl font-semibold tracking-tight text-gold">
                  {fact.value}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{fact.label}</p>
              </div>
            </Reveal>
          ))}
          <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-3 lg:col-span-1 xl:col-span-3">
            Gap and rejection rate: Asian Development Bank, Global Trade Finance Gap Survey (2026).
            Shown as context only: Wasit does not lend. It protects the advance a buyer already
            pays.
          </p>
        </div>
      </div>
    </section>
  );
}
