import { FlaskConical } from "lucide-react";
import { useDeployment } from "@/deployment";

/** CLAUDE.md honesty rule: whenever the demo-sim set is active, every page says so. */
export function SimulationNotice() {
  const deployment = useDeployment();
  if (!deployment.simulatedPriceFeed) return null;
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
