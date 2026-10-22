import { useId, useState } from "react";
import { BondGauge, coverageZone, type CoverageZone } from "@/components/BondGauge";
import { params, percent } from "../params";
import { Reveal } from "../Reveal";

const START_BPS = 15_000;

const RULES: { zone: CoverageZone; title: string; body: string }[] = [
  {
    zone: "healthy",
    title: `At or above ${percent(params.topUpRatioBps)}`,
    body: "The bond is worth comfortably more than the advance. Nothing to do.",
  },
  {
    zone: "topUp",
    title: `Below ${percent(params.topUpRatioBps)}`,
    body: "The deal page warns the bonder. Anyone can add BTC to restore coverage.",
  },
  {
    zone: "protect",
    title: `Below ${percent(params.protectRatioBps)}`,
    body: `Anyone can trigger protection: the bond's BTC is sold for MUSD on Mezo's swap router, within ${percent(params.maxSlippageBps)} of the oracle price, so its value stops falling with BTC.`,
  },
];

const DOT: Record<CoverageZone, string> = {
  healthy: "bg-success",
  topUp: "bg-warning",
  protect: "bg-destructive",
};

/** The bond's rules, with a price-move dial to try them on (an illustration, not live data). */
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
      className="scroll-mt-20 bg-navy-900 py-24 sm:py-32"
    >
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:gap-20 lg:px-8">
        <Reveal className="space-y-8">
          <div className="space-y-5">
            <p className="eyebrow">The bond</p>
            <h2
              id="protection-title"
              className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-[2.6rem]"
            >
              BTC-secured, with limits.
            </h2>
            <p className="text-[1.05rem] leading-relaxed text-foreground/75">
              The supplier, or an agent who vouches for them, locks native BTC on Mezo worth more
              than the advance. Wasit prices it with Mezo&apos;s price oracle and shows the coverage
              ratio on every deal, so nobody has to guess what the bond is worth today.
            </p>
          </div>
          <ul className="space-y-4">
            {RULES.map((rule) => (
              <li key={rule.zone} className="flex gap-4">
                <span
                  aria-hidden
                  className={`mt-2 size-2.5 shrink-0 rounded-full ${DOT[rule.zone]}`}
                />
                <p className="text-sm leading-relaxed text-foreground/75">
                  <span className="font-semibold text-foreground">{rule.title}. </span>
                  {rule.body}
                </p>
              </li>
            ))}
          </ul>
          <p className="rounded-lg border border-warning/30 bg-warning/8 p-4 text-sm leading-relaxed text-foreground/85">
            In a sudden crash the bond can still end up worth less than the advance. If the supplier
            then defaults, the buyer recovers what the bond holds, and the deal page shows the
            shortfall.
          </p>
        </Reveal>

        <Reveal delay={150}>
          <div className="rounded-2xl border border-border bg-navy-850 p-6 sm:p-8">
            <p className="eyebrow text-steel-300">Try it · illustration</p>
            <p className="mt-2 text-sm text-muted-foreground">
              A bond posted at 150% of the advance, as BTC moves.
            </p>
            <BondGauge
              className="mx-auto mt-8 max-w-xs"
              coverageBps={coverageBps}
              topUpBps={params.topUpRatioBps}
              protectBps={params.protectRatioBps}
            />
            <div className="mt-8 space-y-3">
              <label htmlFor={sliderId} className="flex justify-between text-sm">
                <span className="text-muted-foreground">BTC price since the bond was posted</span>
                <span className="amount font-semibold">
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
            </div>
            <p
              aria-live="polite"
              className="mt-5 min-h-[3lh] text-sm leading-relaxed text-foreground/75"
            >
              {coverageBps < 10_000
                ? "The bond is now worth less than the advance. Unless it was protected earlier, a default leaves the buyer with a shortfall."
                : RULES.find((rule) => rule.zone === zone)?.body}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
