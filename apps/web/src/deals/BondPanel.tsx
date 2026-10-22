import { advanceBondAbi, BondStatus, permitTokenAbi, type Bond, type Deal } from "@wasit/sdk";
import { FlaskConical } from "lucide-react";
import { useState, type ReactNode } from "react";
import { formatUnits, parseUnits, zeroAddress, type Address } from "viem";
import { BondGauge } from "@/components/BondGauge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useDeployment } from "@/deployment";
import { percent } from "@/landing/params";
import { formatBtc, formatMusd } from "@/lib/format";
import { ActionStatus } from "./ActionStatus";
import { btcForCoverage, withMargin } from "./bondMath";
import type { DealAction } from "./dealStatus";
import { summarize } from "./terms";
import { useDealTx, type TxStep } from "./useDealTx";
import { useEscrowConfig } from "./useEscrowConfig";

const STATUS_LABEL: Record<number, string> = {
  [BondStatus.None]: "Not posted",
  [BondStatus.Active]: "Active",
  [BondStatus.Protected]: "Protected (converted to MUSD)",
  [BondStatus.Claimed]: "Claimed for the buyer",
  [BondStatus.Released]: "Returned to the bond poster",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-semibold">{children}</dd>
    </div>
  );
}

const parseBtc = (v: string) => {
  try {
    const n = parseUnits(v.trim(), 18);
    return n > 0n ? n : undefined;
  } catch {
    return undefined;
  }
};

/** BTC amount, an approval if the bond may not pull it yet, then the bond call. */
function BtcForm({
  id,
  label,
  hint,
  initial,
  submit,
  steps,
  disabled,
}: {
  id: string;
  label: string;
  hint: ReactNode;
  initial: bigint | undefined;
  submit: string;
  steps: (amount: bigint) => TxStep[];
  disabled: boolean;
}) {
  const [value, setValue] = useState(initial ? formatUnits(initial, 18) : "");
  const tx = useDealTx();
  const amount = parseBtc(value);
  const error = value && !amount ? "Enter a BTC amount above zero, e.g. 0.0006" : undefined;
  return (
    <div className="space-y-3">
      <Field id={id} label={label} hint={hint} error={error}>
        {(aria) => (
          <Input
            {...aria}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="font-mono"
          />
        )}
      </Field>
      <Button
        className="w-full"
        disabled={disabled || !amount || tx.running}
        onClick={() => amount && void tx.run(steps(amount))}
      >
        {submit}
      </Button>
      <ActionStatus tx={tx} />
    </div>
  );
}

function CallButton({
  label,
  steps,
  variant = "default",
}: {
  label: string;
  steps: TxStep[];
  variant?: "default" | "outline";
}) {
  const tx = useDealTx();
  return (
    <div className="space-y-3">
      <Button
        className="w-full"
        variant={variant}
        disabled={tx.running}
        onClick={() => void tx.run(steps)}
      >
        {label}
      </Button>
      <ActionStatus tx={tx} />
    </div>
  );
}

/**
 * The deal's BTC bond: coverage against the warning and protection lines, what it holds, what
 * happens below each line, and the bond calls the connected wallet can make.
 */
export function BondPanel({
  dealId,
  deal,
  bond,
  coverageBps,
  btcPrice,
  priceError,
  actions,
  account,
  btcAllowance,
}: {
  dealId: bigint;
  deal: Deal;
  bond: Bond;
  coverageBps: bigint | undefined;
  btcPrice: bigint | undefined;
  priceError: string | undefined;
  actions: DealAction[];
  account: Address | undefined;
  btcAllowance: bigint | undefined;
}) {
  const d = useDeployment();
  const config = useEscrowConfig();
  const has = (id: DealAction["id"]) => actions.some((a) => a.id === id && a.mine);
  const posted = bond.status !== BondStatus.None;
  const topUpBps = posted ? bond.topUpRatioBps : config.data?.topUpRatioBps;
  const protectBps = posted ? bond.protectRatioBps : config.data?.protectRatioBps;
  const covered = posted ? bond.covered : summarize(deal.terms).netAdvance;
  const ratio = BigInt(deal.terms.bondRatioBps);
  const required = btcPrice ? btcForCoverage(covered, ratio, btcPrice) : undefined;

  if (deal.terms.bonder === zeroAddress)
    return (
      <Card className="gap-3">
        <CardHeader>
          <CardTitle>BTC bond</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This deal has no bond. If the supplier defaults after the advance is paid, the buyer gets
          back what is in escrow, but not the advance itself.
        </CardContent>
      </Card>
    );

  const approveThen = (spend: bigint, step: TxStep): TxStep[] => [
    ...((btcAllowance ?? 0n) < spend
      ? [
          {
            label: "Allow the bond contract to take the BTC",
            request: {
              address: d.btc,
              abi: permitTokenAbi,
              functionName: "approve",
              args: [d.bond, spend],
            } as TxStep["request"],
          },
        ]
      : []),
    step,
  ];
  const bondCall = (functionName: "post" | "topUp", amount: bigint): TxStep => ({
    label: functionName === "post" ? "Post the bond" : "Top up the bond",
    request: {
      address: d.bond,
      abi: advanceBondAbi,
      functionName,
      args: [dealId, amount],
    },
  });

  return (
    <Card className="gap-5">
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>BTC bond</CardTitle>
        <span className="text-xs font-semibold text-muted-foreground">
          {STATUS_LABEL[bond.status]}
        </span>
      </CardHeader>
      <CardContent className="space-y-5">
        {d.simulatedPriceFeed && (
          <p className="flex items-center gap-2 rounded-md bg-warning/15 px-3 py-2 text-xs font-semibold text-warning">
            <FlaskConical aria-hidden className="size-4 shrink-0" /> Simulated price feed
          </p>
        )}
        {posted && coverageBps !== undefined && topUpBps && protectBps && (
          <BondGauge
            coverageBps={Number(coverageBps)}
            topUpBps={topUpBps}
            protectBps={protectBps}
          />
        )}
        {priceError && <p className="rounded-md bg-warning/15 px-3 py-2 text-sm">{priceError}</p>}

        <dl className="divide-y">
          <Row label="Covers (net advance)">{formatMusd(covered)}</Row>
          <Row label="Required at posting">{percent(ratio)}</Row>
          {posted && <Row label="BTC held">{formatBtc(bond.btcHeld)}</Row>}
          {posted && bond.musdHeld > 0n && <Row label="MUSD held">{formatMusd(bond.musdHeld)}</Row>}
          {btcPrice !== undefined && (
            <Row label="BTC price">{formatMusd(btcPrice, 0).replace(" MUSD", " USD")}</Row>
          )}
          {!posted && required !== undefined && (
            <Row label="BTC needed now">≥ {formatBtc(required, 8)}</Row>
          )}
        </dl>

        {topUpBps && protectBps && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Below {percent(topUpBps)} the bond poster should top up. Below {percent(protectBps)}{" "}
            anyone can convert the BTC to MUSD to lock in its value. In a fast crash the bond can
            still fall short: the buyer then receives what the bond holds, not more.
          </p>
        )}

        {has("postBond") && (
          <BtcForm
            id="post-btc"
            label="BTC to post"
            hint={`At least ${percent(ratio)} of the net advance at today's price. 1% extra is suggested.`}
            initial={required && withMargin(required)}
            submit="Post bond"
            disabled={!account || !required}
            steps={(amount) => approveThen(amount, bondCall("post", amount))}
          />
        )}
        {has("topUp") && (
          <BtcForm
            id="topup-btc"
            label="Top up with BTC"
            hint="Anyone can add BTC. It goes back to the bond poster when the deal settles."
            initial={undefined}
            submit="Top up"
            disabled={!account}
            steps={(amount) => approveThen(amount, bondCall("topUp", amount))}
          />
        )}
        {has("protect") && (
          <CallButton
            label="Protect: convert BTC to MUSD"
            steps={[
              {
                label: "Convert the bond's BTC to MUSD",
                request: {
                  address: d.bond,
                  abi: advanceBondAbi,
                  functionName: "protect",
                  args: [dealId],
                },
              },
            ]}
          />
        )}
        {has("withdrawBond") && (
          <CallButton
            variant="outline"
            label="Withdraw bond"
            steps={[
              {
                label: "Withdraw the bond",
                request: {
                  address: d.bond,
                  abi: advanceBondAbi,
                  functionName: "withdraw",
                  args: [dealId],
                },
              },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}
