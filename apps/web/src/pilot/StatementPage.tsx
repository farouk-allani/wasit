import { Check, Copy, FileSignature, Send, Wallet } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { useAccount, useSignMessage } from "wagmi";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useDeployment } from "@/deployment";
import { shareText } from "./share";
import { statementText, type SignedStatement } from "./statement";
import { usePilotWallet } from "./usePilotWallet";

/**
 * `/statement/:id/:role`: the participant signs a short plain-text statement with the wallet that
 * took part: the wallet is theirs, it was a test network, and how they may be described. Optional.
 */
export function StatementPage() {
  const { id: raw, role } = useParams();
  const d = useDeployment();
  const { address } = useAccount();
  const { signMessageAsync, isPending } = useSignMessage();
  const pilot = usePilotWallet();
  const [city, setCity] = useState("");
  const [about, setAbout] = useState("");
  const [signed, setSigned] = useState<SignedStatement>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  if (!raw || !/^\d+$/.test(raw) || !role)
    return <p className="mx-auto max-w-lg py-16 text-center">This link does not work.</p>;
  if (!address)
    return (
      <div className="mx-auto max-w-lg space-y-4 rounded-lg border bg-card p-4 text-sm">
        {pilot.storedAddress ? (
          <Button
            className="w-full"
            disabled={pilot.connecting}
            onClick={() => void pilot.connect()}
          >
            <Wallet /> Use my test wallet ({pilot.storedAddress.slice(0, 8)}…)
          </Button>
        ) : (
          <p>
            Open this page on the phone that signed, or connect the wallet you used with the button
            at the top.
          </p>
        )}
      </div>
    );

  const message = statementText({
    dealId: BigInt(raw),
    escrow: d.escrow,
    role,
    wallet: address,
    date: new Date().toISOString().slice(0, 10),
    city,
    describeAs: about,
  });
  const json = signed ? JSON.stringify(signed) : "";

  const sign = async () => {
    setError(undefined);
    try {
      setSigned({ message, address, signature: await signMessageAsync({ message }) });
    } catch {
      setError("Nothing was signed.");
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header className="space-y-3">
        <p className="text-xs font-semibold tracking-[0.2em] text-gold uppercase">
          Optional · one more tap
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Sign a short statement</h1>
        <p className="leading-relaxed text-muted-foreground">
          It lets anyone check that the person who took part in deal #{raw} holds this wallet, and
          says how we may describe you. It proves control of the wallet, not who you are.
        </p>
      </header>
      {!signed && (
        <Card>
          <CardContent className="space-y-4">
            <Field id="city" label="City (optional)">
              {(aria) => (
                <Input
                  {...aria}
                  value={city}
                  maxLength={60}
                  onChange={(e) => setCity(e.target.value)}
                />
              )}
            </Field>
            <Field
              id="about"
              label="How may we describe you? (optional)"
              hint="Exactly as you write it, for example “works in freight”."
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
          </CardContent>
        </Card>
      )}
      <pre className="rounded-lg border-s-4 border-gold bg-muted/60 p-4 text-xs leading-relaxed whitespace-pre-wrap">
        {signed?.message ?? message}
      </pre>
      {!signed ? (
        <Button size="lg" className="w-full" disabled={isPending} onClick={() => void sign()}>
          <FileSignature /> Sign statement
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            onClick={() => void shareText(`Wasit statement, deal #${raw}: ${json}`)}
          >
            <Send /> Send it back
          </Button>
          <Button
            variant="outline"
            onClick={() => void navigator.clipboard.writeText(json).then(() => setCopied(true))}
          >
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy instead"}
          </Button>
        </div>
      )}
      {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
    </div>
  );
}
