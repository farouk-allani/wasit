import { deployments, type DeploymentName } from "@wasit/sdk";
import { useSearchParams } from "react-router";

const isDeploymentName = (name: string | null | undefined): name is DeploymentName =>
  name != null && Object.hasOwn(deployments, name);

const fallback: DeploymentName = isDeploymentName(import.meta.env.VITE_DEPLOYMENT)
  ? import.meta.env.VITE_DEPLOYMENT
  : "mezo-testnet";

/**
 * The contract set a page works with: `?deployment=<name>` if valid, else VITE_DEPLOYMENT, else
 * the live set. `simulatedPriceFeed` is true for the demo-sim set, and the UI must then say so.
 */
export function useDeployment() {
  const [params] = useSearchParams();
  const raw = params.get("deployment");
  const name = isDeploymentName(raw) ? raw : fallback;
  return { name, ...deployments[name] };
}
