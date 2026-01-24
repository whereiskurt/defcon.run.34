#!/bin/bash
#
# GPX Cloud Storage E2E Test Runner
#
# This script orchestrates the full e2e test suite including:
# - Creating authenticated sessions for multiple users (default, owner, viewer)
# - Uploading sample files to cloud storage
# - Running all cloud storage tests including multi-user share tests
#
# Usage:
#   ./gpxe2e.sh              # Run full suite (setup + tests)
#   ./gpxe2e.sh --setup      # Only run setup (create sessions, upload files)
#   ./gpxe2e.sh --tests      # Only run tests (assumes setup already done)
#   ./gpxe2e.sh --clean      # Clean up test data and sessions
#   ./gpxe2e.sh --status     # Check status of services and sessions
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
AUTH_E2E_DIR="$REPO_ROOT/apps/run.auth/e2e"
GPX_E2E_DIR="$SCRIPT_DIR"

# URLs - can be overridden via environment
AUTH_URL="${AUTH_URL:-http://localhost:3002}"
GPX_URL="${GPX_URL:-http://localhost:3003}"

# User roles to set up (all use +addressing: jeanclaude+accounta@defcon.run, etc.)
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
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

check_url() {
    local url=$1
    local name=$2
    # Accept various success/redirect codes (200, 301, 302, 307, 308)
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
    log_section "Service & Session Status"

    # Check services
    echo ""
    log_info "Checking services..."

    if check_url "$AUTH_URL" "Auth Service"; then
        log_success "Auth service is running at $AUTH_URL"
    else
        log_error "Auth service is NOT running at $AUTH_URL"
    fi

    if check_url "$GPX_URL" "GPX Service"; then
        log_success "GPX service is running at $GPX_URL"
    else
        log_error "GPX service is NOT running at $GPX_URL"
    fi

    # Check cookie jars
    echo ""
    log_info "Checking session cookie jars..."

    local auth_dir="$AUTH_E2E_DIR/.auth"
    for role in "${ROLES[@]}"; do
        local cookie_file="$auth_dir/cookies-local-${role}.json"

        if [ -f "$cookie_file" ]; then
            # Check if expired
            local expires_at=$(jq -r '.expiresAt' "$cookie_file" 2>/dev/null || echo "")
            if [ -n "$expires_at" ]; then
                local expires_ts=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${expires_at%%.*}" "+%s" 2>/dev/null || echo "0")
                local now_ts=$(date "+%s")
                if [ "$expires_ts" -gt "$now_ts" ]; then
                    log_success "Session for '$role' exists and is valid (expires: $expires_at)"
                else
                    log_warn "Session for '$role' exists but is EXPIRED"
                fi
            else
                log_warn "Session for '$role' exists but couldn't parse expiry"
            fi
        else
            log_warn "No session for '$role' at $cookie_file"
        fi
    done

    # Check sample files
    echo ""
    log_info "Sample files available:"
    local sample_count=$(ls -1 "$GPX_E2E_DIR/samples/"*.gpx 2>/dev/null | wc -l | tr -d ' ')
    log_success "$sample_count GPX sample files in $GPX_E2E_DIR/samples/"
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

    # Check npm
    if command -v npm &> /dev/null; then
        log_success "npm: $(npm --version)"
    else
        log_error "npm is not installed"
        ((errors++))
    fi

    # Check if auth e2e dependencies are installed
    if [ -d "$AUTH_E2E_DIR/node_modules" ]; then
        log_success "Auth e2e dependencies installed"
    else
        log_warn "Auth e2e dependencies not installed - will install"
    fi

    # Check if gpx e2e dependencies are installed
    if [ -d "$GPX_E2E_DIR/node_modules" ]; then
        log_success "GPX e2e dependencies installed"
    else
        log_warn "GPX e2e dependencies not installed - will install"
    fi

    # Check services are running
    echo ""
    log_info "Checking services..."

    if ! check_url "$AUTH_URL" "Auth Service"; then
        log_error "Auth service is not running at $AUTH_URL"
        log_info "Start it with: cd $REPO_ROOT/apps/run.auth/webapp && PORT=3002 npm run dev"
        ((errors++))
    else
        log_success "Auth service is running"
    fi

    if ! check_url "$GPX_URL" "GPX Service"; then
        log_error "GPX service is not running at $GPX_URL"
        log_info "Start it with: cd $REPO_ROOT/apps/run.gpx/webapp && PORT=3003 npm run dev"
        ((errors++))
    else
        log_success "GPX service is running"
    fi

    if [ $errors -gt 0 ]; then
        log_error "Prerequisites check failed with $errors error(s)"
        exit 1
    fi

    log_success "All prerequisites met"
}

# ============================================================================
# Install Dependencies
# ============================================================================

install_dependencies() {
    log_section "Installing Dependencies"

    # Auth e2e
    if [ ! -d "$AUTH_E2E_DIR/node_modules" ]; then
        log_info "Installing auth e2e dependencies..."
        (cd "$AUTH_E2E_DIR" && npm install)
        log_success "Auth e2e dependencies installed"
    else
        log_success "Auth e2e dependencies already installed"
    fi

    # GPX e2e
    if [ ! -d "$GPX_E2E_DIR/node_modules" ]; then
        log_info "Installing GPX e2e dependencies..."
        (cd "$GPX_E2E_DIR" && npm install)
        log_success "GPX e2e dependencies installed"
    else
        log_success "GPX e2e dependencies already installed"
    fi

    # Install Playwright browsers if needed
    log_info "Ensuring Playwright browsers are installed..."
    (cd "$AUTH_E2E_DIR" && npx playwright install chromium --with-deps 2>/dev/null || npx playwright install chromium)
    log_success "Playwright browsers ready"
}

# ============================================================================
# Create User Sessions
# ============================================================================

create_user_sessions() {
    log_section "Creating User Sessions"

    for role in "${ROLES[@]}"; do
        echo ""
        log_info "Creating session for user role: $role"

        # Check if session already exists and is valid
        local cookie_file="$AUTH_E2E_DIR/.auth/cookies-local-${role}.json"

        if [ -f "$cookie_file" ]; then
            local expires_at=$(jq -r '.expiresAt' "$cookie_file" 2>/dev/null || echo "")
            if [ -n "$expires_at" ]; then
                local expires_ts=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${expires_at%%.*}" "+%s" 2>/dev/null || echo "0")
                local now_ts=$(date "+%s")
                if [ "$expires_ts" -gt "$now_ts" ]; then
                    log_success "Valid session already exists for '$role' - skipping"
                    continue
                fi
            fi
        fi

        # Run auth e2e tests to create session
        log_info "Running auth e2e tests for '$role'..."
        (
            cd "$AUTH_E2E_DIR"
            TEST_USER_ROLE="$role" BASE_URL="$AUTH_URL" npm test -- --grep "should complete full login" 2>&1 | tail -20
        ) || {
            log_error "Failed to create session for '$role'"
            exit 1
        }

        if [ -f "$cookie_file" ]; then
            log_success "Session created for '$role'"
        else
            log_error "Session file not created for '$role'"
            exit 1
        fi
    done

    log_success "All user sessions created"
}

# ============================================================================
# Upload Sample Files
# ============================================================================

upload_sample_files() {
    log_section "Uploading Sample Files to Cloud Storage"

    log_info "Running upload test to populate cloud storage..."

    (
        cd "$GPX_E2E_DIR"
        BASE_URL="$GPX_URL" npm test -- --grep "should upload multiple sample GPX" 2>&1 | tail -20
    ) || {
        log_warn "Sample file upload test had issues (may be OK if file already exists)"
    }

    log_success "Sample files setup complete"
}

# ============================================================================
# Run Tests
# ============================================================================

run_tests() {
    log_section "Running GPX Cloud Storage E2E Tests"

    log_info "Running full test suite..."
    echo ""

    (
        cd "$GPX_E2E_DIR"
        BASE_URL="$GPX_URL" npm test 2>&1
    )

    local exit_code=$?

    echo ""
    if [ $exit_code -eq 0 ]; then
        log_success "All tests completed successfully!"
    else
        log_warn "Some tests failed (exit code: $exit_code)"
    fi

    return $exit_code
}

# ============================================================================
# Run Tests in Headed Mode (visible browser)
# ============================================================================

run_tests_headed() {
    log_section "Running GPX Cloud Storage E2E Tests (Headed Mode)"

    log_info "Running tests with visible browser..."
    echo ""

    (
        cd "$GPX_E2E_DIR"
        BASE_URL="$GPX_URL" npm run test:headed 2>&1
    )
}

# ============================================================================
# Clean Up
# ============================================================================

clean_up() {
    log_section "Cleaning Up Test Data"

    # Remove cookie jars
    log_info "Removing session cookie jars..."
    rm -f "$AUTH_E2E_DIR/.auth/cookies-local"*.json
    rm -f "$GPX_E2E_DIR/.auth/cookies"*.json 2>/dev/null || true
    log_success "Cookie jars removed"

    # Remove test results
    log_info "Removing test results..."
    rm -rf "$AUTH_E2E_DIR/test-results" 2>/dev/null || true
    rm -rf "$GPX_E2E_DIR/test-results" 2>/dev/null || true
    rm -rf "$GPX_E2E_DIR/playwright-report" 2>/dev/null || true
    log_success "Test results removed"

    log_success "Cleanup complete"
}

# ============================================================================
# Full Setup
# ============================================================================

run_setup() {
    check_prerequisites
    install_dependencies
    create_user_sessions
    upload_sample_files
}

# ============================================================================
# Full Suite
# ============================================================================

run_full_suite() {
    run_setup
    run_tests
}

# ============================================================================
# Main
# ============================================================================

show_help() {
    echo "GPX Cloud Storage E2E Test Runner"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  (none)      Run full suite (setup + tests)"
    echo "  --setup     Only run setup (create sessions, upload files)"
    echo "  --tests     Only run tests (assumes setup already done)"
    echo "  --headed    Run tests with visible browser"
    echo "  --clean     Clean up test data and sessions"
    echo "  --status    Check status of services and sessions"
    echo "  --help      Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  AUTH_URL    Auth service URL (default: http://localhost:3002)"
    echo "  GPX_URL     GPX service URL (default: http://localhost:3003)"
    echo ""
    echo "Examples:"
    echo "  $0                           # Run full e2e suite"
    echo "  $0 --status                  # Check what's running"
    echo "  $0 --setup                   # Just create sessions"
    echo "  AUTH_URL=https://auth.defcon.run GPX_URL=https://gpx.defcon.run $0"
}

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
    --tests)
        run_tests
        ;;
    --headed)
        run_tests_headed
        ;;
    --clean)
        clean_up
        ;;
    "")
        run_full_suite
        ;;
    *)
        log_error "Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
