import { Outlet } from "react-router";
import { NetworkGuard } from "@/components/NetworkGuard";
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

/** App pages: solid header with the wallet, content held to a readable width. */
export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <SimulationNotice />
      <SiteHeader variant="app" />
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
        <NetworkGuard>
          <Outlet />
        </NetworkGuard>
      </main>
      <SiteFooter />
    </div>
  );
}
