import {
  createWalletClient,
  hexToBigInt,
  http,
  isHex,
  type Address,
  type EIP1193RequestFn,
  type Hex,
  type TypedDataDefinition,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mezoTestnet } from "viem/chains";

/**
 * In-browser test wallet for people outside the team (PLAN 9.1, ADR-035 item 4). The key is made
 * on the participant's device, kept in this browser's storage and never sent anywhere. The
 * wallet refuses every chain except Mezo testnet, for switching, typed data and transactions.
 */
export const PILOT_CHAIN_ID = 31611;
export const PILOT_CHAIN_HEX = "0x7b7b";
export const PILOT_CONNECTOR_ID = "wasitPilot";
export const PILOT_STORAGE_KEY = "wasit.pilot-wallet.v1";

/** Where the key lives; `localStorage` in the app, a map in tests. */
export interface KeyStore {
  get(): string | null;
  set(value: string): void;
}

export const browserKeyStore: KeyStore = {
  get: () => {
    try {
      return localStorage.getItem(PILOT_STORAGE_KEY);
    } catch {
      return null;
    }
  },
  set: (value) => localStorage.setItem(PILOT_STORAGE_KEY, value),
};

const isKey = (v: string | null): v is Hex => !!v && isHex(v) && v.length === 66;

/** The stored key, if this browser has made one. */
export const loadPilotKey = (store: KeyStore = browserKeyStore): Hex | undefined => {
  const v = store.get();
  return isKey(v) ? v : undefined;
};

/** Returns the stored key, or makes one with the platform's secure random source and stores it. */
export function ensurePilotKey(store: KeyStore = browserKeyStore): Hex {
  const existing = loadPilotKey(store);
  if (existing) return existing;
  const key = generatePrivateKey();
  store.set(key);
  if (loadPilotKey(store) !== key) throw new Error("This browser would not store the test wallet.");
  return key;
}

export const pilotAddress = (key: Hex): Address => privateKeyToAccount(key).address;

/** EIP-1193 error with a code, as wallets throw them. */
export class WalletRpcError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

const WRONG_CHAIN = "This test wallet only works on the Mezo test network (chain 31611).";

/** Read methods passed through to the Mezo testnet RPC. Everything else is refused. */
const READS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
]);

type Field = { name: string; type: string };
interface TypedJson {
  domain?: Record<string, unknown>;
  types: Record<string, Field[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

/** eth_signTypedData_v4 JSON back to viem typed data, integers as bigint. */
export function reviveTypedData(json: string): TypedDataDefinition {
  const td = JSON.parse(json) as TypedJson;
  const revive = (type: string, value: unknown): unknown => {
    if (type.endsWith("]"))
      return (value as unknown[]).map((v) => revive(type.slice(0, type.lastIndexOf("[")), v));
    const fields = td.types[type];
    if (fields)
      return Object.fromEntries(
        fields.map((f) => [f.name, revive(f.type, (value as Record<string, unknown>)[f.name])]),
      );
    if (/^u?int\d*$/.test(type)) return BigInt(value as string | number);
    return value;
  };
  const types = Object.fromEntries(Object.entries(td.types).filter(([k]) => k !== "EIP712Domain"));
  return {
    domain: td.domain ?? {},
    types,
    primaryType: td.primaryType,
    message: revive(td.primaryType, td.message) as Record<string, unknown>,
  } as unknown as TypedDataDefinition;
}

const chainOf = (v: unknown) =>
  v === undefined || v === null ? undefined : Number(BigInt(v as string));

export interface PilotProvider {
  request: EIP1193RequestFn;
  on(event: string, fn: (...args: unknown[]) => void): PilotProvider;
  removeListener(event: string, fn: (...args: unknown[]) => void): PilotProvider;
}

/**
 * EIP-1193 provider for the test wallet. `read` forwards read-only calls (the Mezo testnet RPC by
 * default); signing happens here with the local key.
 */
export function createPilotProvider(
  key: Hex,
  read: (method: string, params: unknown) => Promise<unknown> = (method, params) =>
    http()({ chain: mezoTestnet }).request({ method, params } as never),
): PilotProvider {
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: mezoTestnet, transport: http() });
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  async function handle(method: string, params: unknown[]): Promise<unknown> {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account.address];
      case "eth_chainId":
        return PILOT_CHAIN_HEX;
      case "net_version":
        return String(PILOT_CHAIN_ID);
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain": {
        const id = chainOf((params[0] as { chainId?: string } | undefined)?.chainId);
        if (id !== PILOT_CHAIN_ID) throw new WalletRpcError(4902, WRONG_CHAIN);
        return null;
      }
      case "wallet_requestPermissions":
      case "wallet_getPermissions":
        return [{ parentCapability: "eth_accounts" }];
      case "wallet_revokePermissions":
        return null;
      case "personal_sign":
        return account.signMessage({ message: { raw: params[0] as Hex } });
      case "eth_signTypedData_v4": {
        const typed = reviveTypedData(params[1] as string);
        // A typed-data signature without this chain in its domain could be replayed elsewhere
        if (chainOf(typed.domain?.chainId) !== PILOT_CHAIN_ID)
          throw new WalletRpcError(4901, WRONG_CHAIN);
        return account.signTypedData(typed);
      }
      case "eth_sendTransaction": {
        const tx = params[0] as {
          to: Address;
          data?: Hex;
          input?: Hex;
          value?: Hex;
          gas?: Hex;
          chainId?: Hex;
        };
        const id = chainOf(tx.chainId);
        if (id !== undefined && id !== PILOT_CHAIN_ID) throw new WalletRpcError(4901, WRONG_CHAIN);
        return wallet.sendTransaction({
          to: tx.to,
          data: tx.data ?? tx.input,
          value: tx.value ? hexToBigInt(tx.value) : 0n,
          gas: tx.gas ? hexToBigInt(tx.gas) : undefined,
        });
      }
      default:
        if (READS.has(method)) return read(method, params);
        throw new WalletRpcError(4200, `The test wallet does not support ${method}.`);
    }
  }

  const provider: PilotProvider = {
    request: (async ({ method, params }: { method: string; params?: unknown }) =>
      handle(method, (params as unknown[] | undefined) ?? [])) as EIP1193RequestFn,
    on(event, fn) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
      return provider;
    },
    removeListener(event, fn) {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((f) => f !== fn),
      );
      return provider;
    },
  };
  return provider;
}
