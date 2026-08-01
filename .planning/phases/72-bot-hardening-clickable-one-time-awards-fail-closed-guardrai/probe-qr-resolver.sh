#!/usr/bin/env bash
#
# probe-qr-resolver.sh — live regression probe for the q.defcon.run QR resolver.
#
# Prints one machine-comparable line per probed path:
#
#     <path> <status> <location>
#
# so a pre-apply capture and a post-apply capture can be `diff`ed directly.
# A missing Location renders as `-`; a transport failure renders as `ERR`.
#
# WHY THIS EXISTS
# ---------------
# Phase 72-01 reserves `/a/<nonce>` in the resolver's LEXICAL namespace, ahead of
# the short-code classification. `b c d f g h p r` are all LIVE single-letter
# codes on q.defcon.run — `c` is the `didhtp1` payphone challenge, `r` is the
# rickroll. A reserved-letter change that quietly swallowed one of those would
# break a live con artifact with no error anywhere, so the eight are enumerated
# here and must stay byte-identical across the deploy.
#
# USAGE
#     bash probe-qr-resolver.sh > baseline.txt     # BEFORE the terragrunt apply
#     bash probe-qr-resolver.sh > after.txt        # AFTER
#     diff baseline.txt after.txt                  # only the /a lines may differ
#
# Re-runnable and idempotent: plain GETs against a public redirect service, with
# NO redirect following (the Location header is the assertion target — following
# it would hit the claim page and could park a cookie) and the response body
# discarded. The only side effect is a handful of resolver scan log lines; export
# QR_TEST_TOKEN (SSM /dc34/infra/use1/qr/test_token) to suppress even those.
#
# Env overrides: QR_PROBE_HOST, QR_PROBE_NONCE, QR_TEST_TOKEN,
#                QR_PROBE_CONNECT_TIMEOUT, QR_PROBE_MAX_TIME.

set -uo pipefail

HOST="${QR_PROBE_HOST:-https://q.defcon.run}"
NONCE="${QR_PROBE_NONCE:-probe}"
CONNECT_TIMEOUT="${QR_PROBE_CONNECT_TIMEOUT:-5}"
MAX_TIME="${QR_PROBE_MAX_TIME:-15}"

# The eight already-live single-letter short codes. Do not edit without a live
# re-survey — this list is the regression guard.
LIVE_CODES=(b c d f g h p r)

probe() {
  local path="$1"
  local -a auth=()
  [[ -n "${QR_TEST_TOKEN:-}" ]] && auth=(-H "x-qr-test: ${QR_TEST_TOKEN}")

  local headers rc status location
  headers=$(curl -sS -o /dev/null -D - \
    --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" \
    "${auth[@]}" "${HOST}${path}" 2>/dev/null)
  rc=$?

  if [[ $rc -ne 0 || -z "$headers" ]]; then
    printf '%s ERR -\n' "$path"
    return
  fi

  headers=$(printf '%s\n' "$headers" | tr -d '\r')
  status=$(printf '%s\n' "$headers" |
    sed -n 's|^HTTP/[0-9.]* \([0-9][0-9][0-9]\).*|\1|p' | tail -1)
  location=$(printf '%s\n' "$headers" |
    sed -n 's/^[Ll][Oo][Cc][Aa][Tt][Ii][Oo][Nn]:[[:space:]]*//p' | tail -1)

  printf '%s %s %s\n' "$path" "${status:-ERR}" "${location:--}"
}

# Group 1 — the eight live single-letter codes, lowercase as a user types them.
# Expect 302 with a non-empty Location; these lines must not move.
for code in "${LIVE_CODES[@]}"; do
  probe "/${code}"
done

# Group 2 — the award namespace. A bare reserved letter has nothing to claim and
# degrades to `empty` -> 404, before and after. The letter plus a token must flip
# 404 -> 302 to the run.defcon.run claim page carrying that token as ?nonce.
probe "/a"
probe "/a/${NONCE}"

# Group 3 — the UPPERCASE award letter. 72-01 review item W5 made the reserved
# LETTER case-insensitive because award links are transcribed by hand off a radio
# screen and mobile keyboards autocapitalize. A 404 here means W5 did not deploy.
# The nonce half stays verbatim; the claim page owns lowercasing that.
probe "/A/${NONCE}"
