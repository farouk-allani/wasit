#!/usr/bin/env bash
# Live integration probe for MezoRouterAdapter (ADR-015). Read-only: simulates SwapProbe's creation
# with eth_call on Mezo testnet, spending SIM_FROM's BTC only inside the simulation; nothing is
# signed or broadcast. Run from contracts/:
#   SIM_FROM=<any testnet address holding > 0.001 BTC> ./script/probes/probe-swap.sh
set -euo pipefail

RPC="${MEZO_TESTNET_RPC:-https://rpc.test.mezo.org}"
SIM_FROM="${SIM_FROM:?set SIM_FROM to a funded testnet address}"
ROUTER=0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9
FACTORY=0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A
BTC=0x7b7C000000000000000000000000000000000000
MUSD=0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503
AMOUNT=100000000000000 # 0.0001 BTC

[ "$(cast chain-id --rpc-url "$RPC")" = "31611" ] || { echo "not Mezo testnet" >&2; exit 1; }
args=$(cast abi-encode "f(address,address,address,address)" "$ROUTER" "$FACTORY" "$BTC" "$MUSD")
out=$(cast call --rpc-url "$RPC" --from "$SIM_FROM" --value "$AMOUNT" \
  --create "$(forge inspect SwapProbe bytecode)${args:2}" 2>&1 || true)
data=$(printf '%s' "$out" | grep -oE 'data: "0x[0-9a-fA-F]+' | sed 's/data: "//' || true)
[ -n "$data" ] || { echo "$out"; exit 1; }

echo "quoted | received | musdBalance | btcLeft | routerAllowanceLeft"
cast decode-error --sig "Results(uint256,uint256,uint256,uint256,uint256)" "$data"
