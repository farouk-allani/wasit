#!/usr/bin/env bash
# Verifies, on the Mezo testnet explorer (Blockscout), every contract a forge script broadcast.
# Constructor args are the tail of each creation tx's input after the bytecode this checkout
# compiles, so the script also fails if the deployed code differs from the source. Run from contracts/:
#   ./script/verify.sh Deploy.s.sol
#   ./script/verify.sh DeployDemoSim.s.sol
# Not --guess-constructor-args: it fails here with "Transaction not found". --skip-is-verified-check:
# a contract whose bytecode matches an already verified one is only shown as its unverified "twin".
set -euo pipefail

[ $# -eq 1 ] || { sed -n '2,8p' "$0"; exit 2; }
RUN="broadcast/$1/31611/run-latest.json"
VERIFIER_URL=https://api.explorer.test.mezo.org/api/

node -e '
  const run = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  for (const t of run.transactions)
    if (t.transactionType === "CREATE") console.log(t.contractName, t.contractAddress, t.transaction.input);
' "$RUN" | while read -r name addr input; do
  code=$(forge inspect "$name" bytecode | tr 'A-F' 'a-f')
  input=$(printf '%s' "$input" | tr 'A-F' 'a-f')
  [ "${input#"$code"}" != "$input" ] || { echo "$name $addr: deployed code differs from this checkout" >&2; exit 1; }
  result=$(forge verify-contract "$addr" "$name" --chain 31611 --verifier blockscout --verifier-url "$VERIFIER_URL" \
    --constructor-args "0x${input#"$code"}" --skip-is-verified-check --watch 2>&1 |
    grep -E 'Pass|Fail|Error|already verified' | tail -1 || true)
  echo "$name $addr: ${result:-no answer}"
done
