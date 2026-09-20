#!/usr/bin/env bash
# Verify one contract at a time with pauses: Blockscout rate-limits a --verify sweep.
set -u
cd "$(dirname "$0")/.."
D=deployments/5042002.json
USDC=0x3600000000000000000000000000000000000000
V="--verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/ --chain 5042002"
addr() { jq -r ".$1" $D; }
try() { # name path ctor-args
  local n=$1 p=$2 args=$3 a; a=$(addr "$n")
  if [ "$(curl -s "https://explorer.testnet.arc.io/api/v2/smart-contracts/$a" | jq -r '.is_verified // false')" = "true" ]; then
    echo "$n already verified"; return
  fi
  echo "verifying $n ($a)"
  arc-forge verify-contract "$a" "$p" $V --constructor-args "$args" --watch 2>&1 | grep -E "successfully|Pass|Error" | head -2
}
for round in 1 2 3 4 5; do
  try AgenticCommerce src/core/AgenticCommerce.sol:AgenticCommerce \
    "$(cast abi-encode 'c(address,address,address)' $USDC "$ADMIN_ADDRESS" "$ADMIN_ADDRESS")"; sleep 45
  try AttestationLog src/governance/AttestationLog.sol:AttestationLog \
    "$(cast abi-encode 'c(address)' "$ADMIN_ADDRESS")"; sleep 45
  try ProcurementPolicy src/governance/ProcurementPolicy.sol:ProcurementPolicy \
    "$(cast abi-encode 'c(address,(uint16,uint16,uint16,uint16,uint16,uint128))' "$ADMIN_ADDRESS" '(10000,2,500,500,4000,100000000)')"; sleep 45
  try SealedRFQAdapter src/rfq/SealedRFQAdapter.sol:SealedRFQAdapter \
    "$(cast abi-encode 'c(address,address,address,address)' $USDC "$(addr AgenticCommerce)" "$(addr AttestationLog)" "$ADMIN_ADDRESS")"; sleep 45
  try RFQRegistry src/rfq/RFQRegistry.sol:RFQRegistry \
    "$(cast abi-encode 'c(address,address,address,address,address)' $USDC "$(addr ProcurementPolicy)" "$(addr AttestationLog)" "$(addr SealedRFQAdapter)" "$ADMIN_ADDRESS")"; sleep 45
  ALL=true
  for n in AgenticCommerce AttestationLog ProcurementPolicy SealedRFQAdapter RFQRegistry; do
    [ "$(curl -s "https://explorer.testnet.arc.io/api/v2/smart-contracts/$(addr $n)" | jq -r '.is_verified // false')" = "true" ] || ALL=false
  done
  [ "$ALL" = "true" ] && echo "ALL VERIFIED" && break
done
