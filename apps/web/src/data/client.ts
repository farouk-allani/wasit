import { createPublicClient, http } from "viem";
import { mezoTestnet } from "viem/chains";

/** Read-only client for event history and views, independent of the connected wallet. */
export const publicClient = createPublicClient({
  chain: mezoTestnet,
  transport: http(undefined, { retryCount: 5, retryDelay: 1_000 }),
});
