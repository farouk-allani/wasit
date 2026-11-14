import { useQuery } from "@tanstack/react-query";
import {
  BondStatus,
  DealState,
  musdBorrowingAbi,
  permitTokenAbi,
  troveBondAbi,
  type Bond,
  type Deal,
} from "@wasit/sdk";
import { useState, type ReactNode } from "react";
import { formatUnits, isAddressEqual, parseUnits, zeroAddress, type Address } from "viem";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { publicClient } from "@/data/client";
import { useDeployment } from "@/deployment";
import { percent } from "@/landing/params";
import { formatBtc, formatMusd } from "@/lib/format";
import { ActionStatus } from "./ActionStatus";
import { summarize } from "./terms";
import { useDealTx, type TxStep } from "./useDealTx";

const GAS_COMP = 200n * 10n ** 18n;
const MCR_BPS = 11_000n; // liquidation line
const CCR_BPS = 15_000n; // recovery-mode line
const TROVE_STATUS = ["Not opened", "Open", "Closed", "Liquidated", "Redeemed"];

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

/** Trove state, vault and what closing would cost; refreshed every 10 s. */
function useTrove(dealId: bigint, account: Address | undefined) {
  const d = useDeployment();
  const bo = "borrowerOperations" in d ? d.borrowerOperations : zeroAddress;
  return useQuery({
    queryKey: ["trove", d.name, dealId.toString(), account],
    refetchInterval: 10_000,
    queryFn: async () => {
      const bond = { address: d.bond, abi: troveBondAbi } as const;
      const [health, closed, vault, minNetDebt, troveManager] = await Promise.all([
        publicClient.readContract({ ...bond, functionName: "troveHealth", args: [dealId] }),
        publicClient.readContract({ ...bond, functionName: "closed", args: [dealId] }),
        publicClient.readContract({ ...bond, functionName: "vaultOf", args: [dealId] }),
        publicClient.readContract({
          address: bo,
          abi: musdBorrowingAbi,
          functionName: "minNetDebt",
        }),
        publicClient.readContract({
          address: bo,
          abi: musdBorrowingAbi,
          functionName: "troveManager",
        }),
      ]);
      const [icr, status, price] = health;
      const debt =
        status === 1
          ? await publicClient.readContract({
              address: troveManager,
              abi: musdBorrowingAbi,
              functionName: "getTroveDebt",
              args: [vault],
            })
          : 0n;
      const allowance = account
        ? await publicClient.readContract({
            address: d.musd,
            abi: permitTokenAbi,
            functionName: "allowance",
            args: [account, d.bond],
          })
        : 0n;
      return { icr, status, price, closed, vault, minNetDebt, debt, allowance };
    },
  });
}

/** Collateral ratio bar from 100% to 300%, with the 110% liquidation and 150% lines. */
function HealthBar({ icr }: { icr: bigint }) {
  const bps = (icr * 10_000n) / 10n ** 18n;
  const pos = (v: bigint) => `${Math.min(100, Math.max(0, Number(v - 10_000n) / 200))}%`;
  const tone = bps < MCR_BPS ? "bg-destructive" : bps < CCR_BPS ? "bg-warning" : "bg-success";
  return (
    <div className="space-y-1">
      <div className="relative h-3 rounded-full bg-muted">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${tone}`}
          style={{ width: pos(bps) }}
        />
        <div
          className="absolute inset-y-[-4px] w-px bg-destructive"
          style={{ left: pos(MCR_BPS) }}
        />
        <div
          className="absolute inset-y-[-4px] w-px bg-foreground/40"
          style={{ left: pos(CCR_BPS) }}
        />
      </div>
      <div className="relative h-4 text-[11px] text-muted-foreground">
        <span className="absolute -translate-x-1/2" style={{ left: pos(MCR_BPS) }}>
          110% liquidation
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: pos(CCR_BPS) }}>
          150%
        </span>
      </div>
    </div>
  );
}

/**
 * Bond panel for the trove deployment set (PLAN 8.3e): the buyer's cover in MUSD, the bonder's
 * trove health against the 110% line, the minimum size, and the bonder's post / top-up / close.
 */
export function TroveBondPanel({
  dealId,
  deal,
  bond,
  coverageBps,
  account,
}: {
  dealId: bigint;
  deal: Deal;
  bond: Bond;
  coverageBps: bigint | undefined;
  account: Address | undefined;
}) {
  const d = useDeployment();
  const trove = useTrove(dealId, account);
  const t = trove.data;
  const tx = useDealTx();
  const [btc, setBtc] = useState("");
  const [extra, setExtra] = useState("");
  const extraAmount = parseBtc(extra);
  const isBonder = !!account && isAddressEqual(account, deal.terms.bonder);
  const posted = bond.status !== BondStatus.None;
  const covered = posted ? bond.covered : summarize(deal.terms).netAdvance;
  const ratio = BigInt(deal.terms.bondRatioBps);
  const needed = (covered * ratio + 9_999n) / 10_000n;
  const borrow = t ? (needed > t.minNetDebt ? needed : t.minNetDebt) : undefined;
  // 200% of the composite debt at the feed price: clear of liquidation and of the first redemptions
  const suggested =
    borrow && t && t.price > 0n
      ? ((borrow + borrow / 1_000n + GAS_COMP) * 2n * 10n ** 18n) / t.price
      : undefined;
  const amount = parseBtc(btc);
  const open = t?.status === 1;
  const beforeAdvance = deal.state === DealState.Created || deal.state === DealState.Accepted;
  const free = bond.status === BondStatus.Released || bond.status === BondStatus.Claimed;
  const shortfall = t && open ? t.debt - GAS_COMP + 10n ** 18n - bond.musdHeld : 0n;

  const call = (
    label: string,
    functionName: "post" | "topUp" | "withdraw" | "close",
    value?: bigint,
  ): TxStep => ({
    label,
    request: {
      address: d.bond,
      abi: troveBondAbi,
      functionName,
      args:
        functionName === "post" || functionName === "topUp"
          ? [dealId, zeroAddress, zeroAddress]
          : [dealId],
      ...(value ? { value } : {}),
    },
  });

  if (deal.terms.bonder === zeroAddress)
    return (
      <Card className="gap-3">
        <CardHeader>
          <CardTitle>BTC bond</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">This deal has no bond.</CardContent>
      </Card>
    );

  return (
    <Card className="gap-5">
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>BTC bond · trove mode</CardTitle>
        <span className="text-xs font-semibold text-muted-foreground">
          {t?.closed ? "Closed" : posted ? (free ? "Free to close" : "Active") : "Not posted"}
        </span>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm leading-relaxed">
          The bond poster locks BTC in a trove on Mezo&apos;s MUSD borrowing system. The trove
          borrows MUSD, and that MUSD is held for the buyer from the moment the bond is posted. If
          the supplier defaults, the buyer is paid in MUSD; no BTC is sold.
        </p>

        <dl className="divide-y">
          {bond.status === BondStatus.Active || !posted ? (
            <Row label="Buyer cover (MUSD)">
              {posted
                ? formatMusd(bond.musdHeld)
                : borrow
                  ? `${formatMusd(borrow)} when posted`
                  : "…"}
              {posted && coverageBps !== undefined && ` · ${percent(coverageBps)}`}
            </Row>
          ) : (
            <Row label="Bond">
              {bond.status === BondStatus.Claimed
                ? "Paid the buyer in MUSD"
                : "Released to the bond poster"}
            </Row>
          )}
          <Row label="Covers (net advance)">{formatMusd(covered)}</Row>
          {posted && !t?.closed && <Row label="BTC in the trove">{formatBtc(bond.btcHeld)}</Row>}
          {t && posted && <Row label="Trove">{TROVE_STATUS[t.status] ?? "?"}</Row>}
          {t && open && <Row label="Trove debt">{formatMusd(t.debt)}</Row>}
        </dl>

        {t && open && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">
              Trove health{" "}
              {t.price > 0n ? (
                <span className="font-normal text-muted-foreground">
                  {percent((t.icr * 10_000n) / 10n ** 18n)} at{" "}
                  {formatMusd(t.price, 0).replace(" MUSD", " USD")}
                </span>
              ) : (
                <span className="font-normal text-warning">price unavailable</span>
              )}
            </p>
            {t.price > 0n && <HealthBar icr={t.icr} />}
          </div>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          Trove health is the bond poster&apos;s risk, not the buyer&apos;s. Below 110% anyone can
          liquidate the trove: the poster loses the BTC and the buyer&apos;s cover stays in MUSD.
          Low-ratio troves are also redeemed first: the BTC is exchanged for the debt at face value.
          A trove borrows at least {t ? formatMusd(t.minNetDebt, 0) : "1,800 MUSD"}, so this mode
          suits advances from about 1,500 MUSD; the poster pays a 0.1% fee and 1% a year, settled
          when the trove closes. Closing can wait while Mezo&apos;s system is in recovery mode. MUSD
          counts as 1 USD.
        </p>

        {isBonder && !posted && beforeAdvance && (
          <div className="space-y-3">
            <Field
              id="trove-btc"
              label="BTC to lock in the trove"
              hint={
                suggested
                  ? `About ${formatBtc(suggested, 6)} keeps the trove near 200%. The MUSD system refuses less than 110%.`
                  : "Waiting for a price."
              }
            >
              {(aria) => (
                <Input
                  {...aria}
                  inputMode="decimal"
                  value={btc || (suggested ? formatUnits(suggested, 18).slice(0, 10) : "")}
                  onChange={(e) => setBtc(e.target.value)}
                  className="font-mono"
                />
              )}
            </Field>
            <Button
              className="w-full"
              disabled={tx.running || !(amount ?? suggested)}
              onClick={() =>
                void tx.run([call("Open the trove and post the bond", "post", amount ?? suggested)])
              }
            >
              Post bond
            </Button>
          </div>
        )}
        {open && !t?.closed && account && (
          <div className="space-y-3">
            <Field
              id="trove-topup"
              label="Add BTC to the trove"
              hint="Anyone can add BTC to lower the liquidation risk. It goes back to the bond poster when the trove closes."
            >
              {(aria) => (
                <Input
                  {...aria}
                  inputMode="decimal"
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  className="font-mono"
                />
              )}
            </Field>
            <Button
              variant="outline"
              className="w-full"
              disabled={tx.running || !extraAmount}
              onClick={() =>
                extraAmount && void tx.run([call("Add BTC to the trove", "topUp", extraAmount)])
              }
            >
              Add BTC
            </Button>
          </div>
        )}
        {isBonder && bond.status === BondStatus.Active && beforeAdvance && (
          <Button
            variant="outline"
            className="w-full"
            disabled={tx.running}
            onClick={() => void tx.run([call("Free the bond", "withdraw")])}
          >
            Withdraw bond
          </Button>
        )}
        {isBonder && free && t && !t.closed && (
          <div className="space-y-2">
            <p className="text-sm">
              The bond is free. Close the trove to get the BTC back
              {shortfall > 0n
                ? `: bring about ${formatMusd(shortfall)} (fee and interest${bond.status === BondStatus.Claimed ? ", plus what the buyer was paid" : ""}).`
                : "."}
            </p>
            <Button
              className="w-full"
              disabled={tx.running}
              onClick={() =>
                void tx.run([
                  ...(shortfall > 0n && t.allowance < shortfall
                    ? [
                        {
                          label: "Allow the bond to take the MUSD",
                          request: {
                            address: d.musd,
                            abi: permitTokenAbi,
                            functionName: "approve",
                            args: [d.bond, shortfall],
                          } as TxStep["request"],
                        },
                      ]
                    : []),
                  call("Close the trove", "close"),
                ])
              }
            >
              Close the trove
            </Button>
          </div>
        )}
        <ActionStatus tx={tx} />
      </CardContent>
    </Card>
  );
}
