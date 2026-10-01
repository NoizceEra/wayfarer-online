#!/usr/bin/env bash
# server/econ/econ-curltest.sh — end-to-end walkthrough of the /econ/* surface against a
# REAL booted relay, over HTTP, with a freshly minted device token.
#
# It shows, with the real response bodies:
#   1. GET  /econ/rates      (public rate sheet + emission budget remaining)
#   2. POST /econ/balance    (fresh device: empty)
#   3. linking a real Ed25519 wallet so the claim has a SERVER-RESOLVED destination:
#        /identity/wallet-challenge + /identity/link   (signature, base64)
#        /wallet/challenge          + /wallet/link     (signature, base58)
#   4. POST /econ/claim      (default path = DRY RUN: nothing is signed; the destination
#                             comes from the verified link, never from the body)
#      + a retry with the SAME claimId
#   5. POST /econ/stake      (locks the tier minimum)
#   6. a restart proving DURABILITY (the stake is re-read from DATA_DIR), with the lock
#      aged 30 days, then POST /econ/unstake  (principal + emission, after the lock is aged)
#   7. POST /econ/history    (the ledger journal)
#
# NOTES
#   * PAYOUTS_ENABLED is deliberately unset, so every claim dry-runs and nothing is signed.
#   * CHAIN_RPC_URLS points at an address that cannot resolve. A dry run makes NO RPC call, so
#     the claim succeeding is itself proof that nothing left the process. The mint is the real
#     devnet WAYFARER mint (server/economy/CONTRACT.md); it is only ever used by a real send,
#     which this walkthrough never performs.
#   * Node needs NATIVE paths, so $WF_E2E_DIR must be native (D:/...), not an MSYS /tmp path.
#   * Every step asserts the shape it promises and aborts loudly otherwise.
#
# Usage:  bash server/econ/econ-curltest.sh        (env: WF_E2E_PORT, WF_E2E_DIR, WF_E2E_MINT)

set -u
PORT="${WF_E2E_PORT:-2611}"
WORK="${WF_E2E_DIR:-D:/tmp/wf-econ-e2e}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -W)"        # pwd -W: NATIVE path, for node
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -W)"
DATA="$WORK/data"
KEY="$WORK/wallet.pem"
BASE="http://localhost:$PORT"
MINT="${WF_E2E_MINT:-8q4tDsGTD1J2xNzpm4YVCY1QEpXGwMDhE3BkCdCd5xWg}"   # devnet WAYFARER mint
RPC="${WF_E2E_RPC:-https://rpc-never-contacted.invalid}"             # never contacted (dry run)

export DATA_DIR="$DATA" LOG_LEVEL="${LOG_LEVEL:-info}"

mkdir -p "$WORK"
rm -rf "$DATA"
echo "== workdir $WORK  (relay port $PORT, DATA_DIR $DATA)"
rm -f "$KEY" "$WORK"/challenge-*.json "$WORK"/body-*.json

pp() { node -e 'let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.stringify(JSON.parse(s),null,2))}catch(e){console.log(s)}})'; }
api() { local m=$1 p=$2 b="${3:-}"; if [ -n "$b" ]; then curl -s -X "$m" "$BASE$p" -H 'content-type: application/json' -d "$b"; else curl -s -X "$m" "$BASE$p"; fi; }
# print a response and refuse to continue if it is not the shape this step promises
step_json() { # step_json <label> <grep-needle> <json>
  echo "--- $1:"; printf '%s' "$3" | pp
  if ! printf '%s' "$3" | grep -q "$2"; then echo "!!! STEP FAILED: expected '$2' in the response above"; stop; exit 1; fi
}

busy() { [ "$(curl -s -o /dev/null -w '%{http_code}' -m 2 "$BASE/health")" = "200" ]; }
boot() {
  if busy; then echo "!!! something already answers on $BASE — refusing to attach to a foreign relay"; exit 1; fi
  PORT="$PORT" DATA_DIR="$DATA" ECON_ENABLED=true WAYFARER_MINT="$MINT" CHAIN_RPC_URLS="$RPC" \
    LOG_LEVEL="${LOG_LEVEL:-info}" node "$ROOT/server/index.js" >"$WORK/relay-$1.log" 2>&1 &
  echo $! > "$WORK/relay.pid"
  for _ in $(seq 1 60); do
    if busy; then echo "   relay up (pid $(cat "$WORK/relay.pid")): $(curl -s "$BASE/health")"; return 0; fi
    sleep 0.5
  done
  echo "   RELAY FAILED TO BOOT — tail of $WORK/relay-$1.log:"; tail -20 "$WORK/relay-$1.log"; exit 1
}
stop() {
  if [ -f "$WORK/relay.pid" ]; then
    kill "$(cat "$WORK/relay.pid")" 2>/dev/null || true
    for _ in $(seq 1 40); do busy || { sleep 0.3; return 0; }; sleep 0.25; done
    echo "!!! relay $(cat "$WORK/relay.pid") is still answering on $BASE"; exit 1
  fi
}

step() { echo; echo "──────── $* ────────"; }

# ── boot ────────────────────────────────────────────────────────────────────
step "0. mint a device token and fund it — BEFORE the relay starts"
echo "(server/economy/ledger.js caches a player doc on first read, so a fixture written behind a"
echo " live relay's back is invisible to it: seed first, then boot.)"
TOKEN="$(node -e 'console.log(require("crypto").randomBytes(18).toString("base64url"))')"
echo "--- freshly minted 24-char device token: $TOKEN"
step_json "seed-dev.mjs admin credit of 2,000 WAYFARER" '"creditedWhole"' \
  "$(ECON_SEED_ACK=yes DATA_DIR="$DATA" node "$SCRIPT_DIR/seed-dev.mjs" "$TOKEN" 2000 "e2e walkthrough fixture")"

step "0b. boot the relay on :$PORT (ECON_ENABLED=true, PAYOUTS_ENABLED unset => dry run)"
boot 1
echo "--- econ module log lines:"; grep -E 'econ (state|module|routes)' "$WORK/relay-1.log" | head -5

step "1. GET /econ/rates (public, must answer even before anything in the economy moves)"
curl -s "$BASE/econ/rates" | pp

step "2. POST /econ/balance (fresh device, just funded)"
step_json "balance" '"wayfarer":2000000000' "$(api POST /econ/balance "{\"token\":\"$TOKEN\"}")"

step "3. link a signature-verified wallet (the claim destination is resolved from it)"
ADDR="$(node "$SCRIPT_DIR/e2e-sign.mjs" new "$KEY")"
echo "--- wallet address (public, derived from the local test key): $ADDR"
curl -s -X POST "$BASE/identity/wallet-challenge" -H 'content-type: application/json' -d "{\"wallet\":\"$ADDR\"}" > "$WORK/challenge-identity.json"
node "$SCRIPT_DIR/e2e-sign.mjs" identity-body "$KEY" "$TOKEN" "$WORK/challenge-identity.json" > "$WORK/body-identity.json"
step_json "POST /identity/link (Ed25519 signature over the relay's own challenge)" '"verified":true' \
  "$(curl -s -X POST "$BASE/identity/link" -H 'content-type: application/json' -d @"$WORK/body-identity.json")"
curl -s -X POST "$BASE/wallet/challenge" -H 'content-type: application/json' -d "{\"token\":\"$TOKEN\",\"address\":\"$ADDR\",\"action\":\"link\"}" > "$WORK/challenge-wallet.json"
node "$SCRIPT_DIR/e2e-sign.mjs" wallet-body "$KEY" "$TOKEN" "$WORK/challenge-wallet.json" > "$WORK/body-wallet.json"
step_json "POST /wallet/link (same key, base58 signature)" '"linked":true' \
  "$(curl -s -X POST "$BASE/wallet/link" -H 'content-type: application/json' -d @"$WORK/body-wallet.json")"

step "4. POST /econ/claim (no destination in the body; the default path is a DRY RUN)"
step_json "claim" '"dryRun":true' "$(api POST /econ/claim "{\"token\":\"$TOKEN\",\"claimId\":\"walkthrough_claim_0001\"}")"
step_json "the same call again with the SAME claimId (idempotency key)" '"dryRun":true' \
  "$(api POST /econ/claim "{\"token\":\"$TOKEN\",\"claimId\":\"walkthrough_claim_0001\"}")"

step "5. POST /econ/stake {tierId:'t1'} — locks the tier minimum (1,000 WAYFARER)"
step_json "stake t1" '"tierId":"t1"' "$(api POST /econ/stake "{\"token\":\"$TOKEN\",\"tierId\":\"t1\"}")"
step_json "an unknown tier is refused, not defaulted" '"unknown_tier"' "$(api POST /econ/stake "{\"token\":\"$TOKEN\",\"tierId\":\"t9\"}")"
step_json "balance with the stake held" '"stakeTier":"t1"' "$(api POST /econ/balance "{\"token\":\"$TOKEN\"}")"

step "6. durability: let the write-behind flush land, stop the relay, age the lock 30 days, restart"
sleep 6
stop
if [ ! -f "$DATA/econ/state.json" ]; then echo "!!! no state.json at $DATA/econ/state.json"; exit 1; fi
echo "--- stake as persisted in \$DATA_DIR/econ/state.json:"
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(JSON.stringify(d.stakes,null,2))' "$DATA/econ/state.json"
node -e '
const fs=require("fs"),f=process.argv[1],d=JSON.parse(fs.readFileSync(f,"utf8"));
for(const k of Object.keys(d.stakes)){d.stakes[k].lockedAtMs-=30*86400000;}
fs.writeFileSync(f,JSON.stringify(d));
console.log("aged every stake by 30 days (simulating a 30-day hold without waiting): "+JSON.stringify(d.stakes));' "$DATA/econ/state.json"
boot 2
echo "--- ledger files on disk (the token balance also survived the restart):"
ls -1 "$DATA/economy/"
step_json "POST /econ/balance after restart (the stake was re-read from DATA_DIR)" '"stakeTier":"t1"' "$(api POST /econ/balance "{\"token\":\"$TOKEN\"}")"

step "7. POST /econ/unstake — principal + emission (bounded by the emission budget)"
step_json "unstake" '"emissionRaw"' "$(api POST /econ/unstake "{\"token\":\"$TOKEN\"}")"
step_json "a second unstake (nothing staked any more)" '"not_staked"' "$(api POST /econ/unstake "{\"token\":\"$TOKEN\"}")"

step "8. POST /econ/history (the ledger journal, newest first)"
step_json "history" '"reason":"stake_return"' "$(api POST /econ/history "{\"token\":\"$TOKEN\",\"limit\":10}")"

step "9. GET /econ/rates again — the budget has been spent down by the emission"
curl -s "$BASE/econ/rates" | node -e 'let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(JSON.stringify({emission:j.emission,idleGold:j.idleGold,payoutsEnabled:j.payoutsEnabled,econ:j.econ},null,2))})'

stop
echo
echo "== done. relay stopped. relay logs: $WORK/relay-1.log / relay-2.log ; DATA_DIR: $DATA"
