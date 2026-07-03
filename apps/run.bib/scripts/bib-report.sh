#!/usr/bin/env bash
#
# bib-report.sh — admin read-only reports over the run.bib DynamoDB data.
#
# Scans the shared electro table (Bib / GeneralDonation / BibReconcile rows,
# tagged by ElectroDB's __edb_e__ attribute) and prints:
#   1. Bibs        — runnerCode, name, $ paid, in-person pledge, #payments
#   2. Donations   — date, $, provider, owner, reconciledVia
#   3. Reconcile   — the Venmo/CashApp ledger; UNMATCHED/AMBIGUOUS = pending
#   4. Totals      — counts + $ sums + pending count
#
# Read-only (Scan + no writes). Run with an admin profile that has DynamoDB
# read on the app account (e.g. dc34-application):
#   AWS_PROFILE=dc34-application ./bib-report.sh
# Optional env: TABLE (default run-human-electro), AWS_REGION (default us-east-1).
set -euo pipefail

TABLE="${TABLE:-run-human-electro}"
REGION="${AWS_REGION:-us-east-1}"

echo "Scanning ${TABLE} (${REGION})…" >&2
SCAN_JSON="$(mktemp)"
trap 'rm -f "$SCAN_JSON"' EXIT
# aws cli auto-paginates scan; capture to a file so the heredoc below can be
# the python PROGRAM (stdin) while the scan is read from the file (argv).
aws dynamodb scan --table-name "$TABLE" --region "$REGION" --output json > "$SCAN_JSON"

python3 - "$SCAN_JSON" <<'PY'
import sys, json

def unwrap(v):
    if not isinstance(v, dict) or len(v) != 1:
        return v
    (t, x), = v.items()
    if t == "S": return x
    if t == "N": return float(x) if ("." in x or "e" in x.lower()) else int(x)
    if t == "BOOL": return x
    if t == "NULL": return None
    if t == "L": return [unwrap(e) for e in x]
    if t == "M": return {k: unwrap(e) for k, e in x.items()}
    if t in ("SS", "NS"): return list(x)
    return x

data = json.load(open(sys.argv[1]))
items = [{k: unwrap(v) for k, v in it.items()} for it in data.get("Items", [])]
by = {}
for it in items:
    by.setdefault(it.get("__edb_e__", "?"), []).append(it)

def usd(cents): return f"${(cents or 0)/100:,.2f}"
def row(*cols, w=(14, 26, 12, 10, 10)):
    print("  " + "".join(str(c)[: w[i] - 1].ljust(w[i]) for i, c in enumerate(cols)))

# 1. Bibs
bibs = by.get("Bib", [])
print(f"\n=== BIBS ({len(bibs)}) ===")
row("runnerCode", "name", "paid", "inPerson", "#pays")
bib_total = 0
for b in sorted(bibs, key=lambda x: -(x.get("paidAmount") or 0)):
    bib_total += b.get("paidAmount") or 0
    row(b.get("runnerCode", ""), b.get("nameOnBib", "") or "—",
        usd(b.get("paidAmount")), "yes" if b.get("willPayInPerson") else "",
        len(b.get("paidStatusHistory") or []))

# 2. Donations
dons = by.get("GeneralDonation", [])
print(f"\n=== DONATIONS ({len(dons)}) ===")
row("date", "amount", "provider", "owner", "via", w=(22, 12, 10, 16, 24))
don_total = 0
for d in sorted(dons, key=lambda x: x.get("createdAt", "")):
    don_total += d.get("amountCents") or 0
    row((d.get("createdAt", "") or "")[:19], usd(d.get("amountCents")),
        d.get("provider", ""), (d.get("ownerSub") or "—")[:15],
        d.get("reconciledVia", ""), w=(22, 12, 10, 16, 24))

# 3. Reconciliation ledger (pending = not matched)
rec = by.get("BibReconcile", [])
pending = [r for r in rec if r.get("status") != "matched"]
print(f"\n=== RECONCILE LEDGER ({len(rec)}; {len(pending)} pending) ===")
row("status", "provider", "amount", "sender", "receipt", w=(12, 10, 12, 22, 20))
for r in sorted(rec, key=lambda x: x.get("status", "")):
    row(r.get("status", ""), r.get("provider", ""), usd(r.get("amount")),
        (r.get("extractedSenderName") or "—")[:20],
        (r.get("receiptId") or "")[:18], w=(12, 10, 12, 22, 20))

# 4. Pending intents (user tapped Venmo/CashApp; awaiting organizer reconcile)
pend = by.get("PendingContribution", [])
print(f"\n=== PENDING INTENTS ({len(pend)}) ===")
row("kind", "provider", "amount", "runnerCode", "created", w=(10, 10, 12, 14, 22))
for p in sorted(pend, key=lambda x: x.get("createdAt", ""), reverse=True):
    row(p.get("kind", ""), p.get("provider", ""), usd(p.get("amountCents")),
        p.get("runnerCode", "") or "—",
        (p.get("createdAt") or "")[:19], w=(10, 10, 12, 14, 22))

# 5. Totals
print("\n=== TOTALS ===")
print(f"  Bibs:            {len(bibs)}  (in-person pledges: "
      f"{sum(1 for b in bibs if b.get('willPayInPerson'))})")
print(f"  Bib $ collected: {usd(bib_total)}")
print(f"  Donations:       {len(dons)}  =  {usd(don_total)}")
print(f"  Grand total $:   {usd(bib_total + don_total)}")
print(f"  Pending recon.:  {len(pending)}  (ledger)   "
      f"{len(pend)}  (user intents)")
PY
