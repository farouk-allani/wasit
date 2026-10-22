import { Outlet } from "react-router";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SimulationNotice } from "@/components/layout/SimulationNotice";
import { SkipLink } from "@/components/layout/SkipLink";

/** Landing: the header floats over the full-bleed hero. */
export function MarketingLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <SimulationNotice />
      <SiteHeader variant="marketing" />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
