import "@rainbow-me/rainbowkit/styles.css";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Outlet } from "react-router";
import { NetworkGuard } from "@/components/NetworkGuard";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { LiveSimulationNotice } from "@/components/layout/SimulationNotice";
import { SkipLink } from "@/components/layout/SkipLink";
import { Providers } from "@/providers";

/**
 * App pages: the wallet stack (Passport, wagmi, RainbowKit, about 1.2 MB gzip) loads with this
 * route module only, so the landing page renders without it. Navy header and footer like the
 * landing; the working area is ivory paper (`.theme-paper`) so forms and figures read clearly.
 */
export function Component() {
  return (
    <Providers>
      <div className="flex min-h-dvh flex-col">
        <SkipLink />
        <LiveSimulationNotice />
        <SiteHeader
          variant="app"
          actions={<ConnectButton chainStatus="icon" showBalance={false} accountStatus="address" />}
        />
        <main id="main" className="theme-paper flex-1">
          <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
            <NetworkGuard>
              <Outlet />
            </NetworkGuard>
          </div>
        </main>
        <SiteFooter />
      </div>
    </Providers>
  );
}
