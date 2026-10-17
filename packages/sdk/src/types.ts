import type { Address, ContractFunctionArgs, ContractFunctionReturnType } from "viem";
import type { advanceBondAbi, wasitEscrowAbi } from "./generated/abis.js";

/** Terms fixed at `createDeal` (ARCHITECTURE §3). */
export type DealTerms = ContractFunctionArgs<typeof wasitEscrowAbi, "nonpayable", "createDeal">[0];
/** A deal as returned by `WasitEscrow.getDeal`. */
export type Deal = ContractFunctionReturnType<typeof wasitEscrowAbi, "view", "getDeal">;
/** A bond as returned by `AdvanceBond.bondOf`. */
export type Bond = ContractFunctionReturnType<typeof advanceBondAbi, "view", "bondOf">;

/**
 * EIP-712 type an inspector (READY_INSPECTED) or carrier (SHIPPED) signs. Mirrors
 * `WasitEscrow.ATTESTATION_TYPEHASH`; the seed script checks the resulting digest against the
 * contract's `attestationDigest` before every submission.
 */
export const attestationTypes = {
  Attestation: [
    { name: "dealId", type: "uint256" },
    { name: "kind", type: "uint8" },
    { name: "evidenceHash", type: "bytes32" },
    { name: "issuedAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

/** EIP-712 domain of an escrow (`EIP712("Wasit", "1")`). */
export function attestationDomain(chainId: number, escrow: Address) {
  return { name: "Wasit", version: "1", chainId, verifyingContract: escrow } as const;
}
