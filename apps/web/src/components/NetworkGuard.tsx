import { mezoTestnet } from "@mezo-org/passport";
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";

/** Blocks the page while a connected wallet is on another chain; testnet only (CLAUDE.md). */
export function NetworkGuard({ children }: { children: ReactNode }) {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();
  if (!isConnected || chainId === mezoTestnet.id) return children;
  return (
    <div
      role="alert"
      className="mx-auto max-w-lg space-y-4 rounded-xl border border-warning/40 bg-warning/10 p-6"
    >
      <p className="flex items-center gap-2 font-semibold text-warning">
        <TriangleAlert aria-hidden className="size-5" /> Wrong network
      </p>
      <p className="text-sm leading-relaxed text-foreground/85">
        Wasit runs on Mezo testnet (chain {mezoTestnet.id}). Your wallet is on chain {chainId}.
      </p>
      <Button
        type="button"
        disabled={isPending}
        onClick={() => switchChain({ chainId: mezoTestnet.id })}
      >
        {isPending ? "Switching…" : "Switch to Mezo testnet"}
      </Button>
      {error && <p className="text-sm text-destructive">Could not switch: {error.message}</p>}
    </div>
  );
}
