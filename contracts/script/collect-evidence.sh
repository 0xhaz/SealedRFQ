#!/usr/bin/env bash
# Builds the evidence pack for a demo run: one explorer link per lifecycle step.
#
#   ./script/collect-evidence.sh 5042002 https://explorer.testnet.arc.io
#   ./script/collect-evidence.sh 5042 https://explorer.arc.io
#
# Reads forge broadcast files + the firewall receipt, writes deployments/evidence-<chainId>.json.
# Nothing is hand-typed: every hash comes from a broadcast record or an on-chain receipt.
set -euo pipefail
cd "$(dirname "$0")/.."
CHAIN=${1:-5042002}
EXPLORER=${2:-https://explorer.testnet.arc.io}
DIR=broadcast/DemoLifecycle.s.sol/$CHAIN
OUT=deployments/evidence-$CHAIN.json

[ -d "$DIR" ] || { echo "no broadcast records in $DIR" >&2; exit 1; }

# function name -> human step label
label() {
  case "$1" in
    createRFQWithPermit*) echo "RFQ created and funded (buyer, ERC-2612 permit)" ;;
    createRFQ*) echo "RFQ created and funded (buyer)" ;;
    commitBidWithPermit*|commitBid*) echo "sealed bid committed + deposit (supplier)" ;;
    revealBid*) echo "sealed bid revealed (supplier)" ;;
    attest*) echo "AI decision anchored (EVALUATOR)" ;;
    award*) echo "award (AWARDER, policy-checked)" ;;
    settleDeposit*) echo "losing deposit refunded (permissionless)" ;;
    submit*) echo "milestone deliverable submitted (supplier, ERC-8183)" ;;
    acceptMilestone*) echo "milestone accepted and paid (buyer)" ;;
    autoRelease*) echo "milestone auto-released after buyer silence (anyone)" ;;
    withdraw*) echo "pull payment withdrawn" ;;
    *) echo "$1" ;;
  esac
}

{
  echo "{"
  echo "  \"chainId\": $CHAIN,"
  echo "  \"explorer\": \"$EXPLORER\","
  echo "  \"contracts\": $(cat "deployments/$CHAIN.json"),"
  echo "  \"steps\": ["
  first=1
  # Only this run: broadcast/ keeps every past run, including ones against older deployments.
  # demo.sh stamps startedAt (seconds); broadcast filenames are run-<epoch millis>.json.
  START_MS=$(( $(jq -r '.startedAt // 0' "deployments/demo-$CHAIN.json") * 1000 ))
  for f in $(ls "$DIR"/run-[0-9]*.json | sort); do
    ts=$(basename "$f" .json); ts=${ts#run-}
    [ "$ts" -lt "$START_MS" ] && continue
    n=$(jq '.transactions | length' "$f")
    for i in $(seq 0 $((n - 1))); do
      fn=$(jq -r ".transactions[$i].function // \"deploy\"" "$f")
      hash=$(jq -r ".transactions[$i].hash" "$f")
      status=$(jq -r ".receipts[$i].status // \"0x1\"" "$f")
      [ $first -eq 1 ] || echo ","
      first=0
      printf '    {"step": "%s", "status": "%s", "tx": "%s", "url": "%s/tx/%s"}' \
        "$(label "$fn")" "$status" "$hash" "$EXPLORER" "$hash"
    done
  done
  FW=deployments/demo-$CHAIN-firewall.json
  if [ -f "$FW" ]; then
    h=$(jq -r .transactionHash "$FW")
    [ $first -eq 1 ] || echo ","
    printf '    {"step": "POLICY FIREWALL: over-budget award rejected by the contract", "status": "%s", "tx": "%s", "url": "%s/tx/%s"}' \
      "$(jq -r .status "$FW")" "$h" "$EXPLORER" "$h"
  fi
  echo ""
  echo "  ]"
  echo "}"
} | jq . > "$OUT"

echo "wrote $OUT ($(jq '.steps | length' "$OUT") steps)"
jq -r '.steps[] | "  \(if .status == "0x0" then "REVERTED" else "ok      " end) \(.step)"' "$OUT"
