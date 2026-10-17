import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Link, Outlet } from "react-router";
import { NetworkGuard } from "../components/NetworkGuard";
import { useDeployment } from "../deployment";

/** Unstyled app frame until the design lands (PLAN 4.2). */
export function Shell() {
  const deployment = useDeployment();
  return (
    <>
      <header>
        <Link to="/">Wasit</Link> <ConnectButton />
      </header>
      {deployment.simulatedPriceFeed && <p role="status">Simulated price feed</p>}
      <NetworkGuard>
        <main>
          <Outlet />
        </main>
      </NetworkGuard>
      <footer>Testnet · designed to avoid interest · Shariah review pending</footer>
    </>
  );
}
