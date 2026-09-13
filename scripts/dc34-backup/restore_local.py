#!/usr/bin/env python3
"""Load a DC34 DynamoDB export from s3://defcon.run.34.backup into local DynamoDB.

    apps/local/dynamodb: docker compose up -d          # port 8888, in-memory
    scripts/dc34-backup/restore_local.py run-human-electro
    scripts/dc34-backup/restore_local.py --all

Creates the table from the saved schema.json (same name as prod, so the apps'
local .env just works), then batch-writes every item from the newest export
(ddb/<table>/LATEST). Pass --export-id to pick an older one. The local DB is
in-memory by design: restart the container = clean slate.

Needs only the aws CLI (logged in to dc34-application) — no boto3.
"""
import argparse, gzip, json, os, subprocess, sys, tempfile

BUCKET = "defcon.run.34.backup"
TABLES = ["run-auth-authjs", "run-auth-electro", "run-gpx-electro",
          "run-human-authjs", "run-human-electro", "run-quota-electro"]
LOCAL_ENV = {k: v for k, v in os.environ.items() if k != "AWS_PROFILE"}
LOCAL_ENV.update(AWS_ACCESS_KEY_ID="local", AWS_SECRET_ACCESS_KEY="local", AWS_DEFAULT_REGION="us-east-1")

def aws(*args, env=None, inp=None):
    r = subprocess.run(["aws", *args], capture_output=True, text=True, input=inp, env=env)
    if r.returncode: sys.exit(f"aws {' '.join(args[:3])} failed:\n{r.stderr.strip()}")
    return r.stdout

def s3_get(key, dest): aws("s3", "cp", f"s3://{BUCKET}/{key}", dest, "--quiet")

def local(endpoint, *args, inp=None):
    return aws("dynamodb", *args, "--endpoint-url", endpoint, env=LOCAL_ENV, inp=inp)

def create_table(endpoint, schema):
    # Strip the read-only fields describe-table returns; everything else is what create-table wants.
    spec = {"TableName": schema["TableName"], "KeySchema": schema["KeySchema"],
            "AttributeDefinitions": schema["AttributeDefinitions"], "BillingMode": "PAY_PER_REQUEST"}
    gsis = [{"IndexName": g["IndexName"], "KeySchema": g["KeySchema"], "Projection": g["Projection"]}
            for g in schema.get("GlobalSecondaryIndexes", [])]
    if gsis: spec["GlobalSecondaryIndexes"] = gsis
    existing = json.loads(local(endpoint, "list-tables"))["TableNames"]
    if spec["TableName"] in existing:
        print(f"  {spec['TableName']}: exists locally, deleting first")
        local(endpoint, "delete-table", "--table-name", spec["TableName"])
    local(endpoint, "create-table", "--cli-input-json", json.dumps(spec))

def load_items(endpoint, table, data_files):
    items, n = [], 0
    def flush():
        nonlocal items, n
        if not items: return
        req = {table: [{"PutRequest": {"Item": it}} for it in items]}
        out = json.loads(local(endpoint, "batch-write-item", "--request-items", json.dumps(req)))
        unp = out.get("UnprocessedItems", {}).get(table, [])
        if unp: sys.exit(f"{len(unp)} unprocessed items for {table}; local DDB should never throttle")
        n += len(items); items = []
    for f in data_files:
        with gzip.open(f, "rt") as fh:
            for line in fh:
                items.append(json.loads(line)["Item"])
                if len(items) == 25: flush()
    flush()
    return n

def restore(table, endpoint, export_id):
    with tempfile.TemporaryDirectory() as tmp:
        s3_get(f"ddb/{table}/schema.json", f"{tmp}/schema.json")
        if not export_id:
            s3_get(f"ddb/{table}/LATEST", f"{tmp}/LATEST")
            export_id = open(f"{tmp}/LATEST").read().strip()
        prefix = f"ddb/{table}/AWSDynamoDB/{export_id}/"
        s3_get(f"{prefix}manifest-summary.json", f"{tmp}/summary.json")
        expected = json.load(open(f"{tmp}/summary.json"))["itemCount"]
        aws("s3", "cp", f"s3://{BUCKET}/{prefix}data/", f"{tmp}/data/", "--recursive", "--quiet")
        files = sorted(f"{tmp}/data/{f}" for f in os.listdir(f"{tmp}/data") if f.endswith(".json.gz"))
        print(f"{table}: export {export_id}, {expected} items in {len(files)} files")
        create_table(endpoint, json.load(open(f"{tmp}/schema.json")))
        n = load_items(endpoint, table, files)
        status = "OK" if n == expected else "MISMATCH"
        print(f"  loaded {n}/{expected} -> {status}")
        return n == expected

if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("tables", nargs="*", help=f"one or more of {TABLES}")
    p.add_argument("--all", action="store_true")
    p.add_argument("--endpoint", default="http://localhost:8888")
    p.add_argument("--export-id", help="use a specific export instead of LATEST (single table only)")
    a = p.parse_args()
    tables = TABLES if a.all else a.tables
    if not tables: p.error("name a table or pass --all")
    if a.export_id and len(tables) != 1: p.error("--export-id needs exactly one table")
    ok = all([restore(t, a.endpoint, a.export_id) for t in tables])
    sys.exit(0 if ok else 1)
