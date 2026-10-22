import { ArrowRight } from "lucide-react";
import { lazy, Suspense, useCallback, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import portDusk1280 from "./assets/port-dusk-1280.webp";
import portDuskGlobe1280 from "./assets/port-dusk-globe-1280.webp";
import portDuskGlobe from "./assets/port-dusk-globe.webp";
import portDusk from "./assets/port-dusk.webp";
import { Icon3D } from "./icons/Icon3D";
import bitcoinLogo from "./logos/bitcoin.svg";
import mezoCircle from "./logos/mezo-circle.svg";
import mezoWordmark from "./logos/mezo-wordmark-white.svg";
import musdLogo from "./logos/musd.svg";
import skipLogo from "./logos/skip.webp";
import { supportsWebGL } from "./webgl";

const GlobeCanvas = lazy(() => import("./globe/GlobeCanvas"));

// Only what Wasit actually uses on Mezo (ADR-024): no logos of services it does not integrate
const SETTLES: StackItem[] = [
  { logo: musdLogo, label: "MUSD" },
  { logo: bitcoinLogo, label: "Native BTC" },
];
const INTEGRATES: StackItem[] = [
  { logo: mezoCircle, label: "Passport" },
  { logo: skipLogo, label: "Skip price feed" },
  { logo: mezoCircle, label: "Mezo Pools" },
];

interface StackItem {
  logo: string;
  label: string;
}

export function Hero() {
  const [webgl, setWebgl] = useState(supportsWebGL);
  const disableGlobe = useCallback(() => setWebgl(false), []);
  // Without WebGL the backdrop that already holds a globe stands in for the live one
  const [backdrop, backdropSmall] = webgl
    ? [portDusk, portDusk1280]
    : [portDuskGlobe, portDuskGlobe1280];

  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-navy-950">
      <img
        src={backdrop}
        srcSet={`${backdropSmall} 1280w, ${backdrop} 1983w`}
        sizes="100vw"
        alt=""
        fetchPriority="high"
        className="absolute inset-0 -z-20 size-full object-cover object-center"
      />
      <div className="absolute inset-0 -z-10 bg-linear-to-t from-navy-950 via-navy-950/85 to-navy-950/10 lg:bg-linear-to-r lg:from-navy-950/95 lg:via-navy-950/55 lg:to-transparent lg:rtl:bg-linear-to-l" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-28 bg-linear-to-t from-navy-950/90 to-transparent" />

      <div className="mx-auto grid min-h-[min(86svh,48rem)] max-w-7xl items-center gap-6 px-4 pt-28 pb-10 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:px-8 lg:pt-20 lg:pb-6">
        <div className="relative z-10 max-w-[40rem] space-y-7">
          <p className="eyebrow">Protected advance payments · Built on Mezo</p>
          <h1
            id="hero-title"
            className="text-[2.6rem] leading-[1.05] font-semibold tracking-[-0.02em] text-balance sm:text-[3.5rem] sm:text-wrap xl:text-[3.7rem]"
          >
            Trade across borders <br className="hidden sm:block" />
            with <span className="text-gold">confidence.</span>
          </h1>
          <p className="max-w-lg text-lg leading-relaxed text-foreground/80">
            Pay a supplier&apos;s production advance in MUSD without paying blind. A BTC bond backs
            the advance, and the balance waits in escrow until named parties sign that the goods are
            ready and shipped.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/deals/new">
                Start a deal <ArrowRight aria-hidden className="rtl:-scale-x-100" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#deal-flow">See the deal flow</a>
            </Button>
          </div>
        </div>

        <div className="relative -order-1 mx-auto aspect-square w-full max-w-[22rem] sm:max-w-md lg:order-none lg:-my-8 lg:max-w-none">
          <div className="absolute inset-x-[12%] bottom-[2%] h-[14%] rounded-[50%] bg-gold-400/25 blur-3xl" />
          {webgl && (
            <Suspense fallback={null}>
              <GlobeCanvas className="absolute -inset-[8%]" onFail={disableGlobe} />
            </Suspense>
          )}
          <FlowCard
            className="-start-[6%] top-[14%]"
            icon={<Icon3D name="dollar-banknote" className="size-8" />}
            title="Buyer"
            delay="delay-700"
            status="Advance paid"
          >
            Pays 30% in MUSD
          </FlowCard>
          <FlowCard
            className="-end-[10%] top-[18%]"
            icon={<Icon3D name="coin" className="size-8" />}
            title="Supplier"
            delay="delay-1000"
            status="Bond posted"
          >
            Locks a BTC bond
          </FlowCard>
          <FlowCard
            className="end-[8%] top-[54%]"
            icon={
              <span className="grid size-10 place-items-center rounded-lg bg-gold-400/15">
                <Icon3D name="locked" className="size-7" />
              </span>
            }
            title="Wasit escrow"
            delay="delay-[1300ms]"
          >
            Holds the 70% until signed release
          </FlowCard>
        </div>
      </div>

      <div className="border-t border-white/10 bg-navy-950/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-7 gap-y-5 px-4 py-6 sm:px-6 lg:px-8">
          <div className="space-y-1">
            <p className="eyebrow text-[0.6rem] text-steel-300">Built on</p>
            <img src={mezoWordmark} alt="Mezo" width={4098} height={566} className="h-5 w-auto" />
          </div>
          <StackGroup label="Settles in" items={SETTLES} />
          <StackGroup label="Integrates with" items={INTEGRATES} />
        </div>
      </div>
    </section>
  );
}

/** A role in the deal, floating beside the globe (desktop only; the sections below repeat it). */
function FlowCard({
  className,
  icon,
  title,
  delay,
  status,
  children,
}: {
  className?: string;
  icon: ReactNode;
  title: string;
  delay: string;
  status?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute z-10 hidden max-w-56 animate-in items-center gap-3 rounded-xl border border-white/12 bg-navy-900/60 px-3.5 py-3 shadow-[0_20px_40px_-20px_rgb(0_0_0/0.8)] backdrop-blur-md duration-1000 fill-mode-backwards fade-in slide-in-from-bottom-3 lg:flex",
        delay,
        className,
      )}
    >
      {icon}
      <span className="space-y-0.5">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs leading-snug text-foreground/70">{children}</span>
        {status && (
          <span className="flex items-center gap-1.5 pt-0.5 text-xs text-foreground/85">
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-success shadow-[0_0_8px_var(--success)]"
            />
            {status}
          </span>
        )}
      </span>
    </div>
  );
}

/** One labelled group of the "Built on Mezo" strip, set off by a divider on wide screens. */
function StackGroup({ label, items }: { label: string; items: StackItem[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 lg:border-s lg:border-white/10 lg:ps-7">
      <p className="eyebrow text-[0.65rem] text-steel-300">{label}</p>
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {items.map(({ logo, label: name }) => (
          <li key={name} className="flex items-center gap-2.5 text-[0.95rem] font-medium">
            <img src={logo} alt="" width={28} height={28} className="size-7 rounded-full" />
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}
