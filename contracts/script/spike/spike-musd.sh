#!/usr/bin/env bash
# Phase 8 spike: the live MUSD borrowing system on Mezo testnet (Liquity/Threshold-USD fork).
# Every check is a plain read; nothing is signed or broadcast. Run from contracts/:
#   ./script/spike/spike-musd.sh
#
# How these addresses were found (the docs do not publish them, and the explorer's name search
# returns many abandoned redeployments wired to other MUSD tokens):
#   1. eth_getLogs for MUSD Transfer events with from == address(0) (mints) over recent blocks.
#   2. For each minting transaction, take its `to` and test MUSD.mintList(to).
#   3. The one that answers true is the live BorrowerOperations proxy; every other system
#      address is then read from it, and musd() is checked back against the official token.
# If the deployment is ever replaced, repeat steps 1-2 to rediscover it.
set -euo pipefail

RPC="${MEZO_TESTNET_RPC:-https://rpc.test.mezo.org}"
MUSD=0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503
BORROWER_OPERATIONS=0xcdf7028ceab81fa0c6971208e83fa7872994bee5
PRICE_FEED=0x86bCF0841622a5dAC14A313a15f96A95421b9366
TROVE_MANAGER=0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0
INTEREST_RATE_MANAGER=0xD4D6c36A592A2c5e86035A6bca1d57747a567f37
SKIP=0x7b7c000000000000000000000000000000000015

section() { printf '\n== %s\n' "$1"; }
show() { printf '%-34s ' "$1"; shift; { "$@" 2>&1 || true; } | head -1; }
bo() { show "$1" cast call "$BORROWER_OPERATIONS" "$2" --rpc-url "$RPC"; }

section "1. Chain"
show "chain id (expect 31611)" cast chain-id --rpc-url "$RPC"
show "latest block timestamp" cast block latest --field timestamp --rpc-url "$RPC"

section "2. BorrowerOperations is live (mintList proves it may mint MUSD)"
show "MUSD.mintList(borrowerOps)" cast call "$MUSD" "mintList(address)(bool)" "$BORROWER_OPERATIONS" --rpc-url "$RPC"
bo "musd() (expect official MUSD)" "musd()(address)"

section "3. System addresses, read from BorrowerOperations"
for f in troveManager priceFeed stabilityPoolAddress sortedTroves interestRateManager \
  activePool collSurplusPool gasPoolAddress pcv governableVariables \
  borrowerOperationsSignaturesAddress; do
  bo "$f" "$f()(address)"
done

section "4. Borrowing parameters"
for f in MCR CCR minNetDebt MIN_NET_DEBT_MIN MUSD_GAS_COMPENSATION borrowingRate redemptionRate; do
  bo "$f" "$f()(uint256)"
done
bo "refinancingFeePercentage" "refinancingFeePercentage()(uint8)"
show "interestRate (bps)" cast call "$INTEREST_RATE_MANAGER" "interestRate()(uint16)" --rpc-url "$RPC"
show "governance MIN_DELAY (s)" cast call "$INTEREST_RATE_MANAGER" "MIN_DELAY()(uint256)" --rpc-url "$RPC"

section "5. MUSD PriceFeed (60 s staleness bound; wraps the same Skip aggregator Wasit reads)"
show "fetchPrice (1e18 USD)" cast call "$PRICE_FEED" "fetchPrice()(uint256)" --rpc-url "$RPC"
show "TARGET_DIGITS" cast call "$PRICE_FEED" "TARGET_DIGITS()(uint8)" --rpc-url "$RPC"
show "oracle (expect Skip)" cast call "$PRICE_FEED" "oracle()(address)" --rpc-url "$RPC"
show "Skip latestRoundData" cast call "$SKIP" "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url "$RPC"

section "6. System size"
bo "getEntireSystemColl (BTC)" "getEntireSystemColl()(uint256)"
bo "getEntireSystemDebt (MUSD)" "getEntireSystemDebt()(uint256)"
show "open troves" cast call "$TROVE_MANAGER" "getTroveOwnersCount()(uint256)" --rpc-url "$RPC"
