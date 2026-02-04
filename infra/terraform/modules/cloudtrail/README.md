# CloudTrail Module for IAM Policy Generation

Records all AWS API activity to enable least-privilege policy generation for GitHub OIDC roles.

## Quick Start

### Deploy CloudTrail

```bash
cd infra/terraform/live/site/global/cloudtrail
terragrunt apply
```

Then deploy remaining infrastructure - CloudTrail will capture all API calls.

### Capture Zero-to-Deployed (Fresh Environment)

For capturing a complete deployment from scratch, use `iamlive`:

```bash
# Install iamlive
brew install iann0036/iamlive/iamlive

# Capture full deployment
cd infra/terraform/live/site
../modules/cloudtrail/scripts/capture-deployment.sh terragrunt run-all apply --auto-approve
```

This generates a policy file showing exactly what permissions the terragrunt role needs.

## Approaches for Policy Generation

### Approach 1: CloudTrail + Access Analyzer (Ongoing)

Best for: Continuous monitoring of production workflows

1. Deploy CloudTrail first (already set as dependency for other modules)
2. Run GitHub Actions workflows for 30+ days
3. Use Access Analyzer to generate policies:

```bash
./scripts/analyze-role-activity.sh terragrunt --generate-policy
```

### Approach 2: iamlive (One-time Capture)

Best for: Capturing a fresh deployment or testing policy changes

```bash
# Capture a plan (read-only permissions)
./scripts/capture-deployment.sh readonly run-all plan

# Capture full apply (all permissions)
./scripts/capture-deployment.sh terragrunt run-all apply --auto-approve
```

### Approach 3: Combined (Recommended)

1. Use `iamlive` to capture a fresh deployment → baseline policy
2. Deploy CloudTrail to monitor ongoing activity
3. After 30 days, use Access Analyzer to refine policies
4. Compare iamlive baseline with Access Analyzer output

## Athena Queries

Pre-built queries are stored in SSM Parameter Store:

```bash
# List queries
aws ssm get-parameters-by-path --path "/<site_label>/cloudtrail/queries" --query 'Parameters[*].Name'

# Run a query
QUERY=$(aws ssm get-parameter --name "/<site_label>/cloudtrail/queries/github-roles-summary" --query 'Parameter.Value' --output text)
aws athena start-query-execution --query-string "$QUERY" --work-group <site_label>-cloudtrail-analysis
```

### Example: Find All Actions by Terragrunt Role

```sql
SELECT
    eventsource,
    eventname,
    COUNT(*) as call_count
FROM <site_label>_cloudtrail.cloudtrail_logs
WHERE useridentity.sessioncontext.sessionissuer.arn
    LIKE '%<site_label>-github-terragrunt%'
    AND date >= date_format(current_date - interval '30' day, '%Y/%m/%d')
GROUP BY eventsource, eventname
ORDER BY eventsource, eventname;
```

## Module Outputs

| Output | Description |
|--------|-------------|
| `trail_arn` | CloudTrail trail ARN |
| `logs_bucket_name` | S3 bucket storing logs |
| `access_analyzer_arn` | IAM Access Analyzer ARN |
| `athena_workgroup` | Athena workgroup name |
| `athena_database` | Glue database name |
| `query_ssm_parameters` | SSM paths for query templates |

## Configuration (site.hcl)

```hcl
cloudtrail = {
  enabled = true
  multi_region = true              # Capture all regions
  log_retention_days = 90          # Keep logs for policy analysis
  glacier_transition_days = 0      # 0 = disabled, 30+ for cost savings
  enable_access_analyzer = true    # Generate policies from logs
  enable_athena = true             # SQL queries on logs

  # Roles to monitor (all GitHub OIDC roles)
  monitor_roles = [
    "terragrunt",
    "application",
    "readonly",
    "prowler",
    "e2e",
    "release",
    "deploy"
  ]
}
```

## Cost Considerations

- **CloudTrail**: ~$2/100k management events
- **S3 Storage**: ~$0.023/GB/month (logs compress well)
- **Athena**: $5/TB scanned (partition pruning helps)
- **Access Analyzer**: Free

For a typical deployment, expect $5-20/month.
