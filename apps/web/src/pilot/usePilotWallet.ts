import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import {
  createPilotProvider,
  ensurePilotKey,
  loadPilotKey,
  pilotAddress,
  PILOT_CHAIN_ID,
  PILOT_CONNECTOR_ID,
} from "./pilotWallet";

/** wagmi connector over the test wallet's provider; created on demand, never in the global config. */
const pilotConnector = (key: `0x${string}`) =>
  injected({
    target: {
      id: PILOT_CONNECTOR_ID,
      name: "Wasit test wallet",
      provider: createPilotProvider(key) as never,
    },
    shimDisconnect: false,
  });

/**
 * The test wallet from the join and invite pages. `connect` makes the key if this browser has none
 * and connects it, replacing any other connected wallet.
 */
export function usePilotWallet() {
  const { address, connector, isConnected } = useAccount();
  const { connectAsync, isPending } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const stored = loadPilotKey();
  const active = isConnected && connector?.id === PILOT_CONNECTOR_ID;

  const connect = async () => {
    const key = ensurePilotKey();
    if (!active) {
      if (isConnected) await disconnectAsync();
      await connectAsync({ connector: pilotConnector(key), chainId: PILOT_CHAIN_ID });
    }
    return pilotAddress(key);
  };

  return {
    /** Address of the test wallet this browser holds, connected or not. */
    storedAddress: stored ? pilotAddress(stored) : undefined,
    active,
    connecting: isPending,
    connected: address,
    connect,
  };
}
