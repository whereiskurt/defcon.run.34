"""Ghost guardrail sidecar (transformers-direct).

Two-sided moderation for the ghost chatbots, exposing a stable /guard contract so
meshtk (internal/app/fleet/guard.go) depends on OUR endpoint, not any framework's
API. Open models loaded directly via transformers (no gated weights, no Guardrails
Hub post-install machinery — which broke against the pinned huggingface_hub's
strict model-config validation).

- input  guard: prompt-injection / jailbreak classifier.
- output guard: toxicity classifier + regex PII (email / phone / credit-card).

The deterministic covert-flag reveal is filled server-side in meshtk and is NEVER
sent here, so the output PII check cannot eat a flag code.

Contract (called by meshtk):
  POST /guard  {"text": "...", "direction": "input"|"output"}
    -> 200 {"allowed": bool, "reason": str}
  GET  /healthz -> {"ok": true}
"""

import re

from fastapi import FastAPI
from pydantic import BaseModel
from transformers import pipeline

INJECTION_MODEL = "protectai/deberta-v3-base-prompt-injection-v2"
TOXICITY_MODEL = "unitary/toxic-bert"
INJECTION_THRESHOLD = 0.8
TOXICITY_THRESHOLD = 0.8

app = FastAPI()

# Loaded once at process start (weights baked into the image at build time).
_injection = pipeline("text-classification", model=INJECTION_MODEL, truncation=True)
_toxicity = pipeline(
    "text-classification", model=TOXICITY_MODEL, top_k=None, truncation=True
)

# Deliberately narrow PII set — hacker-culture chat is expected; we only guard
# real-person contact/financial data. No blanket "illicit-activity" check (spec 6.3).
PII_PATTERNS = {
    "EMAIL": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    "PHONE": re.compile(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"),
    "CREDIT_CARD": re.compile(r"\b(?:\d[ -]?){13,16}\b"),
}


class GuardReq(BaseModel):
    text: str
    direction: str  # "input" | "output"


@app.get("/healthz")
def healthz():
    return {"ok": True}


def _flatten(result):
    # transformers may return [{...}] or [[{...}]] depending on top_k/version.
    if result and isinstance(result[0], list):
        return result[0]
    return result


def _check_injection(text: str):
    for r in _flatten(_injection(text)):
        if r["label"].upper().startswith("INJECT") and r["score"] >= INJECTION_THRESHOLD:
            return f"injection:{r['score']:.2f}"
    return None


def _check_output(text: str):
    for r in _flatten(_toxicity(text)):
        if r["score"] >= TOXICITY_THRESHOLD:
            return f"toxic:{r['label']}:{r['score']:.2f}"
    for name, pat in PII_PATTERNS.items():
        if pat.search(text):
            return f"pii:{name}"
    return None


@app.post("/guard")
def guard(req: GuardReq):
    reason = _check_injection(req.text) if req.direction == "input" else _check_output(req.text)
    return {"allowed": reason is None, "reason": reason or ""}
