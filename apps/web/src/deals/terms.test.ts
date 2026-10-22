import { keccak256, toBytes, zeroAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { DEFAULT_VALUES, dealFormSchema, feeOn, hashFile, toDealTerms } from "./terms";

const buyer: Address = "0x00000000000000000000000000000000000000b1";
const token: Address = "0x00000000000000000000000000000000000000aa";
const valid = {
  ...DEFAULT_VALUES,
  supplier: "0x00000000000000000000000000000000000000c2",
  inspector: "0x00000000000000000000000000000000000000c3",
  carrier: "0x00000000000000000000000000000000000000c4",
  arbiter: "0x00000000000000000000000000000000000000c5",
  bonder: "0x00000000000000000000000000000000000000c6",
  advance: "300",
  balance: "700.5",
  termsHash: keccak256(toBytes("terms")),
  termsFileName: "terms.pdf",
};

const issues = (values: unknown) => {
  const result = dealFormSchema(buyer).safeParse(values);
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
};

describe("dealFormSchema", () => {
  it("accepts complete terms", () => {
    expect(issues(valid)).toEqual([]);
  });

  it("rejects the buyer as supplier or arbiter, and supplier as arbiter", () => {
    expect(issues({ ...valid, supplier: buyer })).toEqual(["supplier"]);
    expect(issues({ ...valid, arbiter: buyer.toUpperCase().replace("0X", "0x") })).toEqual([
      "arbiter",
    ]);
    expect(issues({ ...valid, arbiter: valid.supplier })).toEqual(["arbiter"]);
  });

  it("rejects zero, malformed and over-precise amounts", () => {
    expect(issues({ ...valid, advance: "0" })).toEqual(["advance"]);
    expect(issues({ ...valid, advance: "1e3" })).toEqual(["advance"]);
    expect(issues({ ...valid, balance: `1.${"1".repeat(19)}` })).toEqual(["balance"]);
  });

  it("bounds periods to 1 minute … 365 days", () => {
    const at = (value: string, unit: "minutes" | "days") => ({
      ...valid,
      periods: { ...valid.periods, challenge: { value, unit } },
    });
    expect(issues(at("1", "minutes"))).toEqual([]);
    expect(issues(at("0", "minutes"))).toEqual(["periods.challenge.value"]);
    expect(issues(at("365", "days"))).toEqual([]);
    expect(issues(at("366", "days"))).toEqual(["periods.challenge.value"]);
  });

  it("checks bonder and ratio only when the bond is on", () => {
    expect(issues({ ...valid, bondRatioPct: "119" })).toEqual(["bondRatioPct"]);
    expect(issues({ ...valid, bondRatioPct: "501" })).toEqual(["bondRatioPct"]);
    expect(issues({ ...valid, bonder: zeroAddress })).toEqual(["bonder"]);
    expect(issues({ ...valid, bondEnabled: false, bonder: "", bondRatioPct: "" })).toEqual([]);
  });

  it("requires the terms document hash", () => {
    expect(issues({ ...valid, termsHash: "" })).toEqual(["termsHash"]);
  });
});

describe("toDealTerms", () => {
  const parse = (values: unknown) => dealFormSchema(buyer).parse(values);

  it("converts to exact on-chain units", () => {
    const terms = toDealTerms(parse(valid), { buyer, token, feeBps: 50 });
    expect(terms.advanceAmount).toBe(300n * 10n ** 18n);
    expect(terms.balanceAmount).toBe(7005n * 10n ** 17n);
    expect(terms.bondRatioBps).toBe(15_000);
    expect(terms.productionPeriod).toBe(30 * 86_400);
    expect(terms).toMatchObject({ buyer, token, feeBps: 50, bonder: valid.bonder });
  });

  it("clears bonder and ratio without a bond", () => {
    const terms = toDealTerms(parse({ ...valid, bondEnabled: false }), {
      buyer,
      token,
      feeBps: 50,
    });
    expect(terms.bonder).toBe(zeroAddress);
    expect(terms.bondRatioBps).toBe(0);
  });
});

describe("helpers", () => {
  it("rounds the fee down like the escrow", () => {
    expect(feeOn(199n, 50)).toBe(0n);
    expect(feeOn(300n * 10n ** 18n, 50)).toBe(15n * 10n ** 17n);
  });

  it("hashes file bytes with keccak256", async () => {
    expect(await hashFile(new Blob(["terms"]))).toBe(keccak256(toBytes("terms")));
  });
});
