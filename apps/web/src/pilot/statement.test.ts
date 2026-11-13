import { recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { parseStatement, statementText } from "./statement";

const account = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const input = {
  dealId: 7n,
  escrow: "0x9d7573dd4A929311DDFC130ED085127517A9fC85",
  role: "inspector",
  wallet: account.address,
  date: "2026-11-13",
  city: "Sfax",
  describeAs: "works in freight\nand customs",
} as const;

describe("pilot statement", () => {
  it("says the three things in plain words and reads back", () => {
    const text = statementText(input);
    expect(text).toContain(
      "Its key was created on my device and the Wasit team has never held it.",
    );
    expect(text).toContain("No real money and no real goods were involved.");
    expect(parseStatement(text)).toEqual({
      dealId: 7n,
      escrow: input.escrow,
      role: "inspector",
      wallet: account.address,
      date: "2026-11-13",
      city: "Sfax",
      describeAs: "works in freight and customs",
    });
  });

  it("marks missing optional fields instead of leaving them blank", () => {
    const text = statementText({ ...input, city: " ", describeAs: undefined });
    expect(parseStatement(text)?.city).toBe("not given");
    expect(parseStatement(text)?.describeAs).toBe("not given");
  });

  it("recovers the wallet that signed it", async () => {
    const message = statementText(input);
    const signature = await account.signMessage({ message });
    expect(await recoverMessageAddress({ message, signature })).toBe(account.address);
  });

  it("rejects text that is not a statement", () => {
    expect(parseStatement("hello")).toBeUndefined();
    expect(
      parseStatement(statementText(input).replace("Wallet: 0x", "Wallet: 1x")),
    ).toBeUndefined();
  });
});
