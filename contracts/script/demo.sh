#!/usr/bin/env bash
# Runs the demo RFQ end to end on a live Arc network, one real transaction per lifecycle step.
#
#   ./script/demo.sh testnet            # uses ../.env.testnet
#   ./script/demo.sh mainnet            # uses ../.env.mainnet
#   RPC_URL=http://127.0.0.1:8545 ./script/demo.sh local   # arc-anvil fork (uses ../.env.testnet keys)
#
# Waits are on chain time (block.timestamp), never wall-clock. Tx hashes land in
# broadcast/DemoLifecycle.s.sol/<chainId>/ and deployments/demo-<chainId>-firewall.json.
set -euo pipefail

NET=${1:-testnet}
cd "$(dirname "$0")/.."
# local runs on anvil dev keys written by tools/local.sh, not the testnet keys
ENV_FILE=../.env.${NET}
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

case "$NET" in
  mainnet) RPC_URL=${RPC_URL:-$ARC_MAINNET_RPC_URL} ;;
  testnet) RPC_URL=${RPC_URL:-$ARC_TESTNET_RPC_URL} ;;
  local) RPC_URL=${RPC_URL:-http://127.0.0.1:8545} ;;
esac
FORGE=${FORGE:-arc-forge}
CAST=${CAST:-cast}
CHAIN=$($CAST chain-id --rpc-url "$RPC_URL")
DEPLOY=deployments/$CHAIN.json
STATE=deployments/demo-$CHAIN.json
REGISTRY=$(jq -r .RFQRegistry "$DEPLOY")
ADAPTER=$(jq -r .SealedRFQAdapter "$DEPLOY")
ADMIN=$($CAST wallet address --private-key "$ADMIN_PK")

LOG=${LOG:-/tmp/sealedrfq-demo.log}

# Runs one stage. A stage that does not reach "ONCHAIN EXECUTION COMPLETE" is fatal: silently
# skipping a failed stage is how a demo ends up half-run.
stage() {
  echo "── $1"
  if ! STAGE=$1 $FORGE script script/DemoLifecycle.s.sol --rpc-url "$RPC_URL" --broadcast --slow \
      >"$LOG" 2>&1; then
    echo "   STAGE $1 FAILED:"; grep -E "Error|revert|panic|\[Revert\]" "$LOG" | head -5; exit 1
  fi
  grep -E "^\s{2}[A-Za-z]" "$LOG" || true
}

chain_now() { $CAST block latest -f timestamp --rpc-url "$RPC_URL"; }

# A local chain has no reason to make anyone wait: push its clock instead of sleeping.
local_warp() {
  [ "$NET" = "local" ] || return 1
  $CAST rpc evm_increaseTime "${1:-60}" --rpc-url "$RPC_URL" >/dev/null 2>&1 || return 1
  $CAST rpc evm_mine --rpc-url "$RPC_URL" >/dev/null 2>&1
  echo "   (local) chain clock +${1:-60}s"
}

# Poll until `cast call` of the given signature/args succeeds (i.e. the action is allowed on-chain).
wait_until_callable() {
  local sig=$1 target=$2
  shift 2
  until $CAST call "$target" "$sig" "$@" --from "$ADMIN" --rpc-url "$RPC_URL" >/dev/null 2>&1; do
    local_warp 120 && continue
    echo "   … waiting for chain time (now $(chain_now))"
    sleep 5
  done
}

wait_for_phase() {
  local want=$1 now
  until [ "$($CAST call "$REGISTRY" "phase(uint256)(uint8)" "$RFQ" --rpc-url "$RPC_URL")" = "$want" ]; do
    now=$($CAST call "$REGISTRY" "phase(uint256)(uint8)" "$RFQ" --rpc-url "$RPC_URL")
    if [ "$now" -gt "$want" ]; then echo "   phase $now already past $want - window missed"; exit 1; fi
    local_warp 70 && continue
    echo "   … waiting for phase $want (chain time $(chain_now))"
    sleep 5
  done
}

stage open
RFQ=$(jq -r .rfqId "$STATE")
echo "   rfqId=$RFQ"

wait_for_phase 2 # Reveal
stage reveal

wait_for_phase 3 # Award
stage recommend

echo "── firewall: AWARDER awards the over-budget recommendation (must revert on-chain)"
FW_WINNER=$(jq -r .firewallWinner "$STATE")
FW_MEMO=$(jq -r .firewallMemoHash "$STATE")
RUBRIC=$(jq -r .rubricHash "$STATE")
FW_JSON=$($CAST send "$REGISTRY" "award(uint256,address,bytes32,bytes32)" "$RFQ" "$FW_WINNER" "$FW_MEMO" "$RUBRIC" \
  --private-key "$AWARDER_PK" --rpc-url "$RPC_URL" --gas-limit 700000 --json 2>/dev/null || true)
echo "$FW_JSON" | jq '{transactionHash, status}' | tee "deployments/demo-$CHAIN-firewall.json"

stage award

stage submit
stage accept # milestone 1: buyer accepts

stage submit # milestone 2: buyer stays silent
wait_until_callable "autoRelease(uint256)" "$ADAPTER" "$RFQ"
stage autorelease

stage submit # milestone 3
stage accept
stage withdraw
stage status
echo "done. Transactions: broadcast/DemoLifecycle.s.sol/$CHAIN/  firewall: deployments/demo-$CHAIN-firewall.json"
