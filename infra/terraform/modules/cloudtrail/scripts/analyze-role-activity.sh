#!/usr/bin/env bash
# =============================================================================
# analyze-role-activity.sh
# Analyze GitHub OIDC role activity and generate least-privilege policies
# =============================================================================

set -euo pipefail

SITE_LABEL="${SITE_LABEL:-dc34}"
DAYS="${DAYS:-30}"
ROLE_NAME="${1:-}"

usage() {
    cat <<EOF
Usage: $0 <role-name> [options]

Analyze GitHub OIDC role activity from CloudTrail and optionally generate
least-privilege policies using IAM Access Analyzer.

Arguments:
  role-name    Name of the role to analyze (e.g., terragrunt, application, deploy)

Environment Variables:
  SITE_LABEL   Site label prefix (default: dc34)
  DAYS         Number of days to analyze (default: 30)
  AWS_REGION   AWS region (default: us-east-1)

Examples:
  # Analyze terragrunt role activity
  $0 terragrunt

  # Analyze with 60 days of data
  DAYS=60 $0 application

  # Generate least-privilege policy
  $0 terragrunt --generate-policy

Available roles:
  terragrunt   - Infrastructure deployments (AdministratorAccess - NEEDS SCOPING)
  application  - App deployments (ECR, S3, ECS)
  readonly     - PR plan previews
  prowler      - Security scanning
  e2e          - E2E testing
  release      - Release workflow
  deploy       - Deploy workflow
EOF
    exit 1
}

[[ -z "$ROLE_NAME" ]] && usage

AWS_REGION="${AWS_REGION:-us-east-1}"
ROLE_ARN="arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/${SITE_LABEL}-github-${ROLE_NAME}"
TRAIL_ARN="arn:aws:cloudtrail:${AWS_REGION}:$(aws sts get-caller-identity --query Account --output text):trail/${SITE_LABEL}-cloudtrail"

echo "=============================================="
echo "Analyzing role: ${ROLE_ARN}"
echo "Trail: ${TRAIL_ARN}"
echo "Period: Last ${DAYS} days"
echo "=============================================="

# Check if Athena is available
WORKGROUP="${SITE_LABEL}-cloudtrail-analysis"
if ! aws athena get-work-group --work-group "$WORKGROUP" &>/dev/null; then
    echo "Warning: Athena workgroup '$WORKGROUP' not found. Using CloudTrail Insights instead."
    USE_ATHENA=false
else
    USE_ATHENA=true
fi

if [[ "$USE_ATHENA" == "true" ]]; then
    echo ""
    echo "Running Athena query for unique actions..."

    DATABASE="${SITE_LABEL//-/_}_cloudtrail"

    QUERY=$(cat <<EOF
SELECT
    eventsource,
    eventname,
    COUNT(*) as call_count,
    COUNT(CASE WHEN errorcode IS NOT NULL THEN 1 END) as error_count
FROM ${DATABASE}.cloudtrail_logs
WHERE useridentity.type = 'AssumedRole'
    AND useridentity.sessioncontext.sessionissuer.arn = '${ROLE_ARN}'
    AND date >= date_format(current_date - interval '${DAYS}' day, '%Y/%m/%d')
GROUP BY eventsource, eventname
ORDER BY eventsource, eventname
EOF
)

    # Start query
    EXECUTION_ID=$(aws athena start-query-execution \
        --query-string "$QUERY" \
        --work-group "$WORKGROUP" \
        --query 'QueryExecutionId' \
        --output text)

    echo "Query execution ID: $EXECUTION_ID"

    # Wait for completion
    while true; do
        STATUS=$(aws athena get-query-execution \
            --query-execution-id "$EXECUTION_ID" \
            --query 'QueryExecution.Status.State' \
            --output text)

        case "$STATUS" in
            SUCCEEDED)
                echo "Query completed successfully!"
                break
                ;;
            FAILED|CANCELLED)
                echo "Query failed with status: $STATUS"
                aws athena get-query-execution \
                    --query-execution-id "$EXECUTION_ID" \
                    --query 'QueryExecution.Status.StateChangeReason' \
                    --output text
                exit 1
                ;;
            *)
                echo -n "."
                sleep 2
                ;;
        esac
    done

    echo ""
    echo "=============================================="
    echo "Actions used by ${ROLE_NAME} role:"
    echo "=============================================="

    aws athena get-query-results \
        --query-execution-id "$EXECUTION_ID" \
        --query 'ResultSet.Rows[1:].Data[*].VarCharValue' \
        --output table
fi

# Check for policy generation request
if [[ "${2:-}" == "--generate-policy" ]]; then
    echo ""
    echo "=============================================="
    echo "Starting IAM Access Analyzer policy generation..."
    echo "=============================================="

    START_TIME=$(date -d "${DAYS} days ago" -Iseconds 2>/dev/null || date -v-${DAYS}d -Iseconds)
    END_TIME=$(date -Iseconds)

    JOB_ID=$(aws accessanalyzer start-policy-generation \
        --policy-generation-details "{\"principalArn\": \"${ROLE_ARN}\"}" \
        --cloud-trail-details "{
            \"trails\": [{\"cloudTrailArn\": \"${TRAIL_ARN}\", \"allRegions\": true}],
            \"startTime\": \"${START_TIME}\",
            \"endTime\": \"${END_TIME}\"
        }" \
        --query 'jobId' \
        --output text)

    echo "Policy generation job ID: $JOB_ID"
    echo "Waiting for policy generation to complete..."

    while true; do
        STATUS=$(aws accessanalyzer get-generated-policy \
            --job-id "$JOB_ID" \
            --query 'jobDetails.status' \
            --output text)

        case "$STATUS" in
            SUCCEEDED)
                echo "Policy generation completed!"
                break
                ;;
            FAILED|CANCELED)
                echo "Policy generation failed with status: $STATUS"
                exit 1
                ;;
            *)
                echo -n "."
                sleep 5
                ;;
        esac
    done

    echo ""
    echo "=============================================="
    echo "Generated Policy:"
    echo "=============================================="

    aws accessanalyzer get-generated-policy \
        --job-id "$JOB_ID" \
        --query 'generatedPolicyResult.generatedPolicies[*].policy' \
        --output text | jq .

    echo ""
    echo "To save to a file:"
    echo "  aws accessanalyzer get-generated-policy --job-id $JOB_ID --query 'generatedPolicyResult.generatedPolicies[*].policy' --output text | jq . > ${ROLE_NAME}-policy.json"
fi

echo ""
echo "=============================================="
echo "Next Steps:"
echo "=============================================="
cat <<EOF
1. Review the actions above to understand what the ${ROLE_NAME} role actually uses

2. Generate a least-privilege policy:
   $0 ${ROLE_NAME} --generate-policy

3. Or use AWS Console:
   - Go to IAM → Access Analyzer → Policy generation
   - Select role: ${ROLE_ARN}
   - Set CloudTrail: ${TRAIL_ARN}
   - Review and download the generated policy

4. Update infra/terraform/live/site/site.hcl with the scoped-down policy
   Replace the current policy_arns/inline_policies for the ${ROLE_NAME} role

5. Test in a separate branch before merging to main
EOF
