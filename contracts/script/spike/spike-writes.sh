#!/usr/bin/env bash
# Phase 0 spike, write part: a few real Mezo testnet transactions (about 0.0002 BTC plus gas).
# Needs Farouk's approval before running. Uses cast, not forge script: forge simulates on a local
# fork first, and a local fork cannot execute Mezo's BTC precompile. Run from contracts/:
#   export MEZO_TESTNET_RPC=https://rpc.test.mezo.org
#   ./script/spike/spike-writes.sh --account deployer          # Foundry keystore
#   ./script/spike/spike-writes.sh --private-key "$DEPLOYER_PRIVATE_KEY"
set -euo pipefail

[ $# -ge 1 ] || { sed -n '2,7p' "$0"; exit 2; }
RPC="${MEZO_TESTNET_RPC:?set MEZO_TESTNET_RPC}"
chain=$(cast chain-id --rpc-url "$RPC")
[ "$chain" = "31611" ] || { echo "refusing to run on chain $chain (Mezo testnet is 31611)" >&2; exit 1; }

SIGNER=("$@")
BTC=0x7b7C000000000000000000000000000000000000
MUSD=0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503
ROUTER=0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9
FACTORY=0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A
ROUTE="[($BTC,$MUSD,false,$FACTORY)]"
AMOUNT=100000000000000 # 0.0001 BTC
ME=$(cast wallet address "${SIGNER[@]}")
echo "signer $ME · native balance $(cast from-wei "$(cast balance "$ME" --rpc-url "$RPC")") BTC"

LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT
# send <label> <cast send args...>: records the tx hash in $LOG, prints the created address (if any)
send() {
  local label="$1"; shift
  local out hash status created
  out=$(cast send --rpc-url "$RPC" "${SIGNER[@]}" "$@")
  hash=$(printf '%s\n' "$out" | awk '$1 == "transactionHash" {print $2}')
  status=$(printf '%s\n' "$out" | awk '$1 == "status" {print $2}')
  created=$(printf '%s\n' "$out" | awk '$1 == "contractAddress" {print $2}')
  echo "${label} | ${hash} | status ${status}${created:+ | created ${created}}" >> "$LOG"
  echo "$label: $hash (status $status)${created:+ created $created}" >&2
  [ "$status" = "1" ] || { echo "$label failed" >&2; exit 1; }
  printf '%s' "$created"
}

# 3. EVM level: real deployment of the cancun probe
probe=$(send "EvmProbe deploy" --create "$(forge inspect EvmProbe bytecode)")
echo "EvmProbe.echoed() = $(cast call "$probe" "echoed()(uint256)" --rpc-url "$RPC") (expect 42)"

# 2. BTC precompile: approve + transferFrom through a contract, then transfer back
puller=$(send "BtcPuller deploy" --create "$(forge inspect BtcPuller bytecode)")
send "BTC approve(puller)" "$BTC" "approve(address,uint256)" "$puller" "$AMOUNT" >/dev/null
send "BtcPuller.pull (transferFrom)" "$puller" "pull(address,address,uint256)" "$BTC" "$ME" "$AMOUNT" >/dev/null
echo "puller BTC balance = $(cast call "$BTC" "balanceOf(address)(uint256)" "$puller" --rpc-url "$RPC") (expect $AMOUNT)"
send "BtcPuller.push (transfer back)" "$puller" "push(address,address,uint256)" "$BTC" "$ME" "$AMOUNT" >/dev/null

# 6 + 8. Tiny swap BTC -> MUSD (also the MUSD acquisition path for test wallets)
quote=$(cast call "$ROUTER" "getAmountsOut(uint256,(address,address,bool,address)[])(uint256[])" "$AMOUNT" "$ROUTE" \
  --rpc-url "$RPC" | tr -d '[]' | awk -F', ' '{print $2}' | awk '{print $1}')
# 1% below the quote; awk floats are fine here (a few wei of rounding inside a 1% margin)
min_out=$(awk -v q="$quote" 'BEGIN { printf "%.0f", q * 0.99 }')
deadline=$(( $(cast block latest --field timestamp --rpc-url "$RPC") + 600 ))
musd_before=$(cast call "$MUSD" "balanceOf(address)(uint256)" "$ME" --rpc-url "$RPC" | awk '{print $1}')
send "BTC approve(router)" "$BTC" "approve(address,uint256)" "$ROUTER" "$AMOUNT" >/dev/null
send "Router swap 0.0001 BTC->MUSD" "$ROUTER" \
  "swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)" \
  "$AMOUNT" "$min_out" "$ROUTE" "$ME" "$deadline" >/dev/null
musd_after=$(cast call "$MUSD" "balanceOf(address)(uint256)" "$ME" --rpc-url "$RPC" | awk '{print $1}')
echo "quoted $quote · min $min_out · MUSD balance $musd_before -> $musd_after (wei)"

printf '\n== Evidence (paste into docs-dev/EVIDENCE.md)\n'
cat "$LOG"
