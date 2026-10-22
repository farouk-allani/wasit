import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { ContractRequest } from "@/lib/tx";
import { useContractTx } from "@/lib/useContractTx";

export interface TxStep {
  /** Shown above the status, e.g. "Approve BTC (1 of 2)". */
  label: string;
  request: ContractRequest;
}

/**
 * Sends a short sequence of transactions (an approval, then the action) one after the other and
 * stops at the first that fails. Afterwards the deal, its history and the wallet are re-read.
 */
export function useDealTx() {
  const tx = useContractTx();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState<string>();
  const [running, setRunning] = useState(false);

  const run = useCallback(
    async (steps: TxStep[]) => {
      setRunning(true);
      try {
        for (const [i, step] of steps.entries()) {
          setLabel(steps.length > 1 ? `${step.label} (${i + 1} of ${steps.length})` : step.label);
          if (!(await tx.send(step.request))) return false;
        }
        return true;
      } finally {
        setRunning(false);
        for (const key of ["deal-live", "deals", "wallet-funds"])
          void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    [tx, queryClient],
  );

  const reset = useCallback(() => {
    tx.reset();
    setLabel(undefined);
  }, [tx]);

  return { status: tx.status, label, running, run, reset };
}
