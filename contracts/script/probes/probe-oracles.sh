#!/usr/bin/env bash
# Live integration probe for the oracle adapters (ADR-015). Read-only: simulates OracleProbe's
# creation with eth_call on Mezo testnet; nothing is signed or broadcast. Run from contracts/.
set -euo pipefail

RPC="${MEZO_TESTNET_RPC:-https://rpc.test.mezo.org}"
SKIP=0x7b7c000000000000000000000000000000000015
PYTH=0x2880aB155794e7179c9eE2e38200202908C17B43
PYTH_BTC_USD=0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43

[ "$(cast chain-id --rpc-url "$RPC")" = "31611" ] || { echo "not Mezo testnet" >&2; exit 1; }
args=$(cast abi-encode "f(address,address,bytes32)" "$SKIP" "$PYTH" "$PYTH_BTC_USD")
out=$(cast call --rpc-url "$RPC" --create "$(forge inspect OracleProbe bytecode)${args:2}" 2>&1 || true)
data=$(printf '%s' "$out" | grep -oE 'data: "0x[0-9a-fA-F]+' | sed 's/data: "//' || true)
[ -n "$data" ] || { echo "$out"; exit 1; }

echo "skipPrice | skipUpdatedAt | blockTimestamp | pythResult (0x19abf40e = StalePrice)"
cast decode-error --sig "Results(uint256,uint256,uint256,bytes)" "$data"
