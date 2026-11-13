import { AttestationKind, wasitEscrowAbi } from "@wasit/sdk";
import { ArrowLeft, Check, Copy, FileCheck2, LoaderCircle, Send } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";
import {
  BaseError,
  hashTypedData,
  isAddressEqual,
  recoverTypedDataAddress,
  UserRejectedRequestError,
  type Address,
  type Hex,
} from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { publicClient } from "@/data/client";
import { hashFile } from "@/deals/terms";
import { ActionStatus } from "@/deals/ActionStatus";
import { useDealLive, useNow } from "@/deals/useDealLive";
import { useDealTx } from "@/deals/useDealTx";
import { useDeployment } from "@/deployment";
import { formatRelative, formatTime } from "@/lib/format";
import { explorerAddress } from "@/lib/links";
import { PILOT_CONNECTOR_ID } from "@/pilot/pilotWallet";
import { fromParam, shareText, toParam } from "@/pilot/share";
import {
  attestationTypedData,
  decodeAttestation,
  encodeAttestation,
  expectedAttestation,
  pickIssuedAt,
  type ExpectedAttestation,
  type SignedAttestation,
} from "./attestation";

const CLAIM: Record<number, string> = {
  [AttestationKind.ReadyInspected]: "the goods are ready and I have inspected them",
  [AttestationKind.Shipped]: "the goods have been handed over for shipment",
};

const TITLE: Record<number, string> = {
  [AttestationKind.ReadyInspected]: "Sign: goods ready and inspected",
  [AttestationKind.Shipped]: "Sign: goods shipped",
};

function Centered({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-lg space-y-4 py-16 text-center">{children}</div>;
}

/** Sends a signed statement from the connected wallet; anyone may submit it. */
function useSubmit(dealId: bigint) {
  const d = useDeployment();
  const tx = useDealTx();
  const submit = (a: SignedAttestation) =>
    tx.run([
      {
        label: "Submit the signed statement",
        request: {
          address: d.escrow,
          abi: wasitEscrowAbi,
          functionName: "submitAttestation",
          args: [dealId, a.kind, a.evidenceHash, a.issuedAt, a.signature],
        },
      },
    ]);
  return { tx, submit };
}

function SignFlow({
  dealId,
  exp,
  nonce,
  now,
  account,
}: {
  dealId: bigint;
  exp: ExpectedAttestation;
  nonce: number;
  now: bigint;
  account: Address;
}) {
  const d = useDeployment();
  const { search } = useLocation();
  const { connector } = useAccount();
  const testWallet = connector?.id === PILOT_CONNECTOR_ID;
  const { data: wallet } = useWalletClient();
  const { tx, submit } = useSubmit(dealId);
  const [file, setFile] = useState<{ name: string; hash: Hex }>();
  const [hashing, setHashing] = useState(false);
  const [signed, setSigned] = useState<SignedAttestation>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  const pick = async (f: File | undefined) => {
    setSigned(undefined);
    setError(undefined);
    if (!f) return setFile(undefined);
    setHashing(true);
    try {
      setFile({ name: f.name, hash: await hashFile(f) });
    } finally {
      setHashing(false);
    }
  };

  const sign = async () => {
    if (!file || !wallet) return;
    setError(undefined);
    const message = {
      dealId,
      kind: exp.kind,
      evidenceHash: file.hash,
      issuedAt: pickIssuedAt(now, exp.previous),
      nonce: BigInt(nonce),
    };
    const typed = attestationTypedData(d.chainId, d.escrow, message);
    try {
      // The contract's own digest must equal what the wallet signs, or the signature is useless
      const digest = await publicClient.readContract({
        address: d.escrow,
        abi: wasitEscrowAbi,
        functionName: "attestationDigest",
        args: [dealId, message.kind, message.evidenceHash, message.issuedAt, message.nonce],
      });
      if (digest !== hashTypedData(typed))
        return setError("The statement does not match the escrow's format. Nothing was signed.");
      const signature = await wallet.signTypedData({ account, ...typed });
      setSigned({ escrow: d.escrow, ...message, signature });
    } catch (err) {
      setError(
        err instanceof BaseError && err.walk((e) => e instanceof UserRejectedRequestError)
          ? "You declined the signature. Nothing was signed."
          : "Your wallet could not sign the statement. Try again, or another wallet.",
      );
    }
  };

  const copy = async () => {
    if (!signed) return;
    await navigator.clipboard.writeText(encodeAttestation(signed));
    setCopied(true);
  };

  // A test wallet has no gas: its statement goes back as a link that anyone opens to submit it
  const relayLink = () => {
    const params = new URLSearchParams(search);
    params.set("statement", toParam(encodeAttestation(signed!)));
    return `${window.location.origin}/attest/${dealId}?${params.toString()}`;
  };
  const sendBack = () =>
    void shareText(
      `Signed ${exp.role} statement for Wasit test deal #${dealId}. Open to put it on-chain: ${relayLink()}`,
    );

  const pickNote = (text: string) =>
    void pick(
      text.trim() ? new File([text.trim()], "note.txt", { type: "text/plain" }) : undefined,
    );

  return (
    <Card className="gap-6">
      <CardHeader>
        <CardTitle>1 · Fingerprint your evidence</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <Field
          id="evidence"
          label="Evidence file"
          hint="An inspection report, photos or a bill of lading. For several files, zip them first. The file is hashed on this device and never uploaded."
        >
          {(aria) => (
            <input
              {...aria}
              type="file"
              onChange={(e) => void pick(e.target.files?.[0])}
              className="block w-full text-sm file:me-4 file:rounded-md file:border-0 file:bg-muted file:px-4 file:py-2 file:text-sm file:font-semibold"
            />
          )}
        </Field>
        <Field
          id="evidence-note"
          label="No file? Write what you checked instead"
          hint="The note is fingerprinted the same way and is not uploaded."
        >
          {(aria) => (
            <textarea
              {...aria}
              rows={2}
              onChange={(e) => pickNote(e.target.value)}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
            />
          )}
        </Field>
        {hashing && <p className="text-sm text-muted-foreground">Hashing…</p>}

        {file && (
          <>
            <div className="space-y-3 border-t pt-6">
              <h3 className="font-semibold">2 · Read and sign the statement</h3>
              <blockquote className="rounded-lg border-s-4 border-gold bg-muted/60 p-4 text-sm leading-relaxed">
                As the {exp.role} named in deal #{dealId.toString()}, I state that {CLAIM[exp.kind]}
                . Evidence file <strong className="break-all">{file.name}</strong>, fingerprint{" "}
                <span className="font-mono text-xs break-all">{file.hash}</span>.
              </blockquote>
              <p className="text-xs text-muted-foreground">
                The fingerprint proves the file was not changed after signing. It does not prove the
                goods exist or shipped: the buyer can still dispute within the challenge window.
              </p>
              {!signed && (
                <Button className="w-full" size="lg" onClick={() => void sign()}>
                  <FileCheck2 /> Sign statement
                </Button>
              )}
              {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
            </div>

            {signed && (
              <div className="space-y-3 border-t pt-6">
                <h3 className="font-semibold">3 · Put it on-chain</h3>
                {testWallet ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Your test wallet holds no tokens, so send the signed statement back to the
                      person who invited you. They put it on the test network; the signature is what
                      counts, not who sends it.
                    </p>
                    <Button size="lg" className="w-full" onClick={sendBack}>
                      <Send /> Send signed statement
                    </Button>
                    <Link
                      to={`/statement/${dealId}/${exp.role}${search}`}
                      className="block text-center text-sm text-gold hover:underline"
                    >
                      Optional: sign a short statement that this wallet is yours
                    </Link>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Submit it now from this wallet, or copy it for the buyer, supplier or anyone
                    else to submit. The signature is what counts, not who sends it.
                  </p>
                )}
                <div className="flex flex-col gap-2 sm:flex-row">
                  {!testWallet && (
                    <Button
                      className="flex-1"
                      disabled={tx.running}
                      onClick={() => void submit(signed)}
                    >
                      Submit now
                    </Button>
                  )}
                  <Button variant="outline" className="flex-1" onClick={() => void copy()}>
                    {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy signed statement"}
                  </Button>
                </div>
                <ActionStatus tx={tx} />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** For a relayer: paste a statement someone signed and submit it. */
function SubmitPasted({
  dealId,
  exp,
  nonce,
}: {
  dealId: bigint;
  exp: ExpectedAttestation;
  nonce: number;
}) {
  const d = useDeployment();
  const { tx, submit } = useSubmit(dealId);
  const { search } = useLocation();
  // Opened from a "Send signed statement" link: the statement arrives filled in
  const [text, setText] = useState(() => {
    const p = new URLSearchParams(search).get("statement");
    return (p && fromParam(p)) ?? "";
  });
  const parsed = text.trim() ? decodeAttestation(text) : undefined;
  const problem = !text.trim()
    ? undefined
    : !parsed
      ? "This is not a signed statement."
      : !isAddressEqual(parsed.escrow, d.escrow) || parsed.dealId !== dealId
        ? "This statement is for another deal or deployment."
        : parsed.kind !== exp.kind
          ? "This statement is for a different step of the deal."
          : undefined;

  // EOA signatures recover here; a smart-wallet signer is checked by the contract on submit
  const { data: signer } = useQuery({
    queryKey: ["recover-attestation", text, nonce],
    enabled: !!parsed && !problem,
    retry: false,
    queryFn: () =>
      recoverTypedDataAddress({
        ...attestationTypedData(d.chainId, d.escrow, { ...parsed!, nonce: BigInt(nonce) }),
        signature: parsed!.signature,
      }),
  });

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Submit a statement someone else signed</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field id="pasted" label="Signed statement" error={problem}>
          {(aria) => (
            <textarea
              {...aria}
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder='{ "escrow": "0x…", "dealId": "…", … }'
              className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
            />
          )}
        </Field>
        {signer && !problem && (
          <p className="text-sm">
            {isAddressEqual(signer, exp.signer)
              ? `Signed by the named ${exp.role}.`
              : `Not signed by the named ${exp.role} for the current step; the escrow will refuse it.`}
          </p>
        )}
        <Button
          className="w-full"
          disabled={!parsed || !!problem || tx.running}
          onClick={() => parsed && void submit(parsed)}
        >
          Submit statement
        </Button>
        <ActionStatus tx={tx} />
      </CardContent>
    </Card>
  );
}

/**
 * `/attest/:id`: the inspector (goods ready) or carrier (shipped) fingerprints the evidence on
 * their device, signs the EIP-712 statement, and submits it or hands it to anyone to submit.
 */
export function AttestPage() {
  const { id: raw } = useParams();
  const { search } = useLocation();
  const id = raw && /^\d+$/.test(raw) ? BigInt(raw) : undefined;
  const { address, connector } = useAccount();
  // An invited signer on the test wallet never relays; the paste box is for whoever does
  const relayView =
    connector?.id !== PILOT_CONNECTOR_ID || new URLSearchParams(search).has("statement");
  const live = useDealLive(id);
  const now = useNow();
  const back = (
    <Link
      to={`/deals/${raw}${search}`}
      className="inline-flex items-center gap-1 text-sm text-gold hover:underline"
    >
      <ArrowLeft className="size-4" /> Deal #{raw}
    </Link>
  );

  if (id === undefined || live.isError || (live.data && !live.data.found))
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">Deal not found</h1>
        <p className="text-muted-foreground">
          Check the link, or reload if Mezo testnet did not answer.
        </p>
      </Centered>
    );
  if (!live.data)
    return (
      <Centered>
        <LoaderCircle aria-hidden className="mx-auto size-6 animate-spin text-gold" />
      </Centered>
    );

  const { deal } = live.data;
  const exp = expectedAttestation(deal);
  if (!exp)
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">Nothing to sign on this deal now</h1>
        <p className="text-muted-foreground">
          Statements are signed while goods are in production (inspector) or after the balance is in
          escrow (carrier).
        </p>
        {back}
      </Centered>
    );

  const isSigner = !!address && isAddressEqual(address, exp.signer);
  const late = now > exp.deadline;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-3">
        {back}
        <h1 className="text-3xl font-semibold tracking-tight">{TITLE[exp.kind]}</h1>
        <p className="text-muted-foreground">
          Signer: the {exp.role},{" "}
          <a
            href={explorerAddress(exp.signer)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-sm hover:underline"
          >
            {exp.signer.slice(0, 8)}…{exp.signer.slice(-6)}
          </a>
          {isSigner && <span className="text-gold"> (you)</span>}. Due{" "}
          {formatRelative(exp.deadline, now)} ({formatTime(exp.deadline)}).
        </p>
        {late && (
          <p role="alert" className="rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm">
            The deadline has passed. The escrow no longer accepts this statement; the deal can now
            be closed as a supplier default from the deal page.
          </p>
        )}
      </header>

      {!late &&
        (isSigner ? (
          <SignFlow
            dealId={id}
            exp={exp}
            nonce={deal.attestationNonce}
            now={now}
            account={address}
          />
        ) : (
          <p className="rounded-lg border bg-card p-4 text-sm">
            {address
              ? `Your wallet is not the ${exp.role} of this deal, so it cannot sign. If the ${exp.role} sent you a signed statement, paste it below.`
              : `Connect the ${exp.role}'s wallet to sign, or paste a statement they signed below.`}
          </p>
        ))}
      {!late && relayView && <SubmitPasted dealId={id} exp={exp} nonce={deal.attestationNonce} />}
    </div>
  );
}
