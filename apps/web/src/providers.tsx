import { mezoTestnet } from "@mezo-org/passport";
import { darkTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "./config";

const queryClient = new QueryClient();

// Wallet modal in the brand colors; English until the Arabic/French UI (Wave 2), since RainbowKit
// otherwise follows the browser locale
const baseTheme = darkTheme({
  accentColor: "#ddb886",
  accentColorForeground: "#070f19",
  borderRadius: "medium",
  overlayBlur: "small",
});
const walletTheme = {
  ...baseTheme,
  colors: {
    ...baseTheme.colors,
    modalBackground: "#0f1d2e",
    modalBorder: "rgba(180, 191, 207, 0.14)",
    actionButtonSecondaryBackground: "#1d3149",
    generalBorder: "rgba(180, 191, 207, 0.14)",
    menuItemBackground: "#142539",
    profileForeground: "#0f1d2e",
    connectButtonBackground: "#142539",
  },
  fonts: { body: '"Mona Sans Variable", ui-sans-serif, system-ui, sans-serif' },
};

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
