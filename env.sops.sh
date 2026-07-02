#!/bin/bash
set -euo pipefail

## env.sops.sh — Create a multi-region KMS key for SOPS encryption
##
## Usage:
##   ./env.sops.sh              # Dry-run: prints what would happen
##   ./env.sops.sh --not-dry-run  # Actually create KMS keys and write .sops.yaml
##
## Prerequisites:
##   - AWS CLI v2 installed
##   - env.local.sh populated with TF_VAR_profile_prefix and TF_VAR_APPLICATION_ACCOUNT_ID
##     (or those variables already exported)
##   - SSO session active (run env.sh first)

# --- Argument parsing ---
DRY_RUN=true
for arg in "$@"; do
  case "${arg}" in
    --not-dry-run) DRY_RUN=false ;;
    *) echo "Unknown argument: ${arg}"; echo "Usage: $0 [--not-dry-run]"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source env.local.sh if it exists (for TF_VAR_profile_prefix, TF_VAR_APPLICATION_ACCOUNT_ID)
if [[ -f "${SCRIPT_DIR}/env.local.sh" ]]; then
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/env.local.sh"
fi

# Determine profile prefix and AWS profile
PROFILE_PREFIX="${TF_VAR_profile_prefix:-}"
if [[ -n "${PROFILE_PREFIX}" ]]; then
  AWS_PROFILE="${PROFILE_PREFIX}-terraform"
else
  AWS_PROFILE="terraform"
fi

ACCOUNT_ID="${TF_VAR_APPLICATION_ACCOUNT_ID:-}"
if [[ -z "${ACCOUNT_ID}" || "${ACCOUNT_ID}" == "000000000000" ]]; then
  echo "ERROR: TF_VAR_APPLICATION_ACCOUNT_ID is not set or is the default placeholder."
  echo "       Set it in env.local.sh or export it before running this script."
  exit 1
fi

# Regions: primary + replicas
PRIMARY_REGION="us-east-1"
# Uncomment to add ap-southeast-1:
# REPLICA_REGIONS=("ca-central-1")
REPLICA_REGIONS=("ca-central-1" "ap-southeast-1")

ALIAS_NAME="alias/sops"

if ${DRY_RUN}; then
  echo "[DRY RUN] Pass --not-dry-run to execute"
else
  echo "[LIVE] Creating resources..."
fi
echo ""
echo "=== SOPS KMS Key Setup ==="
echo "  AWS Profile:   ${AWS_PROFILE}"
echo "  Account ID:    ${ACCOUNT_ID}"
echo "  Primary:       ${PRIMARY_REGION}"
echo "  Replicas:      ${REPLICA_REGIONS[*]}"
echo ""

## Pre-check: If .sops.yaml already has KMS ARNs for THIS account, nothing to do
SOPS_YAML="${SCRIPT_DIR}/.sops.yaml"
if [[ -f "${SOPS_YAML}" ]] && grep -q ":${ACCOUNT_ID}:" "${SOPS_YAML}" 2>/dev/null; then
  echo "SOPS is already configured for account ${ACCOUNT_ID} (${SOPS_YAML})."
  echo "No KMS keys will be created. Delete .sops.yaml to re-run setup."
  exit 0
fi

## Step 1: Check if alias already exists in primary region
existing_key=""
existing_key=$(aws kms list-aliases \
  --profile "${AWS_PROFILE}" \
  --region "${PRIMARY_REGION}" \
  --query "Aliases[?AliasName=='${ALIAS_NAME}'].TargetKeyId | [0]" \
  --output text 2>/dev/null) || true

if [[ -n "${existing_key}" && "${existing_key}" != "None" ]]; then
  echo "Key alias '${ALIAS_NAME}' already exists in ${PRIMARY_REGION}"
  echo "  Key ID: ${existing_key}"
  KEY_ID="${existing_key}"
else
  if ${DRY_RUN}; then
    echo "[DRY RUN] Would create multi-region KMS key in ${PRIMARY_REGION}"
    echo "  aws kms create-key --profile ${AWS_PROFILE} --region ${PRIMARY_REGION} --description 'SOPS secrets encryption (multi-region primary)' --multi-region"
    echo ""
    echo "[DRY RUN] Would create alias '${ALIAS_NAME}' in ${PRIMARY_REGION}"
    echo "  aws kms create-alias --profile ${AWS_PROFILE} --region ${PRIMARY_REGION} --alias-name ${ALIAS_NAME} --target-key-id <new-key-id>"
    KEY_ID="<pending-key-id>"
  else
    ## Step 2: Create multi-region primary key in us-east-1
    echo "Creating multi-region KMS key in ${PRIMARY_REGION}..."
    KEY_ID=$(aws kms create-key \
      --profile "${AWS_PROFILE}" \
      --region "${PRIMARY_REGION}" \
      --description "SOPS secrets encryption (multi-region primary)" \
      --multi-region \
      --query "KeyMetadata.KeyId" \
      --output text)

    echo "  Created key: ${KEY_ID}"

    ## Step 3: Create alias in primary region
    echo "Creating alias '${ALIAS_NAME}' in ${PRIMARY_REGION}..."
    aws kms create-alias \
      --profile "${AWS_PROFILE}" \
      --region "${PRIMARY_REGION}" \
      --alias-name "${ALIAS_NAME}" \
      --target-key-id "${KEY_ID}"
  fi
fi

## Step 4: Create replicas and aliases in each replica region
for region in "${REPLICA_REGIONS[@]}"; do
  echo ""

  # Check if alias exists in this region already
  replica_key=""
  replica_key=$(aws kms list-aliases \
    --profile "${AWS_PROFILE}" \
    --region "${region}" \
    --query "Aliases[?AliasName=='${ALIAS_NAME}'].TargetKeyId | [0]" \
    --output text 2>/dev/null) || true

  if [[ -n "${replica_key}" && "${replica_key}" != "None" ]]; then
    echo "Key alias '${ALIAS_NAME}' already exists in ${region}"
    echo "  Key ID: ${replica_key}"
    continue
  fi

  # Check if a replica key already exists (same mrk- ID)
  replica_exists=""
  replica_exists=$(aws kms describe-key \
    --profile "${AWS_PROFILE}" \
    --region "${region}" \
    --key-id "mrk-${KEY_ID#mrk-}" \
    --query "KeyMetadata.KeyId" \
    --output text 2>/dev/null) || true

  if [[ -z "${replica_exists}" || "${replica_exists}" == "None" ]]; then
    if ${DRY_RUN}; then
      echo "[DRY RUN] Would create replica in ${region}"
      echo "  aws kms replicate-key --profile ${AWS_PROFILE} --region ${PRIMARY_REGION} --key-id ${KEY_ID} --replica-region ${region}"
    else
      echo "Creating replica in ${region}..."
      aws kms replicate-key \
        --profile "${AWS_PROFILE}" \
        --region "${PRIMARY_REGION}" \
        --key-id "${KEY_ID}" \
        --replica-region "${region}" \
        --description "SOPS secrets encryption (multi-region replica)" >/dev/null
    fi
  else
    echo "Replica key already exists in ${region}"
  fi

  if ${DRY_RUN}; then
    echo "[DRY RUN] Would create alias '${ALIAS_NAME}' in ${region}"
    echo "  aws kms create-alias --profile ${AWS_PROFILE} --region ${region} --alias-name ${ALIAS_NAME} --target-key-id ${KEY_ID}"
  else
    echo "Creating alias '${ALIAS_NAME}' in ${region}..."
    aws kms create-alias \
      --profile "${AWS_PROFILE}" \
      --region "${region}" \
      --alias-name "${ALIAS_NAME}" \
      --target-key-id "${KEY_ID}"
  fi
done

## Step 5: Update .sops.yaml
SOPS_YAML="${SCRIPT_DIR}/.sops.yaml"
ALL_REGIONS=("${PRIMARY_REGION}" "${REPLICA_REGIONS[@]}")
KMS_ARNS=""
for region in "${ALL_REGIONS[@]}"; do
  if [[ -n "${KMS_ARNS}" ]]; then
    KMS_ARNS="${KMS_ARNS},"
  fi
  KMS_ARNS="${KMS_ARNS}arn:aws:kms:${region}:${ACCOUNT_ID}:${ALIAS_NAME}"
done

echo ""
if ${DRY_RUN}; then
  echo "[DRY RUN] Would write ${SOPS_YAML}:"
  echo "---"
  cat <<EOF
creation_rules:
  - path_regex: \.secrets(\.sops)?\.json\$
    kms: "${KMS_ARNS}"
EOF
  echo "---"
else
  echo "Updating ${SOPS_YAML}..."
  cat > "${SOPS_YAML}" <<EOF
creation_rules:
  - path_regex: \.secrets(\.sops)?\.json\$
    kms: "${KMS_ARNS}"
EOF
  echo "  Done."
fi

## Step 6: Create or re-encrypt .secrets.sops.json
## On a fresh fork, the file exists but is encrypted with upstream keys we can't
## decrypt. In that case, replace it from the template and encrypt with our keys.
SITE_DIR="${SCRIPT_DIR}/infra/terraform/live/site"
SOPS_FILE="${SITE_DIR}/.secrets.sops.json"
TEMPLATE_FILE="${SITE_DIR}/.secrets.sops.json.template"

needs_encrypt=false
if [[ ! -f "${SOPS_FILE}" ]]; then
  needs_encrypt=true
  echo ""
  echo "No .secrets.sops.json found — will create from template."
elif ! sops decrypt "${SOPS_FILE}" >/dev/null 2>&1; then
  needs_encrypt=true
  echo ""
  echo "Existing .secrets.sops.json can't be decrypted (wrong KMS keys) — will replace from template."
fi

if ${needs_encrypt} && [[ -f "${TEMPLATE_FILE}" ]]; then
  SECRETS_JSON="${SITE_DIR}/.secrets.json"
  if ${DRY_RUN}; then
    echo "[DRY RUN] Would encrypt template to .secrets.sops.json:"
    echo "  cp ${TEMPLATE_FILE} ${SECRETS_JSON}"
    echo "  sops encrypt ${SECRETS_JSON} > ${SOPS_FILE}"
    echo "  rm ${SECRETS_JSON}"
  else
    echo "Encrypting .secrets.sops.json from template..."
    cp "${TEMPLATE_FILE}" "${SECRETS_JSON}"
    # Write to temp file first — if sops fails, don't truncate the target
    SOPS_TMP="${SOPS_FILE}.tmp"
    sops encrypt "${SECRETS_JSON}" > "${SOPS_TMP}"
    mv "${SOPS_TMP}" "${SOPS_FILE}"
    rm "${SECRETS_JSON}"
    echo "  Done."
  fi
fi

## Step 7: Persist KMS key material for future shells and CI
##
## env.sh declares two vars that terraform interpolates into the IAM policies
## on the readonly / e2e / deploy roles (see site.hcl kms-sops-decrypt):
##
##   TF_VAR_SOPS_KMS_KEY_ID   — the SOPS multi-region CMK ID (single value)
##   TF_VAR_SSM_KMS_KEY_ARNS  — comma-separated ARNs for the per-purpose SSM
##                              CMKs (dc34-ssm, dc34-dynamodb-ssm,
##                              dc34-s3-uploads-ssm, dc34-email-ssm — per region)
##
## Without persistence, every fresh clone + every CI run resolves them to
## empty/placeholder values and (a) drifts live IAM policies back to the
## placeholder on `terragrunt apply`, (b) prevents the readonly PR-plan role
## from decrypting SOPS- or SSM-protected params.
##
## Resolve and write both to env.local.sh (gitignored) so `source env.sh` in
## a fresh shell picks them up. Print the operator-facing CI setup commands
## since workflows don't source env.local.sh.
LOCAL_ENV="${SCRIPT_DIR}/env.local.sh"

# --- SOPS key ID ---
RESOLVED_SOPS_KEY_ID=""
if ! ${DRY_RUN}; then
  RESOLVED_SOPS_KEY_ID=$(aws kms describe-key \
    --profile "${AWS_PROFILE}" \
    --region "${PRIMARY_REGION}" \
    --key-id "${ALIAS_NAME}" \
    --query "KeyMetadata.KeyId" \
    --output text 2>/dev/null) || true
fi

# --- SSM CMK ARNs (discover across all app regions) ---
# Match aliases like: alias/dc34-ssm-use1, alias/dc34-dynamodb-ssm-use1, etc.
# These are created by the terraform modules under infra/terraform/modules/
# {secrets,dynamodb,s3-uploads,email}/v1.0.0/kms.tf — one per region per module.
# If a module hasn't been applied yet in a region, it just won't have an alias
# there and this loop skips it silently.
RESOLVED_SSM_ARNS=""
if ! ${DRY_RUN}; then
  for region in "${PRIMARY_REGION}" "${REPLICA_REGIONS[@]}"; do
    region_aliases=$(aws kms list-aliases \
      --profile "${AWS_PROFILE}" \
      --region "${region}" \
      --query "Aliases[?starts_with(AliasName, 'alias/${PROFILE_PREFIX:-dc34}-') && contains(AliasName, 'ssm-')].TargetKeyId" \
      --output text 2>/dev/null) || true
    for key_id in ${region_aliases}; do
      [[ -z "${key_id}" || "${key_id}" == "None" ]] && continue
      arn="arn:aws:kms:${region}:${ACCOUNT_ID}:key/${key_id}"
      if [[ -n "${RESOLVED_SSM_ARNS}" ]]; then
        RESOLVED_SSM_ARNS="${RESOLVED_SSM_ARNS},"
      fi
      RESOLVED_SSM_ARNS="${RESOLVED_SSM_ARNS}${arn}"
    done
  done
fi

# --- Upsert helper ---
# $1 = env var name, $2 = value; upserts `export NAME="VALUE"` in $LOCAL_ENV.
upsert_env_var() {
  local name="$1"
  local value="$2"
  touch "${LOCAL_ENV}"
  if grep -q "^export ${name}=" "${LOCAL_ENV}" 2>/dev/null; then
    local tmp="${LOCAL_ENV}.tmp"
    # Portable sed: read → rewrite → atomic replace
    sed "s|^export ${name}=.*|export ${name}=\"${value}\"|" "${LOCAL_ENV}" > "${tmp}"
    mv "${tmp}" "${LOCAL_ENV}"
  else
    printf '\n# Written by env.sops.sh\nexport %s="%s"\n' "${name}" "${value}" >> "${LOCAL_ENV}"
  fi
}

echo ""
if ${DRY_RUN}; then
  echo "[DRY RUN] Would resolve TF_VAR_SOPS_KMS_KEY_ID via ${ALIAS_NAME} and persist to ${LOCAL_ENV}"
  echo "[DRY RUN] Would resolve TF_VAR_SSM_KMS_KEY_ARNS from dc34-* SSM aliases in all app regions and persist to ${LOCAL_ENV}"
  echo "[DRY RUN] Would print GitHub Actions repository-variable setup instructions"
else
  if [[ -n "${RESOLVED_SOPS_KEY_ID}" && "${RESOLVED_SOPS_KEY_ID}" != "None" ]]; then
    echo "Persisting TF_VAR_SOPS_KMS_KEY_ID=${RESOLVED_SOPS_KEY_ID} to ${LOCAL_ENV}..."
    upsert_env_var "TF_VAR_SOPS_KMS_KEY_ID" "${RESOLVED_SOPS_KEY_ID}"
  else
    echo "WARNING: could not resolve key ID for ${ALIAS_NAME} in ${PRIMARY_REGION}."
    echo "         TF_VAR_SOPS_KMS_KEY_ID was NOT persisted."
  fi

  if [[ -n "${RESOLVED_SSM_ARNS}" ]]; then
    echo "Persisting TF_VAR_SSM_KMS_KEY_ARNS to ${LOCAL_ENV}..."
    echo "  Discovered $(tr ',' '\n' <<<"${RESOLVED_SSM_ARNS}" | wc -l | tr -d ' ') SSM CMK(s)"
    upsert_env_var "TF_VAR_SSM_KMS_KEY_ARNS" "${RESOLVED_SSM_ARNS}"
  else
    echo "No dc34-* SSM CMK aliases found — skipping TF_VAR_SSM_KMS_KEY_ARNS."
    echo "  (They're created by the terraform modules under infra/terraform/modules/"
    echo "   {secrets,dynamodb,s3-uploads,email}/v1.0.0/kms.tf — apply those first,"
    echo "   then rerun this script to discover them.)"
  fi

  echo ""
  echo "=== CI setup required ==="
  echo "GitHub Actions workflows do NOT source env.local.sh."
  echo "Set both as repository variables so terragrunt plan/apply in CI resolves"
  echo "the correct values instead of the empty/placeholder defaults:"
  echo ""
  [[ -n "${RESOLVED_SOPS_KEY_ID}" && "${RESOLVED_SOPS_KEY_ID}" != "None" ]] && \
    echo "  gh variable set TF_VAR_SOPS_KMS_KEY_ID --body \"${RESOLVED_SOPS_KEY_ID}\""
  [[ -n "${RESOLVED_SSM_ARNS}" ]] && \
    echo "  gh variable set TF_VAR_SSM_KMS_KEY_ARNS --body \"${RESOLVED_SSM_ARNS}\""
  echo ""
  echo "Then reference in each workflow's job env:"
  echo "  env:"
  echo "    TF_VAR_SOPS_KMS_KEY_ID: \${{ vars.TF_VAR_SOPS_KMS_KEY_ID }}"
  echo "    TF_VAR_SSM_KMS_KEY_ARNS: \${{ vars.TF_VAR_SSM_KMS_KEY_ARNS }}"
fi
