import { Landmark } from "lucide-react";
import { Reveal } from "../Reveal";

const FACTS = [
  { value: "30 / 70", label: "Common sourcing terms: deposit, then balance" },
  { value: "$2.5T", label: "Global trade finance gap in 2025" },
  { value: "41%", label: "Of SME trade finance requests rejected" },
];

/** The problem, in the PRD's words: the advance is the exposure. Statistics are context only. */
export function Context() {
  return (
    <section aria-labelledby="context-title" className="bg-navy-950 py-16 sm:py-20">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-16 lg:px-8">
        <Reveal className="space-y-4">
          <p className="eyebrow">The problem</p>
          <h2
            id="context-title"
            className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-[2.3rem]"
          >
            The deposit leaves before the goods exist.
          </h2>
          <p className="leading-relaxed text-foreground/70">
            More importers pay foreign suppliers in stablecoins: fast and final, but with no buyer
            protection, and the production deposit is sent before anything is made. A bank letter of
            credit is slow, costly and often out of reach for small firms.
          </p>
        </Reveal>

        <Reveal delay={100} className="space-y-3">
          <div className="overflow-hidden rounded-2xl border border-border bg-navy-900/60">
            <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {FACTS.map((fact) => (
                <div key={fact.value} className="p-6">
                  <p className="amount text-3xl font-semibold tracking-tight whitespace-nowrap text-gold sm:text-[2rem]">
                    {fact.value}
                  </p>
                  <p className="mt-2 text-sm leading-snug text-muted-foreground">{fact.label}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 border-t border-border bg-gold-400/5 px-6 py-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gold-400/12 text-gold">
                <Landmark aria-hidden className="size-5" />
              </span>
              <p className="text-sm leading-snug text-muted-foreground">
                <span className="font-semibold text-foreground">Wasit does not lend.</span> It
                protects the advance a buyer already pays.
              </p>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Gap and rejection rate: Asian Development Bank, Global Trade Finance Gap Survey (2026).
            Shown as context only.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
