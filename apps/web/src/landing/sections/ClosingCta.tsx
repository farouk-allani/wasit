import { ArrowRight, Code2 } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { REPO_URL } from "@/lib/links";
import portDusk1280 from "../assets/port-dusk-1280.webp";
import { Reveal } from "../Reveal";

/** Bookend to the hero: the same port at dusk, and where to go next. */
export function ClosingCta() {
  return (
    <section aria-labelledby="cta-title" className="relative isolate overflow-hidden bg-navy-950">
      <img
        src={portDusk1280}
        alt=""
        loading="lazy"
        className="absolute inset-0 -z-20 size-full object-cover object-[60%_70%] opacity-60"
      />
      <div className="absolute inset-0 -z-10 bg-linear-to-b from-navy-900 via-navy-950/70 to-navy-950/90" />
      <Reveal className="mx-auto max-w-3xl px-4 py-28 text-center sm:px-6 sm:py-36">
        <p className="eyebrow">Live on Mezo testnet</p>
        <h2
          id="cta-title"
          className="mt-5 text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl"
        >
          Follow a deal from advance to release.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[1.05rem] leading-relaxed text-foreground/75">
          Seeded deals show a completed release, a supplier default paid from the bond, and a bond
          protected after a price drop, all recorded on chain.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/deals">
              Explore the deals <ArrowRight aria-hidden className="rtl:-scale-x-100" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              <Code2 aria-hidden /> Read the code
            </a>
          </Button>
        </div>
      </Reveal>
    </section>
  );
}
