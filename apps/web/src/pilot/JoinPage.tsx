import { Check, Copy, LoaderCircle, Send, Wallet } from "lucide-react";
import { useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { shareText } from "./share";
import { usePilotWallet } from "./usePilotWallet";

/**
 * `/join`: someone outside the team makes a test wallet on their own phone and sends its address
 * back, so a test deal can name them (PLAN 9.2). Nothing here touches real money.
 */
export function JoinPage() {
  const pilot = usePilotWallet();
  const { address } = useAccount();
  const [error, setError] = useState<string>();
  const [about, setAbout] = useState("");
  const [copied, setCopied] = useState(false);
  const mine = address ?? pilot.storedAddress;

  const create = async () => {
    setError(undefined);
    try {
      await pilot.connect();
    } catch (e) {
      setError(
        e instanceof Error && /would not store/.test(e.message)
          ? "This browser would not keep the test wallet (private mode?). Open the link in a normal tab."
          : "The test wallet could not start. Reload the page and try again.",
      );
    }
  };

  const message = mine
    ? `My address for a Wasit test deal: ${mine}${about.trim() ? `\nYou can describe me as: ${about.trim()}` : ""}`
    : "";

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header className="space-y-3">
        <p className="text-xs font-semibold tracking-[0.2em] text-gold uppercase">
          Test network · no real money
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Take part in a Wasit test deal</h1>
        <p className="leading-relaxed text-muted-foreground">
          Wasit is a project in the Mezo buildathon. It holds a buyer&apos;s payment until named
          people confirm each step of an order. Everything here runs on a test network: no real
          money is involved, and you install nothing.
        </p>
      </header>

      <Card>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p className="font-semibold">What happens</p>
          <ol className="list-decimal space-y-2 ps-5">
            <li>
              This page makes a test wallet in your browser. Its key stays on this phone; nobody
              else ever sees it.
            </li>
            <li>You send its address to the person who invited you.</li>
            <li>
              They create a test deal that names you and send you a second link. You read one screen
              and tap once.
            </li>
          </ol>
        </CardContent>
      </Card>

      {!mine ? (
        <div className="space-y-3">
          <Button
            size="lg"
            className="w-full"
            disabled={pilot.connecting}
            onClick={() => void create()}
          >
            {pilot.connecting ? <LoaderCircle className="animate-spin" /> : <Wallet />} Create my
            test wallet
          </Button>
          <p className="text-xs text-muted-foreground">
            Already use a wallet such as MetaMask? Connect it with the button at the top instead,
            and send that address.
          </p>
          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
        </div>
      ) : (
        <Card>
          <CardContent className="space-y-5">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                {address && !pilot.active ? "Your connected wallet" : "Your test wallet"}
              </p>
              <p className="font-mono text-sm break-all">{mine}</p>
            </div>
            <Field
              id="about"
              label="How may we describe you? (optional)"
              hint="For example: “works in freight in Sfax” or “builder on another buildathon team”. We only use it with your permission, exactly as you write it."
            >
              {(aria) => (
                <Input
                  {...aria}
                  value={about}
                  maxLength={80}
                  onChange={(e) => setAbout(e.target.value)}
                />
              )}
            </Field>
            <div className="flex flex-col gap-2">
              <Button size="lg" onClick={() => void shareText(message)}>
                <Send /> Send my address
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void navigator.clipboard.writeText(message).then(() => setCopied(true))
                }
              >
                {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy instead"}
              </Button>
            </div>
            {!pilot.active && pilot.storedAddress && address && (
              <p className="text-xs text-muted-foreground">
                This browser also holds a test wallet ({pilot.storedAddress.slice(0, 8)}…). Send
                only the address you will use.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
