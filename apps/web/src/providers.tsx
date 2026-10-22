import { mezoTestnet } from "@mezo-org/passport";
import { darkTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "./config";

const queryClient = new QueryClient();

// Wallet modal in the brand colors; English until the Arabic/French UI (Wave 2), since RainbowKit
// otherwise follows the browser locale
const walletTheme = darkTheme({
  accentColor: "#ddb886",
  accentColorForeground: "#070f19",
  borderRadius: "medium",
  overlayBlur: "small",
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider initialChain={mezoTestnet} theme={walletTheme} locale="en-US">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
