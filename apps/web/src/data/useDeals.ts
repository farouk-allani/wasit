import { useQuery } from "@tanstack/react-query";
import { deployments, type DeploymentName } from "@wasit/sdk";
import { useDeployment } from "../deployment";
import { publicClient } from "./client";
import { reduceDeals } from "./dealModel";
import { createLogStore } from "./events";

const stores = new Map<DeploymentName, ReturnType<typeof createLogStore>>();

function syncFor(name: DeploymentName) {
  let sync = stores.get(name);
  if (!sync) {
    sync = createLogStore(publicClient, deployments[name]);
    stores.set(name, sync);
  }
  return sync;
}

/** Every deal of the active deployment, rebuilt from events and refreshed every 10 s. */
export function useDeals() {
  const { name } = useDeployment();
  return useQuery({
    queryKey: ["deals", name],
    queryFn: async () => reduceDeals(await syncFor(name)()),
    refetchInterval: 10_000,
    structuralSharing: false, // a Map with bigint keys
  });
}

export function useDeal(id: bigint | undefined) {
  const query = useDeals();
  return { ...query, deal: id === undefined ? undefined : query.data?.get(id) };
}
