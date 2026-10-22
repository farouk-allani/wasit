import { permitTokenAbi } from "@wasit/sdk";
import { parseSignature, type Address, type Hex, type PublicClient, type WalletClient } from "viem";

/** EIP-2612 `Permit` type. */
export const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface PermitDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

/** Typed data a token holder signs to let `spender` take `value` until `deadline`. */
export function permitTypedData(
  domain: PermitDomain,
  message: { owner: Address; spender: Address; value: bigint; nonce: bigint; deadline: bigint },
) {
  return { domain, types: permitTypes, primaryType: "Permit", message } as const;
}

const eip712DomainAbi = [
  {
    type: "function",
    name: "eip712Domain",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ],
  },
] as const;

/**
 * Asks the wallet for an EIP-2612 permit signature. The domain comes from the token itself
 * (EIP-5267; MUSD answers "Mezo USD", version "1", VERIFIED-FACTS), so it cannot drift.
 */
export async function signPermit({
  client,
  wallet,
  token,
  owner,
  spender,
  value,
  validForSeconds = 1_800,
}: {
  client: Pick<PublicClient, "readContract">;
  wallet: WalletClient;
  token: Address;
  owner: Address;
  spender: Address;
  value: bigint;
  validForSeconds?: number;
}): Promise<{ deadline: bigint; v: number; r: Hex; s: Hex }> {
  const [[, name, version, chainId, verifyingContract], nonce] = await Promise.all([
    client.readContract({ address: token, abi: eip712DomainAbi, functionName: "eip712Domain" }),
    client.readContract({
      address: token,
      abi: permitTokenAbi,
      functionName: "nonces",
      args: [owner],
    }),
  ]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + validForSeconds);
  const signature = await wallet.signTypedData({
    account: owner,
    ...permitTypedData(
      { name, version, chainId: Number(chainId), verifyingContract },
      { owner, spender, value, nonce, deadline },
    ),
  });
  const { v, yParity, r, s } = parseSignature(signature);
  return { deadline, v: Number(v ?? BigInt(yParity + 27)), r, s };
}
