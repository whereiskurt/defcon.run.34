#!/usr/bin/env bash
# Phase 72 plan 09 — post-deploy live probe.
#
# Proves the bot-hardening release is actually SERVING in us-east-1. CI going green is
# not evidence: ECS does a rolling replace, so every claim below is re-derived from live
# AWS state or a live HTTP fetch.
#
# Re-runnable. Read-only — it never mutates AWS, never POSTs, and never prints the ricky
# flag code or the fallback URL (both are redacted to shape assertions only).
#
#   bash probe-bot-hardening.sh
#
# Exit 0 only when every assertion passes.

set -uo pipefail

PROFILE="${AWS_PROFILE_OVERRIDE:-dc34-application}"
REGION="us-east-1"
CLUSTER="app-use1-dc34"
# NOTE: the ECS service names carry a -use1 suffix; `run-mqtt` alone matches nothing and
# `describe-services` returns an EMPTY list rather than failing, which reads as a pass.
SVC_MQTT="run-mqtt-use1"
SVC_HUMAN="run-human-use1"
TD_MQTT="run-mqtt-use1-dc34"
TD_HUMAN="run-human-use1-dc34"
GHOSTS_CONTAINER="run-mqtt-ghosts"
GHOSTS_LOG_GROUP="/ecs/run-mqtt-ghosts-run-mqtt-use1-dc34"
GUARDRAILS_LOG_GROUP="/ecs/run-mqtt-guardrails-run-mqtt-use1-dc34"
ALARM="dcr-mqtt-guardrail-outage"
FALLBACK_PARAM="/dc34/secrets/use1/mqtt/ricky-fallback-url"

# Expected versions for this release. Override to re-run against a later one.
EXPECT_HUMAN="${EXPECT_HUMAN:-v0.0.134}"
EXPECT_MESHTK="${EXPECT_MESHTK:-v0.0.83}"

PASS=0
FAIL=0

ok()   { printf '  PASS  %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  FAIL  %s\n' "$1"; FAIL=$((FAIL + 1)); }
head_() { printf '\n=== %s\n' "$1"; }

aws_q() { aws "$@" --profile "$PROFILE" --region "$REGION"; }

printf 'Phase 72 post-deploy probe — %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'region=%s cluster=%s expect run.human=%s meshtk=%s\n' \
  "$REGION" "$CLUSTER" "$EXPECT_HUMAN" "$EXPECT_MESHTK"

# ---------------------------------------------------------------------------
head_ "1. LIVE run.human version (fetched over the internet, not from CI)"
# ---------------------------------------------------------------------------
LIVE_HUMAN=$(curl -s --max-time 30 https://run.defcon.run/use1/ | grep -oE 'v0\.0\.[0-9]+' | head -1)
printf '  live version: %s\n' "${LIVE_HUMAN:-<none>}"
if [ "$LIVE_HUMAN" = "$EXPECT_HUMAN" ]; then
  ok "run.human is serving $EXPECT_HUMAN"
else
  bad "run.human serving '${LIVE_HUMAN:-<none>}', expected $EXPECT_HUMAN"
fi

# ---------------------------------------------------------------------------
head_ "2. ECS rollout — both services on a NEW revision, rollout COMPLETED"
# ---------------------------------------------------------------------------
for SVC in "$SVC_MQTT" "$SVC_HUMAN"; do
  read -r TD RUNNING STATE <<<"$(aws_q ecs describe-services --cluster "$CLUSTER" --services "$SVC" \
    --query 'services[0].deployments[?status==`PRIMARY`]|[0].[taskDefinition,runningCount,rolloutState]' \
    --output text)"
  printf '  %-16s %s running=%s state=%s\n' "$SVC" "${TD##*/}" "$RUNNING" "$STATE"
  if [ "$STATE" = "COMPLETED" ]; then
    ok "$SVC rolloutState COMPLETED"
  else
    bad "$SVC rolloutState is '$STATE', not COMPLETED"
  fi
  if [ "${RUNNING:-0}" -ge 1 ] 2>/dev/null; then
    ok "$SVC has $RUNNING running task(s)"
  else
    bad "$SVC runningCount ${RUNNING:-0} < 1"
  fi
done

# ---------------------------------------------------------------------------
head_ "3. DEPLOYED task definition — fail-closed guardrails + fallback secret"
# ---------------------------------------------------------------------------
# Read the registered task definition, NOT service.hcl. The source file proves what was
# authored; only the task def proves what ECS will actually hand the container.
FAILMODE=$(aws_q ecs describe-task-definition --task-definition "$TD_MQTT" \
  --query "taskDefinition.containerDefinitions[?name=='$GHOSTS_CONTAINER']|[0].environment[?name=='MESHTK_GUARDRAIL_FAILMODE']|[0].value" \
  --output text)
printf '  MESHTK_GUARDRAIL_FAILMODE = %s\n' "$FAILMODE"
if [ "$FAILMODE" = "closed" ]; then
  ok "ghosts container is fail-closed"
else
  bad "MESHTK_GUARDRAIL_FAILMODE is '$FAILMODE', expected 'closed'"
fi

SECRET_FROM=$(aws_q ecs describe-task-definition --task-definition "$TD_MQTT" \
  --query "taskDefinition.containerDefinitions[?name=='$GHOSTS_CONTAINER']|[0].secrets[?name=='MESHTK_RICKY_FALLBACK_URL']|[0].valueFrom" \
  --output text)
printf '  MESHTK_RICKY_FALLBACK_URL valueFrom = %s\n' "$SECRET_FROM"
case "$SECRET_FROM" in
  *"$FALLBACK_PARAM") ok "fallback secret reference points at $FALLBACK_PARAM" ;;
  *) bad "fallback secret valueFrom is '$SECRET_FROM', expected to end with $FALLBACK_PARAM" ;;
esac

# The task def can reference a parameter that does not exist — ECS then hard-fails task
# START, which is exactly the outage this assertion exists to rule out. --with-decryption
# is REQUIRED: without it a SecureString returns KMS ciphertext and every shape check below
# would pass against a value the container can never use.
FB=$(aws_q ssm get-parameter --name "$FALLBACK_PARAM" --with-decryption \
  --query 'Parameter.Value' --output text 2>/dev/null)
if [ -n "$FB" ]; then
  ok "SSM parameter resolves and is non-empty (${#FB} chars, host=$(printf '%s' "$FB" | awk -F/ '{print $3}'), value redacted)"
else
  bad "SSM parameter $FALLBACK_PARAM is missing or empty — ghosts will not start"
fi
case "$FB" in
  https://*) ok "fallback URL scheme is https" ;;
  *)         bad "fallback URL is not https" ;;
esac
case "$FB" in
  *CHANGEME*) bad "fallback URL is still the 72-04 CHANGEME placeholder" ;;
  *)          ok "fallback URL is not the placeholder" ;;
esac

# ---------------------------------------------------------------------------
head_ "4. Deployed meshtk image tag"
# ---------------------------------------------------------------------------
MESHTK_IMG=$(aws_q ecs describe-task-definition --task-definition "$TD_MQTT" \
  --query "taskDefinition.containerDefinitions[?name=='$GHOSTS_CONTAINER']|[0].image" --output text)
printf '  ghosts image: %s\n' "$MESHTK_IMG"
case "$MESHTK_IMG" in
  *":$EXPECT_MESHTK") ok "ghosts container runs meshtk $EXPECT_MESHTK" ;;
  *) bad "ghosts image tag is not $EXPECT_MESHTK" ;;
esac

# ---------------------------------------------------------------------------
head_ "5. Guardrail-outage alarm exists in a REAL state"
# ---------------------------------------------------------------------------
# INSUFFICIENT_DATA is the silent failure mode: it is what a metric filter pointed at the
# wrong log group or written with a JSON selector against unstructured logs looks like.
ALARM_STATE=$(aws_q cloudwatch describe-alarms --alarm-names "$ALARM" \
  --query 'MetricAlarms[0].StateValue' --output text 2>/dev/null)
printf '  %s state = %s\n' "$ALARM" "$ALARM_STATE"
if [ "$ALARM_STATE" = "None" ] || [ -z "$ALARM_STATE" ]; then
  bad "alarm $ALARM does not exist"
elif [ "$ALARM_STATE" = "INSUFFICIENT_DATA" ]; then
  bad "alarm $ALARM is stuck in INSUFFICIENT_DATA — log group or filter pattern is wrong"
else
  ok "alarm $ALARM exists in state $ALARM_STATE"
fi

MF=$(aws_q logs describe-metric-filters --log-group-name "$GHOSTS_LOG_GROUP" \
  --query "metricFilters[?filterName=='dcr-mqtt-guardrail-outages']|[0].filterPattern" --output text 2>/dev/null)
printf '  metric filter pattern on %s: %s\n' "$GHOSTS_LOG_GROUP" "${MF:-<none>}"
if [ -n "$MF" ] && [ "$MF" != "None" ]; then
  ok "guardrail-outage metric filter is attached to the ghosts log group"
else
  bad "no dcr-mqtt-guardrail-outages metric filter on $GHOSTS_LOG_GROUP"
fi

# ---------------------------------------------------------------------------
head_ "6. Ghosts container is ALIVE and not crash-looping"
# ---------------------------------------------------------------------------
# Read the STREAMS: a log group exists whether or not anything is writing to it.
# Use --limit, never --max-items: --max-items makes the CLI paginate client-side and
# append a bare `None` NextToken line to --output text, which then lands in arithmetic.
NEWEST=$(aws_q logs describe-log-streams --log-group-name "$GHOSTS_LOG_GROUP" \
  --order-by LastEventTime --descending --limit 1 \
  --query 'logStreams[0].[logStreamName,lastEventTimestamp]' --output text 2>/dev/null | head -1)
STREAM=$(printf '%s' "$NEWEST" | awk '{print $1}')
LAST_TS=$(printf '%s' "$NEWEST" | awk '{print $2}' | tr -cd '0-9')

# `lastEventTimestamp` from describe-log-streams is EVENTUALLY CONSISTENT — AWS
# documents that it "updates on an eventual consistency basis; it typically updates
# in less than an hour". In 72-10 it read 00:03:11Z while the stream's newest event
# was 00:35:31Z (22s old): ~32 minutes stale, which tripped this assertion and
# reported a healthy, RUNNING/HEALTHY ghosts container as "may not be running".
# Ground truth is the events themselves, so prefer the newest actual event and fall
# back to the eventually-consistent field only if the fetch yields nothing.
if [ -n "$STREAM" ]; then
  EVENT_TS=$(aws_q logs get-log-events --log-group-name "$GHOSTS_LOG_GROUP" \
    --log-stream-name "$STREAM" --limit 1 \
    --query 'events[-1].timestamp' --output text 2>/dev/null | tr -cd '0-9')
  [ -n "$EVENT_TS" ] && LAST_TS="$EVENT_TS"
fi
NOW_MS=$(( $(date +%s) * 1000 ))
AGE_S=$(( (NOW_MS - ${LAST_TS:-0}) / 1000 ))
printf '  newest ghosts stream: %s (last event %ss ago)\n' "${STREAM:-<none>}" "$AGE_S"
if [ -n "$STREAM" ] && [ "$AGE_S" -lt 900 ]; then
  ok "ghosts log stream is fresh (< 15 min)"
else
  bad "ghosts log stream is stale or absent — container may not be running"
fi

# A crash loop shows up as several streams all created within the last few minutes.
RECENT_STREAMS=$(aws_q logs describe-log-streams --log-group-name "$GHOSTS_LOG_GROUP" \
  --order-by LastEventTime --descending --limit 6 \
  --query 'logStreams[].creationTime' --output text 2>/dev/null | tr '\t' '\n' \
  | grep -E '^[0-9]+$' \
  | awk -v now="$NOW_MS" '{ if ((now - $1)/1000 < 900) c++ } END { print c+0 }')
printf '  ghosts streams created in the last 15 min: %s\n' "$RECENT_STREAMS"
if [ "$RECENT_STREAMS" -le 2 ]; then
  ok "no crash loop (<= 2 new streams in 15 min)"
else
  bad "$RECENT_STREAMS new ghosts streams in 15 min — looks like a restart loop"
fi

# Same eventual-consistency trap as the ghosts freshness check above: read the
# newest event itself, not the stream's lastEventTimestamp. The 30-minute threshold
# here is wider than the ghosts one, but AWS only promises the field settles within
# an HOUR, so this can false-alarm too.
GUARD_STREAM=$(aws_q logs describe-log-streams --log-group-name "$GUARDRAILS_LOG_GROUP" \
  --order-by LastEventTime --descending --limit 1 \
  --query 'logStreams[0].logStreamName' --output text 2>/dev/null | head -1)
GUARD_TS=""
if [ -n "$GUARD_STREAM" ] && [ "$GUARD_STREAM" != "None" ]; then
  GUARD_TS=$(aws_q logs get-log-events --log-group-name "$GUARDRAILS_LOG_GROUP" \
    --log-stream-name "$GUARD_STREAM" --limit 1 \
    --query 'events[-1].timestamp' --output text 2>/dev/null | tr -cd '0-9')
fi
if [ -z "$GUARD_TS" ]; then
  GUARD_TS=$(aws_q logs describe-log-streams --log-group-name "$GUARDRAILS_LOG_GROUP" \
    --order-by LastEventTime --descending --limit 1 \
    --query 'logStreams[0].lastEventTimestamp' --output text 2>/dev/null | head -1 | tr -cd '0-9')
fi
if [ -z "$GUARD_TS" ]; then
  printf '  guardrails sidecar last event: <none>\n'
  bad "guardrails sidecar log group has no events"
else
  GUARD_AGE=$(( (NOW_MS - GUARD_TS) / 1000 ))
  printf '  guardrails sidecar last event: %ss ago\n' "$GUARD_AGE"
  if [ "$GUARD_AGE" -lt 1800 ]; then
    ok "guardrails sidecar is logging (< 30 min)"
  else
    bad "guardrails sidecar has not logged in ${GUARD_AGE}s"
  fi
fi

# ---------------------------------------------------------------------------
head_ "7. Resolver regression — the eight live single-letter codes still 302"
# ---------------------------------------------------------------------------
# 72-05 shipped the /a/<nonce> award namespace on the SAME resolver that serves these.
# `c` is called out explicitly: it must still reach didhtp1, and it is the reason the
# award namespace is `a` rather than `c`.
#
# The list is exactly 72-05's LIVE_CODES (probe-qr-resolver.sh:44) — `b c d f g h p r`.
# Do NOT extend it by guessing: `a` and `q` are NOT short codes, and asserting a redirect
# on them produces a red probe that says "regression" when nothing regressed.
BLOCK=""
for CODE in b c d f g h p r; do
  read -r STATUS LOC <<<"$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' \
    --max-time 20 "https://q.defcon.run/$CODE")"
  printf '  /%s -> %s %s\n' "$CODE" "$STATUS" "${LOC:-<none>}"
  BLOCK="${BLOCK}/${CODE} ${STATUS} ${LOC:--}"$'\n'
  if [ "$STATUS" = "302" ] || [ "$STATUS" = "301" ]; then
    ok "/$CODE redirects ($STATUS)"
  else
    bad "/$CODE returned $STATUS, expected a redirect"
  fi
done

# Per-code status is necessary but not sufficient — a code could still 302 to the WRONG
# place. 72-05 recorded an md5 over the whole eight-line block as the byte-identity gate.
BASELINE_MD5="cd9dd6384ee47fd126de526b09a4fa50"
NOW_MD5=$(printf '%s' "$BLOCK" | md5 2>/dev/null || printf '%s' "$BLOCK" | md5sum | awk '{print $1}')
printf '  8-code block md5: %s (72-05 baseline %s)\n' "$NOW_MD5" "$BASELINE_MD5"
if [ "$NOW_MD5" = "$BASELINE_MD5" ]; then
  ok "eight-code block byte-identical to the 72-05 post-apply capture"
else
  bad "eight-code block DIFFERS from the 72-05 baseline — a destination changed"
fi

# ---------------------------------------------------------------------------
head_ "8. Award namespace is live (both cases) and does not leak"
# ---------------------------------------------------------------------------
# An unminted nonce must NOT 500 or reveal anything; a redirect to the claim page or a
# non-disclosure 404 are both correct. A 5xx is not.
for P in "a/PROBE00000000" "A/PROBE00000000"; do
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://q.defcon.run/$P")
  printf '  /%s -> %s\n' "$P" "$STATUS"
  if [ "$STATUS" -lt 500 ] 2>/dev/null; then
    ok "/$P handled cleanly ($STATUS, no 5xx)"
  else
    bad "/$P returned $STATUS"
  fi
done

printf '\n=== RESULT  pass=%s fail=%s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
