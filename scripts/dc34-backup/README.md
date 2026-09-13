# DC34 backup + restore

Everything DEF CON 34 produced that is not reproducible from git, snapshotted to
**`s3://defcon.run.34.backup`** so the infrastructure can be destroyed. The bucket
is created by the script, **outside Terraform**, so `terragrunt destroy` cannot
touch it. Same shape as `s3://defcon.run.33.backup` (which `scripts/dc34-stats`
already reads for the year-over-year compare).

```bash
aws sso login --profile dc34-application
scripts/dc34-backup/snapshot.sh --dry-run   # show the plan
scripts/dc34-backup/snapshot.sh             # ~5-10 min, mostly waiting on DDB exports
```

| Backed up | Where in the bucket | How |
|---|---|---|
| 6 DDB tables (`run-{auth,human,gpx,quota}-*`) | `ddb/<table>/AWSDynamoDB/<exportId>/` + `schema.json` + `LATEST` | native point-in-time export, `DYNAMODB_JSON` |
| GPX uploads, CMS media, **CMS litestream** (the Strapi SQLite DB), SES inbox, redirect pages, status site | `s3/<source-bucket>/` | `aws s3 sync` |
| ~190 SSM params (all of `/dc34/*` + `/defcon.run/*`; the hand-set Stripe/OIDC/Strava secrets are the ones that matter) | `ssm/<stamp>.secrets.sops.json` | decrypted, then sops-encrypted with the account `alias/sops` KMS key |
| Run record | `snapshots/<stamp>/MANIFEST.json`, `LATEST` | counts + export ids |

**Deliberately not backed up:** `cf-assets-*` (rebuilt from the images), `logs-*`
(ALB/CF/NLB access logs), `mqtt-logs`, `abuse-detection` (empty), the `User` table
(a 2024 DC32 relic — not in this Terraform, deletion-protected, left alone).

Verify a run: `MANIFEST.json` shows `exportedItems` per table against the
`describeTableItemCount` (that one is DynamoDB's ~6-hourly estimate, so small
drift is normal; a large gap or a `FAILED` status is not).

## Restore

### A. Look at the data locally (the dev/review case)

```bash
cd apps/local/dynamodb && docker compose up -d       # local DDB on :8888, in-memory
scripts/dc34-backup/restore_local.py --all           # or name one table
```

Tables are created from `schema.json` with prod names, so each app's local
`.env` pointed at `http://localhost:8888` sees DC34 data as-is. Restart the
container to wipe it. `--export-id <id>` picks an older export.

### B. Bring a table back into AWS

DynamoDB import creates a **new** table; it cannot load into an existing one.

```bash
aws dynamodb import-table --region us-east-1 \
  --s3-bucket-source S3Bucket=defcon.run.34.backup,S3KeyPrefix=ddb/run-human-electro/AWSDynamoDB/<exportId>/data/ \
  --input-format DYNAMODB_JSON --input-compression-type GZIP \
  --table-creation-parameters "$(aws s3 cp s3://defcon.run.34.backup/ddb/run-human-electro/schema.json - \
      | jq '{TableName, KeySchema, AttributeDefinitions, BillingMode:"PAY_PER_REQUEST",
             GlobalSecondaryIndexes:[.GlobalSecondaryIndexes[]?|{IndexName,KeySchema,Projection}]}')"
```

If Terraform is going to own the table again, create it via Terragrunt first and
then load with `restore_local.py`'s approach pointed at the real endpoint — or
import under a temporary name and copy.

### C. S3 objects

```bash
aws s3 sync s3://defcon.run.34.backup/s3/uploads-dc34-run-gpx-use1-80a6b349 s3://<new-bucket>
```

The CMS database lives in the litestream bucket two ways. Easiest: the plain SQLite
snapshots under `cms-backups/strapi-<date>.db` — copy one down and point Strapi at it.
The live replica is `strapi/` (Litestream `.ltx` generations):
`litestream restore -o strapi.db s3://defcon.run.34.backup/s3/uploads-dc34-cms-litestream-use1-80a6b349/strapi`
(use the same Litestream major version the container ran — see `apps/run.cms/app/litestream-sync.sh`).

### D. Secrets

```bash
aws s3 cp s3://defcon.run.34.backup/ssm/<stamp>.secrets.sops.json - | sops --decrypt --input-type json --output-type json /dev/stdin
```

Decryption needs the `alias/sops` KMS key in account 427284555693 — it is
account-level and survives the teardown. Do not delete that key.
