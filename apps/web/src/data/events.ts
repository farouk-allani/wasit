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
export type LogReader = Pick<PublicClient, "getLogs" | "getBlockNumber" | "getBlock">;

/**
 * Ranges read at the same time. The public RPC takes ~1 s per range and the chain grows ~18,500
 * blocks a day, so a sequential scan from deployBlock gets slower every day (12 ranges: 12.5 s
 * one by one, 3.5–4.5 s with 4–8 at once, measured 2026-10-23).
 */
export const LOG_CONCURRENCY = 6;

/**
 * Escrow and bond events, read with one eth_getLogs per range for both addresses (the RPC's
 * throughput, not latency, is the limit). The two ABIs share only Ownable2Step's events, with
 * identical signatures, so every log decodes the same as with its own contract's ABI.
 */
const DEAL_EVENTS = [...wasitEscrowAbi, ...advanceBondAbi].filter(
  (item): item is Extract<typeof item, { type: "event" }> => item.type === "event",
);

/** Escrow and bond logs in [fromBlock, toBlock], read in ranges the RPC accepts (any order). */
export async function fetchDealLogs(
  client: LogReader,
  c: DealContracts,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<DealLog[]> {
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let start = fromBlock; start <= toBlock; start += MAX_LOG_RANGE) {
    const last = start + MAX_LOG_RANGE - 1n;
    ranges.push({ fromBlock: start, toBlock: last < toBlock ? last : toBlock });
  }
  const logs: DealLog[] = [];
  let nextRange = 0;
  const worker = async () => {
    while (nextRange < ranges.length) {
      const range = ranges[nextRange++]!;
      const found = await client.getLogs({
        ...range,
        address: [c.escrow, c.bond],
        events: DEAL_EVENTS,
        strict: true,
      });
      logs.push(...(found as DealLog[]));
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOG_CONCURRENCY, ranges.length) }, worker));
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
