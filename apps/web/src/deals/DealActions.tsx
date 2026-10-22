import { ConnectButton } from "@rainbow-me/rainbowkit";
import { permitTokenAbi, wasitEscrowAbi, type Deal } from "@wasit/sdk";
import { ArrowRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { BaseError, keccak256, stringToBytes, UserRejectedRequestError, type Address } from "viem";
import { useWalletClient } from "wagmi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { publicClient } from "@/data/client";
import { useDeployment } from "@/deployment";
import { formatMusd } from "@/lib/format";
import { signPermit } from "@/lib/permit";
import { ActionStatus } from "./ActionStatus";
import type { ActionId, DealAction } from "./dealStatus";
import { summarize } from "./terms";
import { useDealTx, type TxStep } from "./useDealTx";

type Funds = { musd: bigint; musdAllowance: bigint } | undefined;

interface Copy {
  title: string;
  body: string;
  button: string;
  /** Irreversible or adversarial: ask for a second click. */
  confirm?: boolean;
}

/** Plain words for every action the panel can send; bond calls live in the bond panel. */
const COPY: Partial<Record<ActionId, Copy>> = {
  accept: {
    title: "Accept the terms",
    body: "You agree to the amounts and deadlines. Nothing is paid yet, and the deal can still be cancelled until the advance is paid.",
    button: "Accept terms",
  },
  acceptArbiter: {
    title: "Accept the arbiter role",
    body: "You agree to rule on a dispute within the arbitration period. The buyer cannot pay the advance until you accept.",
    button: "Accept role",
  },
  cancel: {
    title: "Cancel the deal",
    body: "Possible until the advance is paid. No money has moved; a posted bond goes back to its poster.",
    button: "Cancel deal",
    confirm: true,
  },
  acceptGoods: {
    title: "Accept the goods now",
    body: "Releases the balance to the supplier immediately instead of waiting for the challenge window to end. You can no longer dispute after this.",
    button: "Accept and release",
    confirm: true,
  },
  release: {
    title: "Release the balance",
    body: "The window has ended without a dispute, or the arbiter did not rule in time. Anyone can now release the balance to the supplier.",
    button: "Release to supplier",
  },
  claimSupplierDefault: {
    title: "Close as supplier default",
    body: "The supplier missed a deadline. Anyone can close the deal: the escrow refunds what it holds to the buyer and the bond pays back the advance, as far as it can.",
    button: "Claim default",
    confirm: true,
  },
  claimBuyerDefault: {
    title: "Close as buyer default",
    body: "The buyer did not fund the balance in time. Anyone can close the deal: the supplier keeps the advance and the bond goes back to its poster.",
    button: "Claim default",
    confirm: true,
  },
  retryBondSettlement: {
    title: "Retry the bond settlement",
    body: "The bond call failed when the deal settled (for example, no fresh BTC price). Anyone can retry it once the cause is gone.",
    button: "Retry",
  },
};

function ConfirmButton({
  copy,
  onRun,
  disabled,
}: {
  copy: Copy;
  onRun: () => void;
  disabled: boolean;
}) {
  const [armed, setArmed] = useState(false);
  if (!copy.confirm || armed)
    return (
      <div className="flex gap-2">
        <Button className="flex-1" disabled={disabled} onClick={onRun}>
          {armed ? `Yes, ${copy.button.toLowerCase()}` : copy.button}
        </Button>
        {armed && (
          <Button variant="ghost" disabled={disabled} onClick={() => setArmed(false)}>
            Back
          </Button>
        )}
      </div>
    );
  return (
    <Button variant="outline" className="w-full" disabled={disabled} onClick={() => setArmed(true)}>
      {copy.button}
    </Button>
  );
}

function Item({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t pt-5 first:border-t-0 first:pt-0">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
      {children}
    </section>
  );
}

function SimpleAction({ id, dealId, blocked }: { id: ActionId; dealId: bigint; blocked?: string }) {
  const d = useDeployment();
  const tx = useDealTx();
  const copy = COPY[id]!;
  const run = () =>
    void tx.run([
      {
        label: copy.title,
        request: {
          address: d.escrow,
          abi: wasitEscrowAbi,
          functionName: id,
          args: [dealId],
        },
      },
    ]);
  return (
    <Item title={copy.title} body={copy.body}>
      {blocked && <p className="text-sm font-semibold text-warning">{blocked}</p>}
      <ConfirmButton copy={copy} onRun={run} disabled={tx.running || !!blocked} />
      <ActionStatus tx={tx} />
    </Item>
  );
}

const rejected = (err: unknown) =>
  err instanceof BaseError && !!err.walk((e) => e instanceof UserRejectedRequestError);

/**
 * Pays MUSD into the deal. With enough allowance it calls directly; otherwise it asks for an
 * EIP-2612 permit (one signature, one transaction) and falls back to approve + pay when the wallet
 * cannot sign typed data.
 */
function FundAction({
  kind,
  dealId,
  deal,
  funds,
  account,
  blocked,
}: {
  kind: "advance" | "balance";
  dealId: bigint;
  deal: Deal;
  funds: Funds;
  account: Address;
  blocked?: string;
}) {
  const d = useDeployment();
  const { data: wallet } = useWalletClient();
  const tx = useDealTx();
  const [note, setNote] = useState<string>();
  const s = summarize(deal.terms);
  const amount = kind === "advance" ? deal.terms.advanceAmount : deal.terms.balanceAmount;
  const fn = kind === "advance" ? "fundAdvance" : "fundBalance";
  const short = funds !== undefined && funds.musd < amount;
  const call = (request: Omit<TxStep["request"], "address" | "abi">): TxStep => ({
    label: `Pay the ${kind}`,
    request: { address: d.escrow, abi: wasitEscrowAbi, ...request },
  });

  const pay = async () => {
    setNote(undefined);
    if (funds && funds.musdAllowance >= amount)
      return void tx.run([call({ functionName: fn, args: [dealId] })]);
    if (wallet) {
      try {
        setNote("Sign the permit in your wallet. It lets the escrow take exactly this amount.");
        const p = await signPermit({
          client: publicClient,
          wallet,
          token: d.musd,
          owner: account,
          spender: d.escrow,
          value: amount,
        });
        setNote(undefined);
        return void tx.run([
          call({ functionName: `${fn}WithPermit`, args: [dealId, p.deadline, p.v, p.r, p.s] }),
        ]);
      } catch (err) {
        if (rejected(err)) return setNote("You declined the permit. Nothing was sent.");
        setNote(
          "Your wallet could not sign a permit, so this takes two transactions: approve, then pay.",
        );
      }
    }
    await tx.run([
      {
        label: "Allow the escrow to take the MUSD",
        request: {
          address: d.musd,
          abi: permitTokenAbi,
          functionName: "approve",
          args: [d.escrow, amount],
        },
      },
      call({ functionName: fn, args: [dealId] }),
    ]);
  };

  return (
    <Item
      title={`Pay the ${kind}: ${formatMusd(amount)}`}
      body={
        kind === "advance"
          ? `${formatMusd(s.netAdvance)} goes straight to the supplier for production and ${formatMusd(s.advanceFee)} (fee) stays in escrow. The advance is protected only by the BTC bond, not by the escrow.`
          : `The balance stays in escrow until the goods ship and the challenge window ends, or the arbiter rules.`
      }
    >
      {blocked && <p className="text-sm font-semibold text-warning">{blocked}</p>}
      {short && funds && (
        <p className="text-sm font-semibold text-warning">
          Your wallet holds {formatMusd(funds.musd)}; {formatMusd(amount)} is needed.
        </p>
      )}
      <Button
        className="w-full"
        size="lg"
        disabled={tx.running || !!blocked || short}
        onClick={() => void pay()}
      >
        Pay {formatMusd(amount)}
      </Button>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
      <ActionStatus tx={tx} />
    </Item>
  );
}

/** The supplier hands the net advance back; the escrow refunds the rest and the deal closes. */
function RefundAction({ dealId, deal, funds }: { dealId: bigint; deal: Deal; funds: Funds }) {
  const d = useDeployment();
  const tx = useDealTx();
  const net = summarize(deal.terms).netAdvance;
  const copy: Copy = {
    title: "Refund the buyer and cancel",
    body: `If you cannot deliver, return the ${formatMusd(net)} you received. The escrow refunds what it holds, the deal closes and the bond goes back to its poster.`,
    button: "Refund and cancel",
    confirm: true,
  };
  const short = funds !== undefined && funds.musd < net;
  const run = () =>
    void tx.run([
      ...(funds && funds.musdAllowance >= net
        ? []
        : [
            {
              label: "Allow the escrow to take the refund",
              request: {
                address: d.musd,
                abi: permitTokenAbi,
                functionName: "approve",
                args: [d.escrow, net],
              } as TxStep["request"],
            },
          ]),
      {
        label: "Refund and cancel",
        request: {
          address: d.escrow,
          abi: wasitEscrowAbi,
          functionName: "refundAndCancel",
          args: [dealId],
        },
      },
    ]);
  return (
    <Item title={copy.title} body={copy.body}>
      {short && (
        <p className="text-sm font-semibold text-warning">
          Your wallet holds less than {formatMusd(net)}.
        </p>
      )}
      <ConfirmButton copy={copy} onRun={run} disabled={tx.running || short} />
      <ActionStatus tx={tx} />
    </Item>
  );
}

function DisputeAction({ dealId }: { dealId: bigint }) {
  const d = useDeployment();
  const tx = useDealTx();
  const [reason, setReason] = useState("");
  const copy: Copy = {
    title: "Open a dispute",
    body: "Stops the release and asks the arbiter to rule. Only a fingerprint (hash) of your reason goes on-chain: send the text itself and your evidence to the arbiter.",
    button: "Open dispute",
    confirm: true,
  };
  const run = () =>
    void tx.run([
      {
        label: copy.title,
        request: {
          address: d.escrow,
          abi: wasitEscrowAbi,
          functionName: "dispute",
          args: [dealId, keccak256(stringToBytes(reason.trim()))],
        },
      },
    ]);
  return (
    <Item title={copy.title} body={copy.body}>
      <Field
        id="dispute-reason"
        label="Reason"
        hint="For example: goods short by 200 units, inspection photos attached."
      >
        {(aria) => (
          <textarea
            {...aria}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
          />
        )}
      </Field>
      <ConfirmButton copy={copy} onRun={run} disabled={tx.running || reason.trim().length < 10} />
      <ActionStatus tx={tx} />
    </Item>
  );
}

function LinkAction({
  title,
  body,
  to,
  label,
}: {
  title: string;
  body: string;
  to: string;
  label: string;
}) {
  const { search } = useLocation();
  return (
    <Item title={title} body={body}>
      <Button asChild className="w-full">
        <Link to={`${to}${search}`}>
          {label} <ArrowRight />
        </Link>
      </Button>
    </Item>
  );
}

const BOND_ACTIONS = new Set<ActionId>(["postBond", "topUp", "withdrawBond", "protect"]);

/** Everything the connected wallet can do on this deal now, each with what it does to the money. */
export function DealActions({
  dealId,
  deal,
  actions,
  account,
  funds,
}: {
  dealId: bigint;
  deal: Deal;
  actions: DealAction[];
  account: Address | undefined;
  funds: Funds;
}) {
  const mine = actions.filter((a) => a.mine && !BOND_ACTIONS.has(a.id));
  return (
    <Card className="gap-5 border-gold/40">
      <CardHeader>
        <CardTitle>Your next actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {!account ? (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>Connect the wallet named in the deal to act on it.</p>
            <ConnectButton />
          </div>
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing for your wallet to do on this deal right now.
          </p>
        ) : (
          mine.map((a) => {
            switch (a.id) {
              case "fundAdvance":
              case "fundBalance":
                return (
                  <FundAction
                    key={a.id}
                    kind={a.id === "fundAdvance" ? "advance" : "balance"}
                    dealId={dealId}
                    deal={deal}
                    funds={funds}
                    account={account}
                    blocked={a.blocked}
                  />
                );
              case "refundAndCancel":
                return <RefundAction key={a.id} dealId={dealId} deal={deal} funds={funds} />;
              case "dispute":
                return <DisputeAction key={a.id} dealId={dealId} />;
              case "attestReady":
              case "attestShipped":
                return (
                  <LinkAction
                    key={a.id}
                    to={`/attest/${dealId}`}
                    title={
                      a.id === "attestReady"
                        ? "Sign: goods ready and inspected"
                        : "Sign: goods shipped"
                    }
                    body="Hash your evidence file on this device and sign the statement. The file is not uploaded."
                    label="Open signing page"
                  />
                );
              case "resolve":
                return (
                  <LinkAction
                    key={a.id}
                    to={`/arbiter/${dealId}`}
                    title="Rule on the dispute"
                    body="Split the escrowed balance and, with a bond, decide how much of the advance the bond pays back."
                    label="Open arbiter console"
                  />
                );
              default:
                return <SimpleAction key={a.id} id={a.id} dealId={dealId} blocked={a.blocked} />;
            }
          })
        )}
      </CardContent>
    </Card>
  );
}
