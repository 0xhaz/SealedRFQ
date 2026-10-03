#!/usr/bin/env bash
# Verify the Arc mainnet contracts, when the explorer's API is reachable at all.
#
# It usually is not: explorer.arc.io sits behind a Cloudflare challenge that only a real browser
# solves, so both the Blockscout API and `forge verify-contract` get a 403 from a terminal. Forge
# reports that as "Failed to obtain contract ABI", which reads like a build failure and sends you
# looking at the compiler — so this checks the API first and says plainly which it is.
#
# Blocked? Use contracts/verification/5042/README.md and the explorer's own Verify & publish form.
set -u
cd "$(dirname "$0")/.."
D=deployments/5042.json
EXPLORER=https://explorer.arc.io
USDC=0x3600000000000000000000000000000000000000
ADMIN=$(jq -r .admin $D)
addr() { jq -r ".$1" $D; }

probe=$(curl -s -o /dev/null -w "%{http_code}" "$EXPLORER/api/v2/smart-contracts/$(addr RFQRegistry)")
if [ "$probe" != "200" ]; then
  echo "explorer API returned HTTP $probe — not a build problem."
  [ "$probe" = "403" ] && echo "Cloudflare is challenging non-browser clients; verify through the browser form instead:"
  echo "  contracts/verification/5042/README.md"
  exit 1
fi

V="--verifier blockscout --verifier-url $EXPLORER/api/ --chain 5042"
try() { # name path ctor-args
  local n=$1 p=$2 args=$3 a; a=$(addr "$n")
  if [ "$(curl -s "$EXPLORER/api/v2/smart-contracts/$a" | jq -r '.is_verified // false')" = "true" ]; then
    echo "$n already verified"; return
  fi
  echo "verifying $n ($a)"
  arc-forge verify-contract "$a" "$p" $V --constructor-args "$args" --watch 2>&1 | grep -E "successfully|Pass|Error" | head -2
}

# Biggest first: whatever goes last inherits the quota the earlier ones spent.
for round in 1 2 3 4 5; do
  try SealedRFQAdapter src/rfq/SealedRFQAdapter.sol:SealedRFQAdapter \
    "$(cast abi-encode 'c(address,address,address,address)' $USDC "$(addr AgenticCommerce)" "$(addr AttestationLog)" "$ADMIN")"; sleep 45
  try RFQRegistry src/rfq/RFQRegistry.sol:RFQRegistry \
    "$(cast abi-encode 'c(address,address,address,address,address)' $USDC "$(addr ProcurementPolicy)" "$(addr AttestationLog)" "$(addr SealedRFQAdapter)" "$ADMIN")"; sleep 45
  try AgenticCommerce src/core/AgenticCommerce.sol:AgenticCommerce \
    "$(cast abi-encode 'c(address,address,address)' $USDC "$ADMIN" "$ADMIN")"; sleep 45
  # Seven fields, not the testnet six: concentrationFloor was added before this deployment.
  try ProcurementPolicy src/governance/ProcurementPolicy.sol:ProcurementPolicy \
    "$(cast abi-encode 'c(address,(uint16,uint16,uint16,uint16,uint16,uint128,uint128))' "$ADMIN" '(10000,2,500,500,6000,250000000000,100000000)')"; sleep 45
  try AttestationLog src/governance/AttestationLog.sol:AttestationLog \
    "$(cast abi-encode 'c(address)' "$ADMIN")"; sleep 45
  ALL=true
  for n in AgenticCommerce AttestationLog ProcurementPolicy SealedRFQAdapter RFQRegistry; do
    [ "$(curl -s "$EXPLORER/api/v2/smart-contracts/$(addr $n)" | jq -r '.is_verified // false')" = "true" ] || ALL=false
  done
  [ "$ALL" = "true" ] && echo "ALL VERIFIED" && break
done
