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
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)] lg:gap-14 lg:px-8">
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

        <div className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-[1fr_1fr_1fr_1.35fr]">
            {FACTS.map((fact, i) => (
              <Reveal key={fact.value} delay={i * 100}>
                <div className="h-full rounded-xl border border-border bg-navy-900/60 p-5">
                  <p className="amount text-3xl font-semibold tracking-tight text-gold">
                    {fact.value}
                  </p>
                  <p className="mt-2 text-sm leading-snug text-muted-foreground">{fact.label}</p>
                </div>
              </Reveal>
            ))}
            <Reveal delay={300} className="sm:col-span-3 xl:col-span-1">
              <div className="flex h-full items-center gap-4 rounded-xl border border-border bg-navy-900/60 p-5">
                <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-gold-400/12 text-gold">
                  <Landmark aria-hidden className="size-5" />
                </span>
                <span className="space-y-1">
                  <span className="block font-semibold">Wasit does not lend</span>
                  <span className="block text-sm leading-snug text-muted-foreground">
                    It protects the advance a buyer already pays.
                  </span>
                </span>
              </div>
            </Reveal>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Gap and rejection rate: Asian Development Bank, Global Trade Finance Gap Survey (2026).
            Shown as context only.
          </p>
        </div>
      </div>
    </section>
  );
}
