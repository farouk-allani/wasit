import { getConfig } from "@mezo-org/passport";

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
if (!projectId)
  console.warn("VITE_WALLETCONNECT_PROJECT_ID is not set: WalletConnect wallets are off");

/** wagmi config from Mezo Passport: Mezo testnet, EVM and Bitcoin wallets (ADR-023). */
export const wagmiConfig = getConfig({
  appName: "Wasit",
  mezoNetwork: "testnet",
  walletConnectProjectId: projectId ?? "unset",
});
