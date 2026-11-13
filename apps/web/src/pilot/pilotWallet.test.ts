import { attestationDomain, attestationTypes, AttestationKind } from "@wasit/sdk";
import { recoverMessageAddress, recoverTypedDataAddress, stringToHex, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  createPilotProvider,
  ensurePilotKey,
  loadPilotKey,
  pilotAddress,
  type KeyStore,
} from "./pilotWallet";

const memoryStore = (initial: string | null = null): KeyStore & { value: string | null } => {
  const s = {
    value: initial,
    get: () => s.value,
    set: (v: string) => {
      s.value = v;
    },
  };
  return s;
};

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const ESCROW = "0x9d7573dd4A929311DDFC130ED085127517A9fC85";

/** viem's own JSON for eth_signTypedData_v4: bigints as decimal strings. */
const typedJson = (chainId: number) =>
  JSON.stringify(
    {
      domain: attestationDomain(chainId, ESCROW),
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        ...attestationTypes,
      },
      primaryType: "Attestation",
      message: {
        dealId: 7n,
        kind: AttestationKind.ReadyInspected,
        evidenceHash: `0x${"ab".repeat(32)}`,
        issuedAt: 1_763_000_000n,
        nonce: 0n,
      },
    },
    (_, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
  );

describe("pilot key", () => {
  it("is created once, stored, and reused", () => {
    const store = memoryStore();
    expect(loadPilotKey(store)).toBeUndefined();
    const key = ensurePilotKey(store);
    expect(key).toMatch(/^0x[0-9a-f]{64}$/);
    expect(store.value).toBe(key);
    expect(ensurePilotKey(store)).toBe(key);
  });

  it("differs between browsers", () => {
    expect(ensurePilotKey(memoryStore())).not.toBe(ensurePilotKey(memoryStore()));
  });

  it("ignores a corrupted stored value and replaces it", () => {
    const store = memoryStore("not a key");
    expect(loadPilotKey(store)).toBeUndefined();
    expect(ensurePilotKey(store)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("fails loudly if the browser will not keep it", () => {
    const store: KeyStore = { get: () => null, set: () => undefined };
    expect(() => ensurePilotKey(store)).toThrow(/would not store/);
  });
});

describe("pilot provider", () => {
  const read = vi.fn<(method: string, params: unknown) => Promise<unknown>>(() =>
    Promise.resolve("0x1"),
  );
  const p = createPilotProvider(KEY, read);
  const req = (method: string, params?: unknown[]): Promise<unknown> =>
    p.request({ method, params } as never);

  it("reports its account and Mezo testnet", async () => {
    expect(await req("eth_requestAccounts")).toEqual([pilotAddress(KEY)]);
    expect(await req("eth_chainId")).toBe("0x7b7b");
  });

  it("accepts a switch to Mezo testnet and refuses every other chain", async () => {
    expect(await req("wallet_switchEthereumChain", [{ chainId: "0x7b7b" }])).toBeNull();
    await expect(req("wallet_switchEthereumChain", [{ chainId: "0x1" }])).rejects.toMatchObject({
      code: 4902,
    });
    await expect(req("wallet_addEthereumChain", [{ chainId: "0x7b8c" }])).rejects.toMatchObject({
      code: 4902,
    });
  });

  it("signs typed data for Mezo testnet with the local key", async () => {
    const json = typedJson(31611);
    const sig = (await req("eth_signTypedData_v4", [pilotAddress(KEY), json])) as Hex;
    const typed = JSON.parse(json) as {
      message: { dealId: string; kind: number; evidenceHash: Hex; issuedAt: string; nonce: string };
    };
    const signer = await recoverTypedDataAddress({
      domain: attestationDomain(31611, ESCROW),
      types: attestationTypes,
      primaryType: "Attestation",
      message: {
        dealId: BigInt(typed.message.dealId),
        kind: Number(typed.message.kind),
        evidenceHash: typed.message.evidenceHash,
        issuedAt: BigInt(typed.message.issuedAt),
        nonce: BigInt(typed.message.nonce),
      },
      signature: sig,
    });
    expect(signer).toBe(pilotAddress(KEY));
  });

  it("refuses typed data for another chain or with no chain at all", async () => {
    await expect(
      req("eth_signTypedData_v4", [pilotAddress(KEY), typedJson(1)]),
    ).rejects.toMatchObject({ code: 4901 });
    const noChain = JSON.parse(typedJson(31611)) as { domain: Record<string, unknown> };
    delete noChain.domain.chainId;
    await expect(
      req("eth_signTypedData_v4", [pilotAddress(KEY), JSON.stringify(noChain)]),
    ).rejects.toMatchObject({ code: 4901 });
  });

  it("refuses a transaction for another chain before signing it", async () => {
    await expect(
      req("eth_sendTransaction", [{ to: ESCROW, chainId: "0x1" }]),
    ).rejects.toMatchObject({ code: 4901 });
  });

  it("signs a plain-text message (the pilot statement)", async () => {
    const msg = "This wallet is mine.";
    const sig = (await req("personal_sign", [stringToHex(msg), pilotAddress(KEY)])) as Hex;
    expect(await recoverMessageAddress({ message: msg, signature: sig })).toBe(pilotAddress(KEY));
  });

  it("passes reads through and refuses anything it does not know", async () => {
    expect(await req("eth_blockNumber")).toBe("0x1");
    expect(read).toHaveBeenCalledWith("eth_blockNumber", []);
    await expect(req("eth_sign", [pilotAddress(KEY), "0x00"])).rejects.toMatchObject({
      code: 4200,
    });
  });
});
