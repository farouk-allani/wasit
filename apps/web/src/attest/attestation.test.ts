import { AttestationKind, BondSettlement, DealState, type Deal } from "@wasit/sdk";
import { recoverTypedDataAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  attestationTypedData,
  decodeAttestation,
  encodeAttestation,
  expectedAttestation,
  pickIssuedAt,
} from "./attestation";

const ESCROW: Address = "0x9d7573dd4A929311DDFC130ED085127517A9fC85";
const INSPECTOR: Address = "0xb81e05e23A4b0030173B78A20757Bbe9b749c9e9";
const CARRIER: Address = "0x230c000000000000000000000000000000008ef2";
const T0 = 1_792_000_000n;
const HASH = `0x${"ab".repeat(32)}` as const;

const deal = (state: DealState, o: Partial<Deal> = {}) =>
  ({
    terms: { inspector: INSPECTOR, carrier: CARRIER, productionPeriod: 600, shippingPeriod: 300 },
    state,
    advancePaidAt: T0,
    balanceFundedAt: T0 + 1_000n,
    bondPending: BondSettlement.None,
    ...o,
  }) as unknown as Deal;

describe("expectedAttestation", () => {
  it("asks the inspector while in production and the carrier once the balance is in", () => {
    expect(expectedAttestation(deal(DealState.AdvancePaid))).toEqual({
      kind: AttestationKind.ReadyInspected,
      role: "inspector",
      signer: INSPECTOR,
      previous: T0,
      deadline: T0 + 600n,
    });
    expect(expectedAttestation(deal(DealState.BalanceFunded))).toMatchObject({
      kind: AttestationKind.Shipped,
      signer: CARRIER,
      previous: T0 + 1_000n,
      deadline: T0 + 1_300n,
    });
  });

  it("asks nothing in other states", () => {
    for (const s of [
      DealState.Accepted,
      DealState.GoodsReady,
      DealState.Shipped,
      DealState.Released,
    ])
      expect(expectedAttestation(deal(s))).toBeUndefined();
  });
});

describe("pickIssuedAt", () => {
  it("stays a minute behind the clock but never before the milestone", () => {
    expect(pickIssuedAt(T0 + 600n, T0)).toBe(T0 + 540n);
    expect(pickIssuedAt(T0 + 30n, T0)).toBe(T0);
  });
});

describe("signed statements", () => {
  it("round-trip through the pasted JSON and recover to the signer", async () => {
    const inspector = privateKeyToAccount(`0x${"22".repeat(32)}`);
    const message = {
      dealId: 7n,
      kind: AttestationKind.ReadyInspected,
      evidenceHash: HASH,
      issuedAt: T0,
      nonce: 0n,
    };
    const data = attestationTypedData(31611, ESCROW, message);
    const signature = await inspector.signTypedData(data);
    const text = encodeAttestation({ escrow: ESCROW, ...message, signature });
    const back = decodeAttestation(text)!;
    expect(back).toEqual({
      escrow: ESCROW,
      dealId: 7n,
      kind: 1,
      evidenceHash: HASH,
      issuedAt: T0,
      signature,
    });
    expect(await recoverTypedDataAddress({ ...data, signature: back.signature })).toBe(
      inspector.address,
    );
  });

  it("rejects anything else", () => {
    expect(decodeAttestation("hello")).toBeUndefined();
    expect(
      decodeAttestation(JSON.stringify({ escrow: ESCROW, dealId: "1", kind: 3 })),
    ).toBeUndefined();
  });
});
