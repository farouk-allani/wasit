import { wasitEscrowAbi } from "@wasit/sdk";
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  TransactionReceiptNotFoundError,
  UserRejectedRequestError,
  type Hash,
} from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  calldataGas,
  describeTxError,
  prepareGas,
  RevertedOnChainError,
  waitForReceipt,
  type ContractRequest,
} from "./tx";

const account = "0x00000000000000000000000000000000000000b1";
const request = {
  address: "0x00000000000000000000000000000000000000e5",
  abi: wasitEscrowAbi,
  functionName: "accept",
  args: [7n],
} as ContractRequest;
const hash: Hash = `0x${"ab".repeat(32)}`;
const fast = { attempts: 3, delayMs: 0 };

function reader(estimates: bigint[]) {
  return {
    simulateContract: vi.fn().mockResolvedValue({}),
    estimateContractGas: vi.fn(() => Promise.resolve(estimates.shift() ?? 0n)),
    getTransactionReceipt: vi.fn(),
  };
}

describe("calldataGas", () => {
  it("counts zero bytes as 1 token and others as 4", () => {
    // 2 zero bytes + 2 non-zero bytes = 10 tokens
    expect(calldataGas("0x0000ffff")).toEqual({ intrinsic: 21_040n, floor: 21_100n });
  });
});

describe("prepareGas", () => {
  it("adds 20% headroom to a sane estimate", async () => {
    const client = reader([100_000n]);
    expect(await prepareGas(client as never, request, account, fast)).toBe(120_000n);
    expect(client.simulateContract).toHaveBeenCalledOnce();
  });

  it("retries an estimate that ran no code", async () => {
    const client = reader([21_500n, 100_000n]);
    expect(await prepareGas(client as never, request, account, fast)).toBe(120_000n);
    expect(client.estimateContractGas).toHaveBeenCalledTimes(2);
  });

  it("gives up after repeated bad estimates", async () => {
    const client = reader([21_500n, 21_500n, 21_500n]);
    await expect(prepareGas(client as never, request, account, fast)).rejects.toThrow(
      /looks wrong/,
    );
  });

  it("does not estimate when the simulation reverts", async () => {
    const client = reader([100_000n]);
    client.simulateContract.mockRejectedValue(new Error("reverted"));
    await expect(prepareGas(client as never, request, account, fast)).rejects.toThrow("reverted");
    expect(client.estimateContractGas).not.toHaveBeenCalled();
  });
});

describe("waitForReceipt", () => {
  const opts = { intervalMs: 0 };

  it("keeps polling while nodes have not indexed the tx", async () => {
    const client = reader([]);
    client.getTransactionReceipt
      .mockRejectedValueOnce(new TransactionReceiptNotFoundError({ hash }))
      .mockRejectedValueOnce(new TransactionReceiptNotFoundError({ hash }))
      .mockResolvedValue({ status: "success" });
    await expect(waitForReceipt(client as never, hash, opts)).resolves.toMatchObject({
      status: "success",
    });
    expect(client.getTransactionReceipt).toHaveBeenCalledTimes(3);
  });

  it("reports a reverted receipt", async () => {
    const client = reader([]);
    client.getTransactionReceipt.mockResolvedValue({ status: "reverted" });
    await expect(waitForReceipt(client as never, hash, opts)).rejects.toBeInstanceOf(
      RevertedOnChainError,
    );
  });
});

describe("describeTxError", () => {
  it("names a decoded escrow revert in plain words", () => {
    const data = encodeErrorResult({ abi: wasitEscrowAbi, errorName: "ConflictingParties" });
    const err = new BaseError("call failed", {
      cause: new ContractFunctionRevertedError({
        abi: wasitEscrowAbi,
        data,
        functionName: "createDeal",
      }),
    });
    expect(describeTxError(err)).toMatch(/arbiter must be neither/);
  });

  it("recognizes a wallet rejection", () => {
    const err = new BaseError("rejected", {
      cause: new UserRejectedRequestError(new Error("no")),
    });
    expect(describeTxError(err)).toMatch(/declined/);
  });
});
