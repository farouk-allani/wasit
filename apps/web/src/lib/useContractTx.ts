import { mezoTestnet } from "@mezo-org/passport";
import { useCallback, useRef, useState } from "react";
import type { Hash, TransactionReceipt } from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { publicClient } from "@/data/client";
import { describeTxError, prepareGas, waitForReceipt, type ContractRequest } from "./tx";

/** Where a transaction is, in the words the UI shows (CLAUDE.md: honest states). */
export type TxStatus =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "signing" }
  | { phase: "pending"; hash: Hash }
  | { phase: "confirmed"; hash: Hash; receipt: TransactionReceipt }
  | { phase: "failed"; message: string; hash?: Hash };

/**
 * Sends one contract call from the connected wallet: simulate and size gas against the public
 * RPC, ask the wallet to sign with that limit, then poll for the receipt. Returns the receipt, or
 * undefined when the call failed (the reason is in `status`).
 */
export function useContractTx() {
  const { address } = useAccount();
  const { data: wallet } = useWalletClient();
  const [status, setStatus] = useState<TxStatus>({ phase: "idle" });
  const busy = useRef(false);

  const send = useCallback(
    async (request: ContractRequest): Promise<TransactionReceipt | undefined> => {
      if (busy.current) return undefined;
      if (!wallet || !address) {
        setStatus({ phase: "failed", message: "Connect a wallet first." });
        return undefined;
      }
      busy.current = true;
      let hash: Hash | undefined;
      try {
        setStatus({ phase: "checking" });
        const gas = await prepareGas(publicClient, request, address);
        setStatus({ phase: "signing" });
        hash = await wallet.writeContract({
          ...request,
          account: address,
          chain: mezoTestnet,
          gas,
        });
        setStatus({ phase: "pending", hash });
        const receipt = await waitForReceipt(publicClient, hash);
        setStatus({ phase: "confirmed", hash, receipt });
        return receipt;
      } catch (err) {
        setStatus({ phase: "failed", message: describeTxError(err), hash });
        return undefined;
      } finally {
        busy.current = false;
      }
    },
    [wallet, address],
  );

  const reset = useCallback(() => setStatus({ phase: "idle" }), []);
  return { status, send, reset };
}
