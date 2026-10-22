import { useQuery } from "@tanstack/react-query";
import { advanceBondAbi, priceOracleAbi } from "@wasit/sdk";
import { FlaskConical } from "lucide-react";
import { publicClient } from "@/data/client";
import { useDeployment } from "@/deployment";

/**
 * True when the active deployment is labeled demo-sim, or when the oracle its bond uses for new
 * bonds says it is simulated. Asking the oracle too means a wrong config flag cannot hide it.
 */
export function useSimulatedFeed() {
  const d = useDeployment();
  const onchain = useQuery({
    queryKey: ["oracle-simulated", d.name],
    staleTime: Infinity,
    queryFn: async () => {
      const oracle = await publicClient.readContract({
        address: d.bond,
        abi: advanceBondAbi,
        functionName: "oracle",
      });
      return publicClient.readContract({
        address: oracle,
        abi: priceOracleAbi,
        functionName: "isSimulated",
      });
    },
  });
  return d.simulatedPriceFeed || onchain.data === true;
}

function Notice() {
  return (
    <p
      role="status"
      className="relative z-50 flex items-center justify-center gap-2 bg-warning px-4 py-2 text-center text-sm font-semibold text-navy-950"
    >
      <FlaskConical aria-hidden className="size-4 shrink-0" />
      Simulated price feed: BTC prices on this deployment are set by hand for the demo.
    </p>
  );
}

/**
 * CLAUDE.md honesty rule: whenever a simulated price feed is in use, every page says so. The
 * landing renders without the query provider, so it goes by the deployment label alone.
 */
export function SimulationNotice() {
  return useDeployment().simulatedPriceFeed ? <Notice /> : null;
}

/** App pages: the deployment label or the oracle itself (needs the query provider). */
export function LiveSimulationNotice() {
  return useSimulatedFeed() ? <Notice /> : null;
}
