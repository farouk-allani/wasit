import { mezoTestnet } from "@mezo-org/passport";
import type { ReactNode } from "react";
import { useAccount, useSwitchChain } from "wagmi";

/** Blocks the page while a connected wallet is on another chain; testnet only (CLAUDE.md). */
export function NetworkGuard({ children }: { children: ReactNode }) {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();
  if (!isConnected || chainId === mezoTestnet.id) return children;
  return (
    <div role="alert">
      <p>
        Wasit runs on Mezo testnet (chain {mezoTestnet.id}). Your wallet is on chain {chainId}.
      </p>
      <button
        type="button"
        disabled={isPending}
        onClick={() => switchChain({ chainId: mezoTestnet.id })}
      >
        {isPending ? "Switching…" : "Switch to Mezo testnet"}
      </button>
      {error && <p>Could not switch: {error.message}</p>}
    </div>
  );
}
