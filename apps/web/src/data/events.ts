import { advanceBondAbi, wasitEscrowAbi } from "@wasit/sdk";
import type { Address, PublicClient } from "viem";
import type { DealLog } from "./dealModel";

/** eth_getLogs accepts at most a 10,000-block range on rpc.test.mezo.org (VERIFIED-FACTS). */
export const MAX_LOG_RANGE = 10_000n;
/**
 * Blocks re-read on every sync. Mezo has instant finality, but the public RPC is load-balanced
 * and a node behind the head can answer a range without its newest logs (VERIFIED-FACTS).
 */
export const RESCAN_BLOCKS = 200n;

export interface DealContracts {
  escrow: Address;
  bond: Address;
  deployBlock: bigint;
}
export type LogReader = Pick<PublicClient, "getContractEvents" | "getBlockNumber" | "getBlock">;

/** Escrow and bond logs in [fromBlock, toBlock], read in ranges the RPC accepts. */
export async function fetchDealLogs(
  client: LogReader,
  c: DealContracts,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<DealLog[]> {
  const logs: DealLog[] = [];
  for (let start = fromBlock; start <= toBlock; start += MAX_LOG_RANGE) {
    const last = start + MAX_LOG_RANGE - 1n;
    const range = {
      fromBlock: start,
      toBlock: last < toBlock ? last : toBlock,
      strict: true,
    } as const;
    const [escrow, bond] = await Promise.all([
      client.getContractEvents({ ...range, address: c.escrow, abi: wasitEscrowAbi }),
      client.getContractEvents({ ...range, address: c.bond, abi: advanceBondAbi }),
    ]);
    logs.push(...escrow, ...bond);
  }
  return logs;
}

/**
 * Holds every log since `deployBlock`; each sync reads the new blocks plus a rescan window.
 * Mezo returns `blockTimestamp: 0x0` in logs (VERIFIED-FACTS), so block times are read once per
 * block and filled in.
 */
export function createLogStore(client: LogReader, c: DealContracts) {
  const logs = new Map<string, DealLog>();
  const blockTimes = new Map<bigint, Promise<bigint>>();
  const timeOf = (blockNumber: bigint) => {
    let time = blockTimes.get(blockNumber);
    if (!time) {
      time = client.getBlock({ blockNumber }).then((b) => b.timestamp);
      time.catch(() => blockTimes.delete(blockNumber)); // retried on the next sync
      blockTimes.set(blockNumber, time);
    }
    return time;
  };
  let next = c.deployBlock;
  return async function sync(): Promise<DealLog[]> {
    const head = await client.getBlockNumber({ cacheTime: 0 });
    const rescanFrom = next - RESCAN_BLOCKS;
    const from = rescanFrom > c.deployBlock ? rescanFrom : c.deployBlock;
    const fetched = await fetchDealLogs(client, c, from, head);
    const times = await Promise.all(fetched.map((log) => timeOf(log.blockNumber)));
    fetched.forEach((log, i) => {
      // log index is block-wide on Mezo, so block:index identifies a log
      logs.set(`${log.blockNumber}:${log.logIndex}`, { ...log, blockTimestamp: times[i] });
    });
    if (head >= next) next = head + 1n;
    return [...logs.values()];
  };
}
