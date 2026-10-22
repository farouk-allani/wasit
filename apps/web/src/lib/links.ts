import { mezoTestnet } from "viem/chains";
import type { Address, Hash } from "viem";

export const REPO_URL = "https://github.com/farouk-allani/wasit";

const explorer = mezoTestnet.blockExplorers.default.url;

/** Mezo testnet explorer (Blockscout) pages, from the chain definition, never hand-copied. */
export const explorerAddress = (address: Address) => `${explorer}/address/${address}`;
export const explorerTx = (hash: Hash) => `${explorer}/tx/${hash}`;
