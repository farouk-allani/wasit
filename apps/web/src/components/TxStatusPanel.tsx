import { CircleCheck, CircleX, ExternalLink, LoaderCircle, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { explorerTx } from "@/lib/links";
import type { TxStatus } from "@/lib/useContractTx";
import { cn } from "@/lib/utils";

const COPY: Record<Exclude<TxStatus["phase"], "idle">, { title: string; body: string }> = {
  checking: {
    title: "Checking the call",
    body: "Simulating it against Mezo testnet before anything is signed.",
  },
  signing: {
    title: "Confirm in your wallet",
    body: "Nothing is sent until you approve it there.",
  },
  pending: {
    title: "Submitted, waiting for a block",
    body: "Mezo testnet usually includes a transaction within seconds. You can leave this page; it will still go through.",
  },
  confirmed: { title: "Confirmed on-chain", body: "" },
  failed: { title: "Not completed", body: "" },
};

/**
 * One transaction's state in plain words, with an explorer link as soon as a hash exists.
 * `confirmed` content (what changed, where to go next) comes from the caller.
 */
export function TxStatusPanel({ status, confirmed }: { status: TxStatus; confirmed?: ReactNode }) {
  if (status.phase === "idle") return null;
  const copy = COPY[status.phase];
  const icon = {
    checking: <LoaderCircle className="size-5 animate-spin text-gold" />,
    signing: <Wallet className="size-5 text-gold" />,
    pending: <LoaderCircle className="size-5 animate-spin text-gold" />,
    confirmed: <CircleCheck className="size-5 text-success" />,
    failed: <CircleX className="size-5 text-destructive" />,
  }[status.phase];
  const hash = "hash" in status ? status.hash : undefined;

  return (
    <div
      role={status.phase === "failed" ? "alert" : "status"}
      aria-live="polite"
      className={cn(
        "flex gap-3 rounded-lg border p-4",
        status.phase === "failed" && "border-destructive/40 bg-destructive/10",
        status.phase === "confirmed" && "border-success/40 bg-success/10",
      )}
    >
      <span aria-hidden className="mt-0.5">
        {icon}
      </span>
      <div className="min-w-0 space-y-1.5 text-sm">
        <p className="font-semibold">{copy.title}</p>
        {status.phase === "failed" ? (
          <p className="text-foreground/85">{status.message}</p>
        ) : (
          copy.body && <p className="text-muted-foreground">{copy.body}</p>
        )}
        {status.phase === "confirmed" && confirmed}
        {hash && (
          <a
            href={explorerTx(hash)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-xs text-gold hover:underline"
          >
            {hash.slice(0, 10)}…{hash.slice(-8)}
            <ExternalLink aria-hidden className="size-3" />
            <span className="sr-only">(view on the Mezo testnet explorer)</span>
          </a>
        )}
      </div>
    </div>
  );
}
