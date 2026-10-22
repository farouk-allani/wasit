import {
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  hexToBytes,
  UserRejectedRequestError,
  type Abi,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hash,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";

/** A call to a state-changing contract function, typed from its ABI. */
export type ContractRequest<
  abi extends Abi = Abi,
  fn extends ContractFunctionName<abi, "nonpayable"> = ContractFunctionName<abi, "nonpayable">,
> = {
  address: Address;
  abi: abi;
  functionName: fn;
  args: ContractFunctionArgs<abi, "nonpayable", fn>;
};

/** Client methods the helpers use; the shared public client satisfies it, tests pass a stub. */
type Reader = Pick<
  PublicClient,
  "simulateContract" | "estimateContractGas" | "getTransactionReceipt"
>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Intrinsic gas of a call's calldata and its EIP-7623 floor (Mezo's EVM is post-Prague). */
export function calldataGas(data: Hex): { intrinsic: bigint; floor: bigint } {
  const bytes = hexToBytes(data);
  const zeros = bytes.filter((b) => b === 0).length;
  const tokens = BigInt(zeros + 4 * (bytes.length - zeros));
  return { intrinsic: 21_000n + 4n * tokens, floor: 21_000n + 10n * tokens };
}

/**
 * Simulates the call, then returns a gas limit for it. Mirrors packages/scripts `call()`: the
 * public testnet RPC is load-balanced across nodes that do not always agree (VERIFIED-FACTS).
 * eth_call runs first because eth_estimateGas drops revert data, so a revert is decoded here; an
 * estimate that ran no code (≈ intrinsic gas) is retried; the limit never goes below the
 * EIP-7623 floor, which the node would reject.
 */
export async function prepareGas(
  client: Reader,
  request: ContractRequest,
  account: Address,
  { attempts = 4, delayMs = 1_500 } = {},
): Promise<bigint> {
  await client.simulateContract({ ...request, account } as never);
  const { intrinsic, floor } = calldataGas(encodeFunctionData(request as never));
  for (let attempt = 1; ; attempt++) {
    const estimate = await client.estimateContractGas({ ...request, account });
    if (estimate >= intrinsic + 2_000n) {
      const limit = estimate + estimate / 5n;
      return limit > floor ? limit : floor;
    }
    if (attempt >= attempts) throw new Error(`gas estimate ${estimate} looks wrong; try again`);
    await sleep(delayMs);
  }
}

/** Raised when a mined transaction reverted. */
export class RevertedOnChainError extends Error {
  constructor(readonly hash: Hash) {
    super("The transaction was mined but reverted. Nothing changed on-chain.");
  }
}

/**
 * Polls for the receipt, treating "not found" and RPC errors as "not yet". Not viem's
 * waitForTransactionReceipt: its replacement check re-reads the receipt from a node that has not
 * indexed it yet and gives up on a mined tx (VERIFIED-FACTS).
 */
export async function waitForReceipt(
  client: Reader,
  hash: Hash,
  { timeoutMs = 180_000, intervalMs = 2_000 } = {},
): Promise<TransactionReceipt> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const receipt = await client.getTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new RevertedOnChainError(hash);
      return receipt;
    } catch (err) {
      if (!(err instanceof BaseError) || Date.now() > deadline) throw err;
      await sleep(intervalMs);
    }
  }
}

/** Plain words for the escrow's custom errors a user can run into from the UI. */
const REVERT_REASONS: Record<string, string> = {
  ArbiterNotAccepted: "The arbiter has not accepted the role yet.",
  BondNotReady: "The bond is not posted at the required coverage yet.",
  ConflictingParties: "Buyer and supplier must differ, and the arbiter must be neither of them.",
  DeadlineNotReached: "This deadline has not passed yet.",
  DeadlinePassed: "The deadline for this step has passed.",
  EnforcedPause: "New deals are paused by the operator. Open deals are not affected.",
  FeeMismatch: "The protocol fee changed while you were filling the form. Review and retry.",
  InsufficientCoverage: "The bond would not reach the required coverage.",
  InvalidBondRatio: "The bond ratio is outside the allowed range.",
  InvalidPeriod: "A period is outside the allowed range.",
  InvalidSignature: "The signature does not match the named attestor.",
  InvalidState: "The deal is not in a state that allows this action. Refresh the page.",
  MissingTermsHash: "Attach the terms document so its hash can be recorded.",
  TokenNotAllowed: "This token is not accepted by the escrow.",
  Unauthorized: "Your connected wallet is not the party allowed to do this.",
  ZeroAddress: "Every named party needs an address.",
  ZeroAmount: "Advance and balance must both be above zero.",
};

/** One sentence for a failed transaction, suitable for showing to the user. */
export function describeTxError(err: unknown): string {
  if (err instanceof RevertedOnChainError) return err.message;
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError))
      return "You declined the request in your wallet. Nothing was sent.";
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name) return REVERT_REASONS[name] ?? `The contract refused the call (${name}).`;
      return "The contract refused the call.";
    }
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}
