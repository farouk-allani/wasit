import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import {
  createLogStore,
  fetchDealLogs,
  LOG_CONCURRENCY,
  MAX_LOG_RANGE,
  RESCAN_BLOCKS,
  type LogReader,
} from "./events";

const contracts = {
  escrow: "0x9d7573dd4A929311DDFC130ED085127517A9fC85" as Address,
  bond: "0x195474AF5d673e1597Eb31E978a57F81892f5Ad0" as Address,
  deployBlock: 1_000n,
};

/** Fake RPC: one escrow log in every block, records every range it is asked for. */
function fakeClient(head: { value: bigint }) {
  const ranges: { address: Address[]; fromBlock: bigint; toBlock: bigint }[] = [];
  const blocksRead: bigint[] = [];
  const client = {
    getBlockNumber: () => Promise.resolve(head.value),
    getBlock: ({ blockNumber }: { blockNumber: bigint }) => {
      blocksRead.push(blockNumber);
      return Promise.resolve({ timestamp: 1_792_000_000n + blockNumber });
    },
    getLogs: ({ address, fromBlock, toBlock }: (typeof ranges)[number]) => {
      ranges.push({ address, fromBlock, toBlock });
      const logs = [];
      for (let b = fromBlock; b <= toBlock; b++) {
        logs.push({
          eventName: "DisputeLapsed",
          args: { dealId: 1n },
          blockNumber: b,
          logIndex: 0,
          blockTimestamp: 0n, // what Mezo's RPC returns
        });
      }
      return Promise.resolve(logs);
    },
  } as unknown as LogReader;
  return { client, ranges, blocksRead };
}

describe("fetchDealLogs", () => {
  it("splits a long range into calls the RPC accepts, one per range for escrow and bond", async () => {
    const { client, ranges } = fakeClient({ value: 0n });
    const logs = await fetchDealLogs(client, contracts, 1_000n, 25_000n);
    expect(ranges.map((r) => [r.fromBlock, r.toBlock])).toEqual([
      [1_000n, 10_999n],
      [11_000n, 20_999n],
      [21_000n, 25_000n],
    ]);
    expect(ranges.every((r) => r.toBlock - r.fromBlock < MAX_LOG_RANGE)).toBe(true);
    expect(
      ranges.every((r) => r.address.join() === [contracts.escrow, contracts.bond].join()),
    ).toBe(true);
    expect(logs).toHaveLength(24_001);
  });

  it(`reads up to ${LOG_CONCURRENCY} ranges at once and still returns every log`, async () => {
    let inFlight = 0;
    let peak = 0;
    const client = {
      getLogs: async ({ fromBlock }: { fromBlock: bigint }) => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return [{ blockNumber: fromBlock }];
      },
    } as unknown as LogReader;
    const logs = await fetchDealLogs(client, contracts, 0n, 20n * MAX_LOG_RANGE - 1n);
    expect(peak).toBe(LOG_CONCURRENCY);
    expect(logs.map((l) => l.blockNumber).sort((a, b) => Number(a - b))).toEqual(
      Array.from({ length: 20 }, (_, i) => BigInt(i) * MAX_LOG_RANGE),
    );
  });
});

describe("createLogStore", () => {
  it("reads from deployBlock once, then only new blocks plus the rescan window, without duplicates", async () => {
    const head = { value: 1_500n };
    const { client, ranges } = fakeClient(head);
    const sync = createLogStore(client, contracts);

    expect(await sync()).toHaveLength(501);
    expect(ranges[0]).toMatchObject({ fromBlock: 1_000n, toBlock: 1_500n });

    head.value = 1_510n;
    ranges.length = 0;
    expect(await sync()).toHaveLength(511);
    expect(ranges[0]).toMatchObject({ fromBlock: 1_501n - RESCAN_BLOCKS, toBlock: 1_510n });
  });

  it("replaces the 0 block time with the block's timestamp, reading each block once", async () => {
    const head = { value: 1_010n };
    const { client, blocksRead } = fakeClient(head);
    const sync = createLogStore(client, contracts);
    const first = await sync();
    expect(first.find((l) => l.blockNumber === 1_005n)?.blockTimestamp).toBe(1_792_001_005n);
    await sync(); // rescans the same blocks
    expect(blocksRead).toHaveLength(11);
  });

  it("never moves back when a lagging node reports an older head", async () => {
    const head = { value: 2_000n };
    const { client, ranges } = fakeClient(head);
    const sync = createLogStore(client, contracts);
    await sync();
    head.value = 1_990n;
    ranges.length = 0;
    expect(await sync()).toHaveLength(1_001);
    expect(ranges[0]?.fromBlock).toBe(2_001n - RESCAN_BLOCKS);
  });
});
