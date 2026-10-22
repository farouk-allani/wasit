import { TxStatusPanel } from "@/components/TxStatusPanel";
import type { useDealTx } from "./useDealTx";

/** Which transaction of a sequence is running, and its state. */
export function ActionStatus({ tx }: { tx: ReturnType<typeof useDealTx> }) {
  if (tx.status.phase === "idle") return null;
  return (
    <div className="space-y-2">
      {tx.label && <p className="text-xs font-semibold text-muted-foreground">{tx.label}</p>}
      <TxStatusPanel status={tx.status} />
    </div>
  );
}
