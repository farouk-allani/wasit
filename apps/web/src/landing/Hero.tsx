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
import { supportsWebGL } from "./webgl";

const GlobeCanvas = lazy(() => import("./globe/GlobeCanvas"));

const STACK = [
  "MUSD settlement",
  "Native BTC bond",
  "Skip price feed",
  "Mezo swap router",
  "Mezo Passport",
];

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
        className="absolute inset-0 -z-20 size-full object-cover object-[70%_center]"
      />
      <div className="absolute inset-0 -z-10 bg-linear-to-t from-navy-950 via-navy-950/85 to-navy-950/10 lg:bg-linear-to-r lg:from-navy-950 lg:via-navy-950/75 lg:to-navy-950/10 lg:rtl:bg-linear-to-l" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-48 bg-linear-to-t from-navy-950 to-transparent" />

      <div className="mx-auto grid min-h-[min(100svh,58rem)] max-w-7xl items-center gap-6 px-4 pt-28 pb-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:px-8 lg:pt-24">
        <div className="relative z-10 max-w-xl space-y-7">
          <p className="eyebrow">Protected advance payments · Built on Mezo</p>
          <h1
            id="hero-title"
            className="text-[2.6rem] leading-[1.04] font-semibold tracking-[-0.025em] text-balance sm:text-6xl"
          >
            Trade across borders with <span className="text-gold">confidence.</span>
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
              <a href="#how-it-works">See how it works</a>
            </Button>
          </div>
        </div>

        <div className="relative -order-1 mx-auto aspect-square w-full max-w-[22rem] sm:max-w-md lg:order-none lg:max-w-none">
          <div className="absolute inset-x-[12%] bottom-[2%] h-[14%] rounded-[50%] bg-gold-400/25 blur-3xl" />
          {webgl && (
            <Suspense fallback={null}>
              <GlobeCanvas className="absolute -inset-[8%]" onFail={disableGlobe} />
            </Suspense>
          )}
          <FlowCard
            className="start-0 top-[8%]"
            icon={<Icon3D name="dollar-banknote" />}
            title="Buyer"
            delay="delay-700"
          >
            Pays the 30% advance in MUSD, straight to the supplier
          </FlowCard>
          <FlowCard
            className="-end-2 top-[34%] xl:-end-6"
            icon={<Icon3D name="coin" />}
            title="Supplier or agent"
            delay="delay-1000"
          >
            Posts a BTC bond that backs the advance
          </FlowCard>
          <FlowCard
            className="start-[10%] bottom-[9%]"
            icon={<Icon3D name="locked" />}
            title="Wasit escrow"
            delay="delay-[1300ms]"
          >
            Holds the 70% balance until signed release
          </FlowCard>
        </div>
      </div>

      <div className="border-t border-white/10 bg-navy-950/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-5 sm:px-6 lg:px-8">
          <p className="eyebrow text-steel-300">Built on Mezo</p>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-foreground/75">
            {STACK.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span aria-hidden className="size-1 rounded-full bg-gold" />
                {item}
              </li>
            ))}
          </ul>
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
  children,
}: {
  className?: string;
  icon: ReactNode;
  title: string;
  delay: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute z-10 hidden w-64 animate-in items-center gap-3 rounded-xl border border-white/12 bg-navy-900/55 p-4 shadow-[0_20px_40px_-20px_rgb(0_0_0/0.8)] backdrop-blur-md duration-1000 fill-mode-backwards fade-in slide-in-from-bottom-3 lg:flex",
        delay,
        className,
      )}
    >
      {icon}
      <span className="space-y-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-[0.8rem] leading-snug text-foreground/70">{children}</span>
      </span>
    </div>
  );
}
