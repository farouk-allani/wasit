import { readFileSync } from "node:fs";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  hexToBytes,
  http,
  type Abi,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";
import { mezoTestnet } from "viem/chains";

/** Account order of the testnet mnemonic (contracts/.env.example). */
export const ROLES = [
  "deployer",
  "buyer",
  "supplier",
  "agent",
  "inspector",
  "carrier",
  "arbiter",
] as const;
export type Role = (typeof ROLES)[number];
export type Accounts = Record<Role, HDAccount>;

/** Shape written by contracts/script/Deploy.s.sol (ARCHITECTURE §11). */
export interface Deployment {
  chainId: number;
  escrow: Address;
  bond: Address;
  oracle: Address;
  swapAdapter: Address;
  musd: Address;
  btc: Address;
  router: Address;
  owner: Address;
  simulatedPriceFeed: boolean;
  deployBlock: number;
}

export interface ContractCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

const repo = new URL("../../../", import.meta.url);
export const chain = mezoTestnet;

export function loadDeployment(name: "mezo-testnet" | "mezo-testnet-demo-sim"): Deployment {
  const d = JSON.parse(
    readFileSync(new URL(`deployments/${name}.json`, repo), "utf8"),
  ) as Deployment;
  if (d.chainId !== chain.id) throw new Error(`${name}: chain ${d.chainId}, expected ${chain.id}`);
  return d;
}

/** ABI from the forge build output (`forge build` in contracts/ first). */
export function loadAbi(file: string, contract = file): Abi {
  const artifact = JSON.parse(
    readFileSync(new URL(`contracts/out/${file}.sol/${contract}.json`, repo), "utf8"),
  ) as { abi: Abi };
  return artifact.abi;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function revertName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  return revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined;
}

/** Intrinsic gas of a call's calldata and its EIP-7623 floor (Mezo's EVM is post-Prague). */
function calldataGas(data: Hex): { intrinsic: bigint; floor: bigint } {
  const bytes = hexToBytes(data);
  const zeros = bytes.filter((b) => b === 0).length;
  const tokens = BigInt(zeros + 4 * (bytes.length - zeros));
  return { intrinsic: 21_000n + 4n * tokens, floor: 21_000n + 10n * tokens };
}

/**
 * Signs with the testnet mnemonic from contracts/.env and refuses any chain but Mezo testnet.
 * The public RPC is load-balanced across nodes that do not always agree (VERIFIED-FACTS): a node
 * may not have seen our previous tx yet, or may answer an estimate without running the contract.
 * So estimates are sanity-checked and retried, receipts are polled until found, and nonces are
 * tracked locally instead of trusting one node's count.
 */
export async function connect() {
  process.loadEnvFile(new URL("contracts/.env", repo));
  const rpc = process.env.MEZO_TESTNET_RPC;
  const mnemonic = process.env.WASIT_TESTNET_MNEMONIC;
  if (!rpc || !mnemonic) throw new Error("set MEZO_TESTNET_RPC and WASIT_TESTNET_MNEMONIC");

  const transport = http(rpc, { retryCount: 5, retryDelay: 1_000 });
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ chain, transport });
  const chainId = await pub.getChainId();
  if (chainId !== chain.id) throw new Error(`refusing to run on chain ${chainId}`);

  const accounts = Object.fromEntries(
    ROLES.map((role, i) => [role, mnemonicToAccount(mnemonic, { addressIndex: i })]),
  ) as Accounts;
  const nonces = new Map<Address, number>();
  const sent: { label: string; hash: Hash }[] = [];

  /** Retries `fn` while it reverts: up to 5 times, or for ~5 min while it reverts `waitFor`. */
  async function retry<T>(fn: () => Promise<T>, waitFor?: string): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const waiting = waitFor !== undefined && revertName(err) === waitFor;
        if (attempt >= (waiting ? 60 : 5)) throw err;
        await sleep(waiting ? 5_000 : 3_000);
      }
    }
  }

  async function nextNonce(address: Address): Promise<number> {
    const remote = await pub.getTransactionCount({ address, blockTag: "pending" });
    return Math.max(remote, nonces.get(address) ?? 0);
  }

  /**
   * Polls for the receipt, treating "not found" and RPC errors as "not yet". Not viem's
   * waitForTransactionReceipt: its replacement check finds our own tx in the block, re-reads the
   * receipt from a node that has not indexed it, and rejects (VERIFIED-FACTS).
   */
  async function settle(label: string, hash: Hash): Promise<TransactionReceipt> {
    console.log(`  ${label}: ${chain.blockExplorers.default.url}/tx/${hash}`);
    const deadline = Date.now() + 180_000;
    for (;;) {
      try {
        const receipt = await pub.getTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`${label} reverted on-chain: ${hash}`);
        sent.push({ label, hash });
        return receipt;
      } catch (err) {
        if (!(err instanceof BaseError) || Date.now() > deadline) throw err;
        await sleep(2_000);
      }
    }
  }

  /** Sends a contract call from `from`; `waitFor` names a revert that means "not yet, retry". */
  async function call(
    label: string,
    from: HDAccount,
    request: ContractCall,
    waitFor?: string,
  ): Promise<TransactionReceipt> {
    // eth_call first: Mezo's eth_estimateGas drops revert data, eth_call keeps it, so this is
    // where a revert is decoded (and where `waitFor` is recognized)
    await retry(() => pub.simulateContract({ ...request, account: from }), waitFor);
    const { intrinsic, floor } = calldataGas(encodeFunctionData(request));
    const gas = await retry(async () => {
      const estimate = await pub.estimateContractGas({ ...request, account: from });
      // Seen on testnet: 25,603 for createDeal (294,152 elsewhere), i.e. no code was run
      if (estimate < intrinsic + 2_000n) throw new Error(`estimate ${estimate} ran no code`);
      return estimate;
    }, waitFor);
    const nonce = await nextNonce(from.address);
    const limit = gas + gas / 5n;
    const hash = await wallet.writeContract({
      ...request,
      account: from,
      gas: limit > floor ? limit : floor,
      nonce,
    });
    nonces.set(from.address, nonce + 1);
    return settle(label, hash);
  }

  /** Sends native BTC. */
  async function transfer(label: string, from: HDAccount, to: Address, value: bigint) {
    const gas = await retry(() => pub.estimateGas({ account: from, to, value }));
    const nonce = await nextNonce(from.address);
    const hash = await wallet.sendTransaction({
      account: from,
      to,
      value,
      gas: gas + gas / 5n,
      nonce,
    });
    nonces.set(from.address, nonce + 1);
    return settle(label, hash);
  }

  /** Reads until `ok` accepts the result (a lagging node may answer from an older block). */
  async function readUntil<T>(read: () => Promise<T>, ok: (value: T) => boolean): Promise<T> {
    return retry(async () => {
      const value = await read();
      if (!ok(value)) throw new Error("read not up to date yet");
      return value;
    });
  }

  async function blockTime(receipt: TransactionReceipt): Promise<bigint> {
    const block = await retry(() => pub.getBlock({ blockNumber: receipt.blockNumber }));
    return block.timestamp;
  }

  return { pub, accounts, call, transfer, readUntil, blockTime, sent };
}

export type Ctx = Awaited<ReturnType<typeof connect>>;
