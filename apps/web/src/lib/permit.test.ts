import { describe, expect, it } from "vitest";
import { domainSeparator, hashTypedData, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { permitTypedData, permitTypes } from "./permit";

const MUSD = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
const domain = { name: "Mezo USD", version: "1", chainId: 31611, verifyingContract: MUSD } as const;

describe("permitTypedData", () => {
  it("uses a domain whose hash equals MUSD's DOMAIN_SEPARATOR on Mezo testnet", () => {
    // cast call <MUSD> "DOMAIN_SEPARATOR()(bytes32)", 2026-10-22 (VERIFIED-FACTS)
    expect(domainSeparator({ domain })).toBe(
      "0x6f9f5c5d441374bdc3939f5da85a145469d7ffbc96bfe0cce59e5de7d8f1474f",
    );
  });

  it("signs a permit the owner's address recovers from", async () => {
    const owner = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const data = permitTypedData(domain, {
      owner: owner.address,
      spender: "0x9d7573dd4A929311DDFC130ED085127517A9fC85",
      value: 30n * 10n ** 18n,
      nonce: 0n,
      deadline: 1_792_000_000n,
    });
    const signature = await owner.signTypedData(data);
    expect(await recoverTypedDataAddress({ ...data, signature })).toBe(owner.address);
    expect(hashTypedData(data)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(permitTypes.Permit.map((f) => f.name)).toEqual([
      "owner",
      "spender",
      "value",
      "nonce",
      "deadline",
    ]);
  });
});
