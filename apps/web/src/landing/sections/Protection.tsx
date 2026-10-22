import { useId, useState } from "react";
import { BondGauge, coverageZone, type CoverageZone } from "@/components/BondGauge";
import { cn } from "@/lib/utils";
import { params, percent } from "../params";
import { Reveal } from "../Reveal";

const START_BPS = 15_000;

const RULES: { zone: CoverageZone; threshold: string; title: string; body: string }[] = [
  {
    zone: "healthy",
    threshold: `${percent(params.topUpRatioBps)}+`,
    title: "Covered",
    body: "The bond is worth well over the advance. Nothing to do.",
  },
  {
    zone: "topUp",
    threshold: `< ${percent(params.topUpRatioBps)}`,
    title: "Top up",
    body: "The bonder is alerted on the deal page, and anyone can add BTC to restore coverage.",
  },
  {
    zone: "protect",
    threshold: `< ${percent(params.protectRatioBps)}`,
    title: "Protect",
    body: `Anyone can lock in the bond's value: its BTC is swapped to MUSD on Mezo's router, within ${percent(params.maxSlippageBps)} of the oracle price.`,
  },
];

const ACCENT: Record<CoverageZone, string> = {
  healthy: "bg-success",
  topUp: "bg-warning",
  protect: "bg-destructive",
};

/** The bond's rules as a ledger, driven by a price-move dial (an illustration, not live data). */
export function Protection() {
  const [move, setMove] = useState(-12);
  const sliderId = useId();
  // A BTC-only bond posted at 150% of the net advance moves one-for-one with the BTC price
  const coverageBps = (START_BPS * (100 + move)) / 100;
  const zone = coverageZone(coverageBps, params.topUpRatioBps, params.protectRatioBps);

  return (
    <section
      id="protection"
      aria-labelledby="protection-title"
      className="relative isolate scroll-mt-20 overflow-hidden bg-navy-900 py-24 sm:py-32"
    >
      <div className="mx-auto grid max-w-7xl items-center gap-16 px-4 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:gap-24 lg:px-8">
        <Reveal className="space-y-10">
          <div className="space-y-5">
            <p className="eyebrow">The bond</p>
            <h2
              id="protection-title"
              className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-[2.6rem]"
            >
              The advance, backed by Bitcoin.
            </h2>
            <p className="max-w-xl text-[1.05rem] leading-relaxed text-foreground/75">
              The supplier, or an agent who vouches for them, locks native BTC on Mezo worth more
              than the advance. Mezo&apos;s price oracle values it around the clock, and every deal
              shows its coverage live.
            </p>
          </div>

          <ol className="divide-y divide-border border-y border-border">
            {RULES.map((rule) => {
              const active = rule.zone === zone;
              return (
                <li
                  key={rule.zone}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "relative grid grid-cols-[5.5rem_1fr] gap-x-6 py-5 ps-4 transition-opacity duration-300 sm:grid-cols-[6.5rem_1fr]",
                    active ? "opacity-100" : "opacity-60",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-y-5 start-0 w-0.5 rounded-full transition-all duration-300",
                      ACCENT[rule.zone],
                      active ? "opacity-100" : "opacity-40",
                    )}
                  />
                  <span className="amount text-xl font-semibold tracking-tight sm:text-2xl">
                    {rule.threshold}
                  </span>
                  <p className="text-sm leading-relaxed text-foreground/75">
                    <span className="block font-semibold text-foreground">{rule.title}</span>
                    {rule.body}
                  </p>
                </li>
              );
            })}
          </ol>

          <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
            In a crash faster than anyone acts, a bond can still fall below the advance. The buyer
            then recovers what it holds, and the deal page shows the difference.
          </p>
        </Reveal>

        <Reveal delay={150} className="relative">
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 -z-10 mx-auto aspect-square max-w-md rounded-full bg-gold-500/10 blur-3xl"
          />
          <BondGauge
            className="mx-auto max-w-sm"
            coverageBps={coverageBps}
            topUpBps={params.topUpRatioBps}
            protectBps={params.protectRatioBps}
          />
          <div className="mx-auto mt-10 max-w-sm space-y-3">
            <label htmlFor={sliderId} className="flex items-baseline justify-between gap-4">
              <span className="eyebrow text-steel-300">Move BTC&apos;s price</span>
              <span className="amount text-sm font-semibold">
                {move > 0 ? "+" : ""}
                {move}%
              </span>
            </label>
            <input
              id={sliderId}
              type="range"
              min={-50}
              max={30}
              step={1}
              value={move}
              onChange={(event) => setMove(Number(event.target.value))}
              className="w-full accent-gold-400"
            />
            <p aria-live="polite" className="min-h-[2lh] text-sm text-muted-foreground">
              {coverageBps < 10_000
                ? "Below the advance. A bond protected earlier kept its locked-in value."
                : `Illustration: a bond posted at ${percent(START_BPS)} of the advance.`}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
