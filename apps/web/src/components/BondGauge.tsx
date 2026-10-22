import { cn } from "@/lib/utils";

export type CoverageZone = "healthy" | "topUp" | "protect";

export function coverageZone(
  coverageBps: number,
  topUpBps: number,
  protectBps: number,
): CoverageZone {
  if (coverageBps < protectBps) return "protect";
  if (coverageBps < topUpBps) return "topUp";
  return "healthy";
}

const ZONE_LABEL: Record<CoverageZone, string> = {
  healthy: "Healthy",
  topUp: "Top-up advised",
  protect: "Protection available",
};

const ZONE_TEXT: Record<CoverageZone, string> = {
  healthy: "text-success",
  topUp: "text-warning",
  protect: "text-destructive",
};

// Half-circle dial from MIN to MAX coverage, drawn left to right over the top
const MIN = 8_000;
const MAX = 20_000;
const CX = 120;
const CY = 118;
const R = 96;

const clamp = (bps: number) => Math.min(MAX, Math.max(MIN, bps));
const angle = (bps: number) => Math.PI + ((clamp(bps) - MIN) / (MAX - MIN)) * Math.PI;
const point = (bps: number, r = R) =>
  [CX + r * Math.cos(angle(bps)), CY + r * Math.sin(angle(bps))] as const;
const arc = (from: number, to: number) => {
  const [x1, y1] = point(from);
  const [x2, y2] = point(to);
  return `M${x1} ${y1}A${R} ${R} 0 0 1 ${x2} ${y2}`;
};

/**
 * Bond coverage (bond value ÷ net advance) against the deal's top-up and protect thresholds.
 * Below 100% the bond no longer covers the whole advance; the dial still shows where it is.
 */
export function BondGauge({
  coverageBps,
  topUpBps,
  protectBps,
  className,
}: {
  coverageBps: number;
  topUpBps: number;
  protectBps: number;
  className?: string;
}) {
  const zone = coverageZone(coverageBps, topUpBps, protectBps);
  const [mx, my] = point(coverageBps);
  const percent = `${(coverageBps / 100).toFixed(coverageBps % 100 === 0 ? 0 : 1)}%`;
  return (
    <div
      role="meter"
      aria-label="Bond coverage"
      aria-valuemin={0}
      aria-valuemax={MAX / 100}
      aria-valuenow={coverageBps / 100}
      aria-valuetext={`${percent} coverage, ${ZONE_LABEL[zone].toLowerCase()}`}
      className={cn("relative", className)}
    >
      <svg viewBox="0 0 240 132" className="w-full overflow-visible" aria-hidden>
        <path d={arc(MIN, MAX)} className="stroke-foreground/8" strokeWidth="16" fill="none" />
        <path
          d={arc(MIN, protectBps)}
          className="stroke-destructive/70"
          strokeWidth="16"
          fill="none"
        />
        <path
          d={arc(protectBps, topUpBps)}
          className="stroke-warning/75"
          strokeWidth="16"
          fill="none"
        />
        <path d={arc(topUpBps, MAX)} className="stroke-success/60" strokeWidth="16" fill="none" />
        {[10_000, protectBps, topUpBps].map((bps) => {
          const [x1, y1] = point(bps, R - 13);
          const [x2, y2] = point(bps, R + 13);
          const [tx, ty] = point(bps, R + 24);
          return (
            <g key={bps}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                className="stroke-foreground/40"
                strokeWidth="1"
              />
              <text
                x={tx}
                y={ty}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-muted-foreground text-[9px] font-semibold"
              >
                {bps / 100}%
              </text>
            </g>
          );
        })}
        <line
          x1={CX}
          y1={CY}
          x2={mx}
          y2={my}
          className="stroke-gold transition-all duration-300"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx={CX} cy={CY} r="5" className="fill-gold" />
        <circle
          cx={mx}
          cy={my}
          r="7"
          className="fill-background stroke-gold transition-all duration-300"
          strokeWidth="3"
        />
      </svg>
      <div className="mt-2 text-center">
        <p className="amount text-4xl font-semibold tracking-tight">{percent}</p>
        <p className={cn("mt-1 text-sm font-semibold", ZONE_TEXT[zone])}>{ZONE_LABEL[zone]}</p>
      </div>
    </div>
  );
}
