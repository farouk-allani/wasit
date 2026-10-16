#!/usr/bin/env bash
# Phase 0 spike, read-only part. Every check is a plain read or an eth_call simulation:
# nothing is signed or broadcast. Run from contracts/:
#   SIM_FROM=<any testnet EOA holding > 0.001 BTC> ./script/spike/spike-readonly.sh
# SIM_FROM is only used as the `from` of simulated calls; no key is needed.
set -euo pipefail

RPC="${MEZO_TESTNET_RPC:-https://rpc.test.mezo.org}"
SIM_FROM="${SIM_FROM:?set SIM_FROM to a funded testnet address}"
BTC=0x7b7C000000000000000000000000000000000000
MUSD=0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503
SKIP=0x7b7c000000000000000000000000000000000015
PYTH=0x2880aB155794e7179c9eE2e38200202908C17B43
PYTH_BTC_USD=0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
ROUTER=0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9
FACTORY=0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A
POOL=0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9
ROUTE="[($BTC,$MUSD,false,$FACTORY)]"

section() { printf '\n== %s\n' "$1"; }
show() { printf '%-28s ' "$1"; shift; { "$@" 2>&1 || true; } | tr '\n' ' '; echo; }
create() { cast call --rpc-url "$RPC" --create "$1"; }

section "1. Chain"
show "chain id (expect 31611)" cast chain-id --rpc-url "$RPC"
show "client" cast client --rpc-url "$RPC"
show "latest block timestamp" cast block latest --field timestamp --rpc-url "$RPC"

section "2. BTC ERC-20 precompile"
show "symbol" cast call "$BTC" "symbol()(string)" --rpc-url "$RPC"
show "decimals" cast call "$BTC" "decimals()(uint8)" --rpc-url "$RPC"

section "3. EVM level (simulated contract creation; expect 0x.. results, last one errors)"
show "london control" create 0x60006000f3
show "PUSH0" create 0x5f5ff3
show "MCOPY (expect ..ab)" create 0x60ab6000526020600060205e60206020f3
show "TSTORE/TLOAD (expect ..2a)" create 0x602a60005d60005c60005260206000f3
show "CLZ, osaka (expect ..ff)" create 0x60011e60005260206000f3
show "INVALID (expect error)" create 0xfe
show "EvmProbe (solc, cancun)" create "$(forge inspect EvmProbe bytecode)"

section "4. Skip BTC/USD aggregator"
show "decimals" cast call "$SKIP" "decimals()(uint8)" --rpc-url "$RPC"
show "latestRoundData" cast call "$SKIP" "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url "$RPC"

section "5. Pyth BTC/USD"
show "getPriceUnsafe" cast call "$PYTH" "getPriceUnsafe(bytes32)((int64,uint64,int32,uint256))" "$PYTH_BTC_USD" --rpc-url "$RPC"
show "getPriceNoOlderThan(3600)" cast call "$PYTH" "getPriceNoOlderThan(bytes32,uint256)((int64,uint64,int32,uint256))" "$PYTH_BTC_USD" 3600 --rpc-url "$RPC"
echo "(0x19abf40e = StalePrice())"

section "6. Router quote, 0.0001 BTC -> MUSD"
show "getAmountsOut" cast call "$ROUTER" "getAmountsOut(uint256,(address,address,bool,address)[])(uint256[])" 100000000000000 "$ROUTE" --rpc-url "$RPC"

section "7. MUSD/BTC pool (token0 MUSD, token1 BTC)"
show "token0" cast call "$POOL" "token0()(address)" --rpc-url "$RPC"
show "token1" cast call "$POOL" "token1()(address)" --rpc-url "$RPC"
show "getReserves" cast call "$POOL" "getReserves()(uint256,uint256,uint256)" --rpc-url "$RPC"

section "2+8. BtcProbe: approve/transferFrom round trip + swap, 0.0002 BTC (simulated)"
args=$(cast abi-encode "f(address,address,address,address)" "$BTC" "$MUSD" "$ROUTER" "$FACTORY")
out=$(cast call --rpc-url "$RPC" --from "$SIM_FROM" --value 200000000000000 \
  --create "$(forge inspect BtcProbe bytecode)${args:2}" 2>&1 || true)
data=$(printf '%s' "$out" | grep -oE 'data: "0x[0-9a-fA-F]+' | sed 's/data: "//' || true)
if [ -n "$data" ]; then
  echo "r0 bal | r1 allow | r2 puller | r3 puller native | r4 allow after | r5 bal | r6 quote | r7 out | r8 musd | r9 btc"
  cast decode-error --sig "Results(uint256[10])" "$data"
else
  echo "$out"
fi
