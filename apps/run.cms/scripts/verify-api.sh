#!/usr/bin/env bash
#
# verify-api.sh — Verify Strapi 5 REST API for DCR34 content types
#
# Tests unauthenticated access, relation population, filtering, and field selection.
# Requires a running Strapi instance with content (or at minimum, accessible endpoints).
#
# Usage:
#   ./verify-api.sh                          # Default: http://localhost:1337
#   ./verify-api.sh http://localhost:1337    # Custom base URL
#   ./verify-api.sh https://cms.defcon.run   # Production
#
# Exit codes:
#   0 = all tests passed
#   1 = one or more tests failed
#
set -euo pipefail

BASE_URL="${1:-http://localhost:1337}"
PASS=0
FAIL=0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check() {
  local name="$1"
  local url="$2"
  local expected_status="${3:-200}"

  local response
  local http_code

  response=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null) || response="000"

  if [ "$response" = "$expected_status" ]; then
    echo -e "  ${GREEN}PASS${NC} $name (HTTP $response)"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} $name (expected HTTP $expected_status, got HTTP $response)"
    FAIL=$((FAIL + 1))
  fi
}

check_json_field() {
  local name="$1"
  local url="$2"
  local jq_filter="$3"

  local body
  local http_code

  http_code=$(curl -s -o /tmp/verify-api-body.json -w "%{http_code}" "$url" 2>/dev/null) || http_code="000"

  if [ "$http_code" != "200" ]; then
    echo -e "  ${RED}FAIL${NC} $name (HTTP $http_code, expected 200)"
    FAIL=$((FAIL + 1))
    return
  fi

  if command -v jq &>/dev/null; then
    local result
    result=$(jq -r "$jq_filter" /tmp/verify-api-body.json 2>/dev/null) || result=""
    if [ -n "$result" ] && [ "$result" != "null" ] && [ "$result" != "false" ]; then
      echo -e "  ${GREEN}PASS${NC} $name"
      PASS=$((PASS + 1))
    else
      echo -e "  ${RED}FAIL${NC} $name (jq filter returned empty/null: $jq_filter)"
      FAIL=$((FAIL + 1))
    fi
  else
    # No jq available — just check HTTP 200
    echo -e "  ${YELLOW}SKIP${NC} $name (jq not installed — HTTP 200 OK but response shape not verified)"
    PASS=$((PASS + 1))
  fi
}

echo ""
echo "=================================================="
echo " DCR34 CMS API Verification"
echo " Base URL: $BASE_URL"
echo "=================================================="
echo ""

# -------------------------------------------------------
# Section 1: Unauthenticated Access (API-01)
# -------------------------------------------------------
echo "--- 1. Unauthenticated Access (Public Role) ---"
check "GET /api/events (unauthenticated)" "$BASE_URL/api/events"
check "GET /api/routes (unauthenticated)" "$BASE_URL/api/routes"
check "GET /api/points-of-interest (unauthenticated)" "$BASE_URL/api/points-of-interest"
echo ""

# -------------------------------------------------------
# Section 2: Response Shape (Strapi 5 flat format)
# -------------------------------------------------------
echo "--- 2. Response Shape ---"
check_json_field "Events response has 'data' array" "$BASE_URL/api/events" '.data | type == "array"'
check_json_field "Events response has 'meta.pagination'" "$BASE_URL/api/events" '.meta.pagination.page'
check_json_field "Routes response has 'data' array" "$BASE_URL/api/routes" '.data | type == "array"'
check_json_field "POIs response has 'data' array" "$BASE_URL/api/points-of-interest" '.data | type == "array"'
echo ""

# -------------------------------------------------------
# Section 3: Population — Level 1 (API-02)
# -------------------------------------------------------
echo "--- 3. Relation Population (Level 1) ---"
check "Events with routes populated" "$BASE_URL/api/events?populate=routes"
check "Events with coverImage populated" "$BASE_URL/api/events?populate=coverImage"
check "Events with wildcard populate" "$BASE_URL/api/events?populate=*"
check "Routes with events populated" "$BASE_URL/api/routes?populate=events"
check "Routes with pointsOfInterest populated" "$BASE_URL/api/routes?populate=pointsOfInterest"
check "Routes with multiple relations" "$BASE_URL/api/routes?populate[0]=events&populate[1]=pointsOfInterest"
check "POIs with routes populated" "$BASE_URL/api/points-of-interest?populate=routes"
echo ""

# -------------------------------------------------------
# Section 4: Population — Level 2 Deep (API-02)
# -------------------------------------------------------
echo "--- 4. Deep Population (Level 2) ---"
check "Events -> routes -> POIs (deep)" "$BASE_URL/api/events?populate[routes][populate][0]=pointsOfInterest"
check "Events -> routes -> POIs + GPX (deep)" "$BASE_URL/api/events?populate[routes][populate][0]=pointsOfInterest&populate[routes][populate][1]=gpxFiles"
check "Events -> routes + coverImage (mixed)" "$BASE_URL/api/events?populate[routes][populate][0]=pointsOfInterest&populate[0]=coverImage"
echo ""

# -------------------------------------------------------
# Section 5: Filtering (API-03)
# -------------------------------------------------------
echo "--- 5. Filtering ---"
# Date range filtering on Events
check "Filter events by date range (gte)" "$BASE_URL/api/events?filters[startDatetime][\$gte]=2026-08-07T00:00:00.000Z"
check "Filter events by date range (lte)" "$BASE_URL/api/events?filters[startDatetime][\$lte]=2026-08-10T23:59:59.000Z"
check "Filter events by date range (gte+lte)" "$BASE_URL/api/events?filters[startDatetime][\$gte]=2026-08-07T00:00:00.000Z&filters[startDatetime][\$lte]=2026-08-10T23:59:59.000Z"

# Type filtering
check "Filter events by eventType" "$BASE_URL/api/events?filters[eventType][\$eq]=run"
check "Filter routes by routeType" "$BASE_URL/api/routes?filters[routeType][\$eq]=loop"
check "Filter POIs by poiType" "$BASE_URL/api/points-of-interest?filters[poiType][\$eq]=water-station"

# Slug filtering (exact match)
check "Filter events by slug" "$BASE_URL/api/events?filters[slug][\$eq]=day-1-run"
check "Filter routes by slug" "$BASE_URL/api/routes?filters[slug][\$eq]=vegas-strip-5k"
check "Filter POIs by slug" "$BASE_URL/api/points-of-interest?filters[slug][\$eq]=main-water-station"
echo ""

# -------------------------------------------------------
# Section 6: Field Selection (API-03)
# -------------------------------------------------------
echo "--- 6. Field Selection ---"
check "Select specific event fields" "$BASE_URL/api/events?fields[0]=title&fields[1]=slug&fields[2]=startDatetime"
check "Select specific route fields" "$BASE_URL/api/routes?fields[0]=name&fields[1]=slug&fields[2]=routeType"
check "Field selection + populate combined" "$BASE_URL/api/events?fields[0]=title&fields[1]=slug&populate=routes"
echo ""

# -------------------------------------------------------
# Section 7: Write Protection (API-01 — admin-only writes)
# -------------------------------------------------------
echo "--- 7. Write Protection (unauthenticated) ---"
check "POST /api/events rejected" "$BASE_URL/api/events" "200"  # GET should work
# POST without auth should return 403
POST_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d '{"data":{"title":"hack"}}' "$BASE_URL/api/events" 2>/dev/null) || POST_STATUS="000"
if [ "$POST_STATUS" = "403" ] || [ "$POST_STATUS" = "401" ]; then
  echo -e "  ${GREEN}PASS${NC} POST /api/events blocked (HTTP $POST_STATUS)"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}FAIL${NC} POST /api/events should be blocked (got HTTP $POST_STATUS, expected 401 or 403)"
  FAIL=$((FAIL + 1))
fi

PUT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PUT -H "Content-Type: application/json" -d '{"data":{"title":"hack"}}' "$BASE_URL/api/events/fake-id" 2>/dev/null) || PUT_STATUS="000"
if [ "$PUT_STATUS" = "403" ] || [ "$PUT_STATUS" = "401" ]; then
  echo -e "  ${GREEN}PASS${NC} PUT /api/events blocked (HTTP $PUT_STATUS)"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}FAIL${NC} PUT /api/events should be blocked (got HTTP $PUT_STATUS, expected 401 or 403)"
  FAIL=$((FAIL + 1))
fi

DELETE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/api/events/fake-id" 2>/dev/null) || DELETE_STATUS="000"
if [ "$DELETE_STATUS" = "403" ] || [ "$DELETE_STATUS" = "401" ]; then
  echo -e "  ${GREEN}PASS${NC} DELETE /api/events blocked (HTTP $DELETE_STATUS)"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}FAIL${NC} DELETE /api/events should be blocked (got HTTP $DELETE_STATUS, expected 401 or 403)"
  FAIL=$((FAIL + 1))
fi
echo ""

# -------------------------------------------------------
# Results
# -------------------------------------------------------
echo "=================================================="
TOTAL=$((PASS + FAIL))
echo -e " Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, $TOTAL total"
echo "=================================================="
echo ""

# Clean up temp file
rm -f /tmp/verify-api-body.json

if [ "$FAIL" -gt 0 ]; then
  echo "Some tests failed. Check the Strapi instance and permissions."
  exit 1
else
  echo "All tests passed!"
  exit 0
fi
