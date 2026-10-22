import { keccak256, toBytes, zeroAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_VALUES,
  dealFormSchema,
  feeOn,
  hashFile,
  splitOrder,
  summarize,
  toDealTerms,
} from "./terms";

const buyer: Address = "0x00000000000000000000000000000000000000b1";
const token: Address = "0x00000000000000000000000000000000000000aa";
const valid = {
  ...DEFAULT_VALUES,
  supplier: "0x00000000000000000000000000000000000000c2",
  inspector: "0x00000000000000000000000000000000000000c3",
  carrier: "0x00000000000000000000000000000000000000c4",
  arbiter: "0x00000000000000000000000000000000000000c5",
  bonder: "0x00000000000000000000000000000000000000c6",
  total: "1000",
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
    expect(issues({ ...valid, total: "0" })).toEqual(["total"]);
    expect(issues({ ...valid, total: "1e3" })).toEqual(["total"]);
    expect(issues({ ...valid, total: `1.${"1".repeat(19)}` })).toEqual(["total"]);
    // 30% of 1 wei rounds to a zero advance
    expect(issues({ ...valid, total: "0.000000000000000001" })).toEqual(["total"]);
    expect(issues({ ...valid, advancePct: 100 })).toEqual(["advancePct"]);
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
    expect(terms.balanceAmount).toBe(700n * 10n ** 18n);
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
  it("splits an order with the advance rounded down", () => {
    expect(splitOrder(1001n, 30)).toEqual({ advance: 300n, balance: 701n });
  });

  it("rounds the fee down like the escrow", () => {
    expect(feeOn(199n, 50)).toBe(0n);
    expect(feeOn(300n * 10n ** 18n, 50)).toBe(15n * 10n ** 17n);
  });

  it("hashes file bytes with keccak256", async () => {
    expect(await hashFile(new Blob(["terms"]))).toBe(keccak256(toBytes("terms")));
  });
});

describe("summarize", () => {
  it("splits a 3,000 + 7,000 MUSD deal like the escrow", () => {
    const m = 10n ** 18n;
    const s = summarize({
      advanceAmount: 3_000n * m,
      balanceAmount: 7_000n * m,
      feeBps: 50,
      bondRatioBps: 15_000,
    });
    expect(s.netAdvance).toBe(2_985n * m);
    expect(s.netBalance).toBe(6_965n * m);
    expect(s.advanceFee + s.balanceFee).toBe(50n * m);
    expect(s.bondTarget).toBe(44_775n * (m / 10n));
  });
});
