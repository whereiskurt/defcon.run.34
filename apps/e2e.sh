#!/bin/bash
#
# Unified E2E Test Runner
#
# Runs e2e tests for all services in the correct order:
# 1. run.auth - Creates authenticated sessions
# 2. run.gpx - Tests cloud storage features
#
# Usage:
#   ./e2e.sh              # Run all e2e tests
#   ./e2e.sh --setup      # Only create sessions (no gpx tests)
#   ./e2e.sh --headed     # Run with visible browser
#   ./e2e.sh --slow       # Run headed with slow-mo (500ms between actions)
#   ./e2e.sh --auth       # Only run auth tests
#   ./e2e.sh --gpx        # Only run gpx tests (assumes auth done)
#   ./e2e.sh --clean      # Clean up all test data
#   ./e2e.sh --status     # Check status of services and sessions
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTH_E2E_DIR="$SCRIPT_DIR/run.auth/e2e"
GPX_E2E_DIR="$SCRIPT_DIR/run.gpx/e2e"

# URLs
AUTH_URL="${AUTH_URL:-http://localhost:3002}"
GPX_URL="${GPX_URL:-http://localhost:3003}"

# User roles
ROLES=("accounta" "accountb" "accountc")

# ============================================================================
# Utility Functions
# ============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_section() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

check_url() {
    local url=$1
    if curl -s -o /dev/null -w "%{http_code}" "$url" | grep -qE "^(200|301|302|307|308)$"; then
        return 0
    else
        return 1
    fi
}

# ============================================================================
# Status Check
# ============================================================================

check_status() {
    log_section "E2E Test Status"

    echo ""
    log_info "Services:"
    if check_url "$AUTH_URL"; then
        log_success "Auth service: $AUTH_URL"
    else
        log_error "Auth service: $AUTH_URL (not running)"
    fi

    if check_url "$GPX_URL"; then
        log_success "GPX service: $GPX_URL"
    else
        log_error "GPX service: $GPX_URL (not running)"
    fi

    echo ""
    log_info "Sessions:"
    local auth_dir="$AUTH_E2E_DIR/.auth"
    for role in "${ROLES[@]}"; do
        local cookie_file="$auth_dir/cookies-local-${role}.json"
        if [ -f "$cookie_file" ]; then
            local expires_at=$(jq -r '.expiresAt' "$cookie_file" 2>/dev/null || echo "")
            if [ -n "$expires_at" ]; then
                local expires_ts=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${expires_at%%.*}" "+%s" 2>/dev/null || echo "0")
                local now_ts=$(date "+%s")
                if [ "$expires_ts" -gt "$now_ts" ]; then
                    log_success "$role: valid (expires: ${expires_at:0:19})"
                else
                    log_warn "$role: EXPIRED"
                fi
            else
                log_warn "$role: exists but couldn't parse expiry"
            fi
        else
            log_warn "$role: no session"
        fi
    done
}

# ============================================================================
# Prerequisites Check
# ============================================================================

check_prerequisites() {
    log_section "Checking Prerequisites"

    local errors=0

    # Check Node.js
    if command -v node &> /dev/null; then
        log_success "Node.js: $(node --version)"
    else
        log_error "Node.js is not installed"
        ((errors++))
    fi

    # Check services
    echo ""
    log_info "Checking services..."

    if ! check_url "$AUTH_URL"; then
        log_error "Auth service is not running at $AUTH_URL"
        log_info "Start with: cd apps/run.auth/webapp && PORT=3002 npm run dev"
        ((errors++))
    else
        log_success "Auth service is running"
    fi

    if ! check_url "$GPX_URL"; then
        log_error "GPX service is not running at $GPX_URL"
        log_info "Start with: cd apps/run.gpx/webapp && PORT=3003 npm run dev"
        ((errors++))
    else
        log_success "GPX service is running"
    fi

    if [ $errors -gt 0 ]; then
        log_error "Prerequisites check failed"
        exit 1
    fi

    log_success "All prerequisites met"
}

# ============================================================================
# Install Dependencies
# ============================================================================

install_deps() {
    log_section "Installing Dependencies"

    # Auth e2e
    if [ ! -d "$AUTH_E2E_DIR/node_modules" ]; then
        log_info "Installing auth e2e dependencies..."
        (cd "$AUTH_E2E_DIR" && npm install)
    else
        log_success "Auth e2e dependencies installed"
    fi

    # GPX e2e
    if [ ! -d "$GPX_E2E_DIR/node_modules" ]; then
        log_info "Installing GPX e2e dependencies..."
        (cd "$GPX_E2E_DIR" && npm install)
    else
        log_success "GPX e2e dependencies installed"
    fi

    # Playwright browsers
    log_info "Ensuring Playwright browsers..."
    (cd "$AUTH_E2E_DIR" && npx playwright install chromium 2>/dev/null) || true
    log_success "Playwright ready"
}

# ============================================================================
# Run Auth E2E Tests
# ============================================================================

run_auth_tests() {
    local headed=$1
    log_section "Running Auth E2E Tests"

    for role in "${ROLES[@]}"; do
        echo ""
        log_info "Creating session for $role..."

        # Check if session already exists
        local cookie_file="$AUTH_E2E_DIR/.auth/cookies-local-${role}.json"
        if [ -f "$cookie_file" ]; then
            local expires_at=$(jq -r '.expiresAt' "$cookie_file" 2>/dev/null || echo "")
            if [ -n "$expires_at" ]; then
                local expires_ts=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${expires_at%%.*}" "+%s" 2>/dev/null || echo "0")
                local now_ts=$(date "+%s")
                if [ "$expires_ts" -gt "$now_ts" ]; then
                    log_success "Valid session exists for $role - skipping"
                    continue
                fi
            fi
        fi

        # Run auth test for this role
        local headed_flag=""
        if [ "$headed" = "true" ]; then
            headed_flag="--headed"
        fi

        (
            cd "$AUTH_E2E_DIR"
            TEST_USER_ROLE="$role" BASE_URL="$AUTH_URL" npx playwright test $headed_flag --grep "should complete full login" 2>&1 | tail -25
        ) || {
            log_error "Failed to create session for $role"
            exit 1
        }

        if [ -f "$cookie_file" ]; then
            log_success "Session created for $role"
        else
            log_error "Session file not created for $role"
            exit 1
        fi
    done

    log_success "All auth sessions ready"
}

# ============================================================================
# Run GPX E2E Tests
# ============================================================================

run_gpx_tests() {
    local headed=$1
    local slow=$2
    log_section "Running GPX E2E Tests"

    local extra_flags=""
    local slow_mo_env=""
    if [ "$headed" = "true" ]; then
        extra_flags="--headed"
    fi
    if [ "$slow" = "true" ]; then
        extra_flags="--headed"
        slow_mo_env="SLOW_MO=500"
    fi

    (
        cd "$GPX_E2E_DIR"
        env $slow_mo_env BASE_URL="$GPX_URL" npx playwright test $extra_flags 2>&1
    )

    local exit_code=$?

    echo ""
    if [ $exit_code -eq 0 ]; then
        log_success "All GPX tests passed!"
    else
        log_warn "Some tests failed (exit code: $exit_code)"
    fi

    return $exit_code
}

# ============================================================================
# Clean Up
# ============================================================================

clean_up() {
    log_section "Cleaning Up Test Data"

    log_info "Removing session cookie jars..."
    rm -f "$AUTH_E2E_DIR/.auth/"cookies*.json 2>/dev/null || true
    rm -f "$GPX_E2E_DIR/.auth/"cookies*.json 2>/dev/null || true
    log_success "Cookie jars removed"

    log_info "Removing test results..."
    rm -rf "$AUTH_E2E_DIR/test-results" 2>/dev/null || true
    rm -rf "$GPX_E2E_DIR/test-results" 2>/dev/null || true
    rm -rf "$GPX_E2E_DIR/playwright-report" 2>/dev/null || true
    log_success "Test results removed"

    log_success "Cleanup complete"
}

# ============================================================================
# Main Commands
# ============================================================================

run_all() {
    local headed=$1
    local slow=$2
    check_prerequisites
    install_deps
    run_auth_tests "$headed"
    run_gpx_tests "$headed" "$slow"
}

run_setup() {
    check_prerequisites
    install_deps
    run_auth_tests "false"
    log_success "Setup complete - sessions created for all roles"
}

show_help() {
    echo "Unified E2E Test Runner"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  (none)      Run all e2e tests (auth + gpx)"
    echo "  --setup     Create auth sessions only"
    echo "  --headed    Run all tests with visible browser"
    echo "  --slow      Run headed with slow-mo (500ms delay between actions)"
    echo "  --auth      Run auth tests only"
    echo "  --gpx       Run gpx tests only (assumes sessions exist)"
    echo "  --clean     Clean up test data and sessions"
    echo "  --status    Check status of services and sessions"
    echo "  --help      Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                  # Run full suite"
    echo "  $0 --setup          # Just create sessions"
    echo "  $0 --headed         # Watch tests in browser"
    echo "  $0 --slow           # Watch tests slowly"
    echo "  $0 --gpx --headed   # Watch only GPX tests"
}

# ============================================================================
# Main
# ============================================================================

case "${1:-}" in
    --help|-h)
        show_help
        ;;
    --status)
        check_status
        ;;
    --setup)
        run_setup
        ;;
    --auth)
        check_prerequisites
        install_deps
        run_auth_tests "${2:-false}"
        ;;
    --gpx)
        check_prerequisites
        gpx_headed="false"
        gpx_slow="false"
        if [ "${2:-}" = "--headed" ]; then gpx_headed="true"; fi
        if [ "${2:-}" = "--slow" ]; then gpx_headed="true"; gpx_slow="true"; fi
        run_gpx_tests "$gpx_headed" "$gpx_slow"
        ;;
    --headed)
        run_all "true" "false"
        ;;
    --slow)
        run_all "true" "true"
        ;;
    --clean)
        clean_up
        ;;
    "")
        run_all "false" "false"
        ;;
    *)
        log_error "Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
