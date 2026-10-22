import "@rainbow-me/rainbowkit/styles.css";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Outlet } from "react-router";
import { NetworkGuard } from "@/components/NetworkGuard";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SimulationNotice } from "@/components/layout/SimulationNotice";
import { SkipLink } from "@/components/layout/SkipLink";
import { Providers } from "@/providers";

/**
 * App pages: the wallet stack (Passport, wagmi, RainbowKit, about 1.2 MB gzip) loads with this
 * route module only, so the landing page renders without it. Solid header with the wallet,
 * content held to a readable width.
 */
export function Component() {
  return (
    <Providers>
      <div className="flex min-h-dvh flex-col">
        <SkipLink />
        <SimulationNotice />
        <SiteHeader
          variant="app"
          actions={<ConnectButton chainStatus="icon" showBalance={false} accountStatus="address" />}
        />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
          <NetworkGuard>
            <Outlet />
          </NetworkGuard>
        </main>
        <SiteFooter />
      </div>
    </Providers>
  );
}
