import { AttestationKind } from "@wasit/sdk";
import { describe, expect, it } from "vitest";
import { decodeAttestation, encodeAttestation, type SignedAttestation } from "@/attest/attestation";
import { fromParam, toParam, whatsappLink } from "./share";

const signed: SignedAttestation = {
  escrow: "0x9d7573dd4A929311DDFC130ED085127517A9fC85",
  dealId: 12n,
  kind: AttestationKind.Shipped,
  evidenceHash: `0x${"cd".repeat(32)}`,
  issuedAt: 1_763_000_000n,
  signature: `0x${"11".repeat(65)}`,
};

describe("statement relay link", () => {
  it("round-trips a signed statement through a URL-safe parameter", () => {
    const param = toParam(encodeAttestation(signed));
    expect(param).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeAttestation(fromParam(param)!)).toEqual(signed);
  });

  it("rejects a damaged parameter", () => {
    const param = toParam(encodeAttestation(signed));
    expect(fromParam("%%%")).toBeUndefined();
    expect(decodeAttestation(fromParam(param.slice(0, 40)) ?? "")).toBeUndefined();
  });
});

describe("whatsapp link", () => {
  it("encodes the text", () => {
    expect(whatsappLink("My address: 0xAb & co")).toBe(
      "https://wa.me/?text=My%20address%3A%200xAb%20%26%20co",
    );
  });
});
