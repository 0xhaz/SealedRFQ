#!/usr/bin/env bash
# Would the policy you are about to deploy admit a realistic first tender?
#
# A first award is always 100% concentrated, so the concentration cap refuses it whenever the award
# reaches `concentrationFloor`. That makes the floor a ceiling on first purchases as well as an
# abuse budget — see workplan §6n. Getting it wrong is permanent once ADMIN_ROLE is renounced, and
# the symptom is every real buyer's first award reverting.
#
#   ./script/preflight-policy.sh 100000     # the largest first tender you want to admit, in USDC
set -euo pipefail
cd "$(dirname "$0")/.."

LARGEST=${1:-100000}
# These defaults MUST match Deploy.s.sol's, not the recommended values — the script has to model
# what will actually deploy. It briefly used the recommendations instead, so an unset environment
# reported "ok" while the deploy would have used 4000/100 and bricked every first award.
SHARE=${POLICY_MAX_SUPPLIER_SHARE_BPS:-4000}
FLOOR_UNITS=${POLICY_CONCENTRATION_FLOOR:-100000000}

if [ -z "${POLICY_MAX_SUPPLIER_SHARE_BPS:-}" ] || [ -z "${POLICY_CONCENTRATION_FLOOR:-}" ]; then
  echo "note: policy variables are unset, so Deploy.s.sol would use its own defaults."
  echo "      Those are the testnet values and they fail the checks below."
  echo
fi
FLOOR=$((FLOOR_UNITS / 1000000))

echo "policy about to be deployed"
echo "  max supplier share   ${SHARE} bps ($((SHARE / 100))%)"
echo "  concentration floor  \$${FLOOR}"
echo

fail=0
if [ "$SHARE" -le 5000 ]; then
  echo "FAIL  share cap is ${SHARE} bps. At or below 50% a buyer who gives one supplier half"
  echo "      their work is blocked — ordinary preferred-supplier behaviour, not abuse."
  fail=1
fi
if [ "$LARGEST" -ge "$FLOOR" ]; then
  echo "FAIL  a first award of \$${LARGEST} reaches the \$${FLOOR} floor, so it is 100%"
  echo "      concentrated and will revert with ConcentrationCapExceeded."
  echo "      Raise POLICY_CONCENTRATION_FLOOR above \$${LARGEST}, in 6-decimal units."
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "ok    a first award of up to \$${LARGEST} passes, and the cap still catches funnelling"
  echo "      once a buyer's cumulative awards reach \$${FLOOR}."
else
  echo
  echo "Refusing to call this ready. These values freeze when ADMIN_ROLE is renounced."
  exit 1
fi
