import { Check, Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import { useAccount } from "wagmi";
import { loadPilotKey, PILOT_CONNECTOR_ID } from "./pilotWallet";

/**
 * Permanent line while the test wallet is connected: what it is, its address, and a way to take
 * the key elsewhere. The key is shown only on request and only on this device.
 */
export function PilotWalletBar() {
  const { address, connector } = useAccount();
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState<"address" | "key">();
  if (!address || connector?.id !== PILOT_CONNECTOR_ID) return null;

  const copy = async (what: "address" | "key", text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(what);
  };
  const key = showKey ? loadPilotKey() : undefined;

  return (
    <div
      role="status"
      className="border-b border-gold/40 bg-navy-850 px-4 py-2 text-sm text-ivory-100"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1">
        <strong className="text-gold">Test wallet · Mezo test network · no real money</strong>
        <button
          type="button"
          onClick={() => void copy("address", address)}
          className="inline-flex items-center gap-1 font-mono text-xs hover:underline"
          aria-label="Copy test wallet address"
        >
          {address.slice(0, 8)}…{address.slice(-6)}
          {copied === "address" ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
        <button
          type="button"
          onClick={() => setShowKey((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-steel-300 hover:underline"
        >
          <KeyRound className="size-3" /> {showKey ? "Hide key" : "Export key"}
        </button>
      </div>
      {key && (
        <div className="mx-auto mt-2 max-w-7xl space-y-1 text-xs text-steel-300">
          <p>
            Anyone with this key controls this test wallet. It holds no real money. You can import
            it into MetaMask to keep using the same address.
          </p>
          <button
            type="button"
            onClick={() => void copy("key", key)}
            className="inline-flex items-center gap-1 font-mono break-all text-ivory-100 hover:underline"
          >
            {key} {copied === "key" ? <Check className="size-3" /> : <Copy className="size-3" />}
          </button>
        </div>
      )}
    </div>
  );
}
