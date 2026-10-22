import { useQuery } from "@tanstack/react-query";
import {
  advanceBondAbi,
  BondStatus,
  permitTokenAbi,
  priceOracleAbi,
  wasitEscrowAbi,
} from "@wasit/sdk";
import { useEffect, useState } from "react";
import { zeroAddress, type Address } from "viem";
import { publicClient } from "@/data/client";
import { useDeployment } from "@/deployment";

/**
 * Current on-chain state of one deal and its bond, read from the contracts (the event history in
 * `useDeal` gives the timeline and ledger). Coverage and price need a fresh oracle answer: when the
 * oracle refuses (stale, out of bounds) they come back undefined and `priceError` says why, because
 * the bond cannot be valued, posted or protected without a price (ARCHITECTURE §7).
 */
export function useDealLive(id: bigint | undefined) {
  const d = useDeployment();
  return useQuery({
    queryKey: ["deal-live", d.name, id?.toString()],
    enabled: id !== undefined,
    refetchInterval: 10_000,
    queryFn: async () => {
      const dealId = id!;
      const escrow = { address: d.escrow, abi: wasitEscrowAbi } as const;
      const bondC = { address: d.bond, abi: advanceBondAbi } as const;
      const [deal, bond, configOracle] = await Promise.all([
        publicClient.readContract({ ...escrow, functionName: "getDeal", args: [dealId] }),
        publicClient.readContract({ ...bondC, functionName: "bondOf", args: [dealId] }),
        publicClient.readContract({ ...bondC, functionName: "oracle" }),
      ]);
      if (deal.terms.buyer === zeroAddress) return { found: false as const };

      const live = bond.status === BondStatus.Active || bond.status === BondStatus.Protected;
      // A live bond is valued with the oracle it snapshotted; a new one would use the config's
      const oracle = live ? bond.oracle : configOracle;
      let coverageBps: bigint | undefined;
      let btcPrice: bigint | undefined;
      let priceError: string | undefined;
      try {
        const [price] = await publicClient.readContract({
          address: oracle,
          abi: priceOracleAbi,
          functionName: "btcUsd",
        });
        btcPrice = price;
        if (live)
          coverageBps = await publicClient.readContract({
            ...bondC,
            functionName: "coverageBps",
            args: [dealId],
          });
      } catch {
        priceError =
          "The BTC price feed did not return a fresh price, so the bond cannot be valued right now.";
      }
      return { found: true as const, deal, bond, coverageBps, btcPrice, priceError };
    },
  });
}

/**
 * What the connected wallet holds and has approved: MUSD for funding (spender: escrow) and BTC
 * for the bond (spender: bond).
 */
export function useWalletFunds(account: Address | undefined) {
  const d = useDeployment();
  return useQuery({
    queryKey: ["wallet-funds", d.name, account],
    enabled: account !== undefined,
    refetchInterval: 15_000,
    queryFn: async () => {
      const owner = account!;
      const balance = (token: Address) =>
        publicClient.readContract({
          address: token,
          abi: permitTokenAbi,
          functionName: "balanceOf",
          args: [owner],
        });
      const allowance = (token: Address, spender: Address) =>
        publicClient.readContract({
          address: token,
          abi: permitTokenAbi,
          functionName: "allowance",
          args: [owner, spender],
        });
      const [musd, musdAllowance, btc, btcAllowance] = await Promise.all([
        balance(d.musd),
        allowance(d.musd, d.escrow),
        balance(d.btc),
        allowance(d.btc, d.bond),
      ]);
      return { musd, musdAllowance, btc, btcAllowance };
    },
  });
}

/** Unix seconds, refreshed every few seconds so deadline checks follow the clock. */
export function useNow(intervalMs = 5_000): bigint {
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const t = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
