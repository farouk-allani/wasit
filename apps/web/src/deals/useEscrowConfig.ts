import { useQuery } from "@tanstack/react-query";
import { advanceBondAbi, wasitEscrowAbi } from "@wasit/sdk";
import { publicClient } from "@/data/client";
import { useDeployment } from "@/deployment";

/**
 * Values the create form must match or explain, read from the deployed contracts rather than the
 * deploy config: the fee a new deal must carry, whether creation is paused, whether MUSD is
 * allowed, and the bond's warning and protection ratios.
 */
export function useEscrowConfig() {
  const d = useDeployment();
  return useQuery({
    queryKey: ["escrow-config", d.name],
    queryFn: async () => {
      const escrow = { address: d.escrow, abi: wasitEscrowAbi } as const;
      const bond = { address: d.bond, abi: advanceBondAbi } as const;
      const [feeBps, paused, musdAllowed, topUpRatioBps, protectRatioBps] = await Promise.all([
        publicClient.readContract({ ...escrow, functionName: "defaultFeeBps" }),
        publicClient.readContract({ ...escrow, functionName: "paused" }),
        publicClient.readContract({ ...escrow, functionName: "isTokenAllowed", args: [d.musd] }),
        publicClient.readContract({ ...bond, functionName: "topUpRatioBps" }),
        publicClient.readContract({ ...bond, functionName: "protectRatioBps" }),
      ]);
      return { feeBps, paused, musdAllowed, topUpRatioBps, protectRatioBps };
    },
    refetchInterval: 60_000,
  });
}
