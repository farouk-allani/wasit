import {
  AttestationKind,
  DealState,
  attestationDomain,
  attestationTypes,
  type Deal,
} from "@wasit/sdk";
import { isAddress, isHex, type Address, type Hex } from "viem";
import { z } from "zod";

export interface ExpectedAttestation {
  kind: AttestationKind;
  role: "inspector" | "carrier";
  signer: Address;
  /** Milestone the statement may not predate (`issuedAt ≥ previous`). */
  previous: bigint;
  deadline: bigint;
}

/** The attestation the deal waits for in its current state, as `submitAttestation` checks it. */
export function expectedAttestation(deal: Deal): ExpectedAttestation | undefined {
  const t = deal.terms;
  if (deal.state === DealState.AdvancePaid)
    return {
      kind: AttestationKind.ReadyInspected,
      role: "inspector",
      signer: t.inspector,
      previous: deal.advancePaidAt,
      deadline: deal.advancePaidAt + BigInt(t.productionPeriod),
    };
  if (deal.state === DealState.BalanceFunded)
    return {
      kind: AttestationKind.Shipped,
      role: "carrier",
      signer: t.carrier,
      previous: deal.balanceFundedAt,
      deadline: deal.balanceFundedAt + BigInt(t.shippingPeriod),
    };
  return undefined;
}

/**
 * `issuedAt` for a statement signed now: a minute behind the device clock, so a clock slightly
 * ahead of the chain cannot make it "from the future", but never before the milestone.
 */
export const pickIssuedAt = (now: bigint, previous: bigint) =>
  now - 60n > previous ? now - 60n : previous;

/** The EIP-712 typed data the named party signs (ARCHITECTURE §6). */
export function attestationTypedData(
  chainId: number,
  escrow: Address,
  message: {
    dealId: bigint;
    kind: AttestationKind;
    evidenceHash: Hex;
    issuedAt: bigint;
    nonce: bigint;
  },
) {
  return {
    domain: attestationDomain(chainId, escrow),
    types: attestationTypes,
    primaryType: "Attestation",
    message,
  } as const;
}

/** What a signer hands to whoever submits it (any wallet can; the signature carries the authority). */
export interface SignedAttestation {
  escrow: Address;
  dealId: bigint;
  kind: AttestationKind;
  evidenceHash: Hex;
  issuedAt: bigint;
  signature: Hex;
}

const bytes32 = z.string().refine((v) => isHex(v) && v.length === 66, "expected 32 bytes of hex");
const payloadSchema = z.object({
  escrow: z.string().refine((v) => isAddress(v), "expected an address"),
  dealId: z.string().regex(/^\d+$/),
  kind: z.union([z.literal(AttestationKind.ReadyInspected), z.literal(AttestationKind.Shipped)]),
  evidenceHash: bytes32,
  issuedAt: z.string().regex(/^\d+$/),
  signature: z.string().refine((v) => isHex(v) && v.length >= 132, "expected a signature"),
});

export function encodeAttestation(a: SignedAttestation): string {
  return JSON.stringify(
    {
      escrow: a.escrow,
      dealId: a.dealId.toString(),
      kind: a.kind,
      evidenceHash: a.evidenceHash,
      issuedAt: a.issuedAt.toString(),
      signature: a.signature,
    },
    null,
    2,
  );
}

/** Parses a pasted statement; undefined if it is not one. */
export function decodeAttestation(text: string): SignedAttestation | undefined {
  try {
    const p = payloadSchema.parse(JSON.parse(text));
    return {
      escrow: p.escrow,
      dealId: BigInt(p.dealId),
      kind: p.kind,
      evidenceHash: p.evidenceHash as Hex,
      issuedAt: BigInt(p.issuedAt),
      signature: p.signature as Hex,
    };
  } catch {
    return undefined;
  }
}
