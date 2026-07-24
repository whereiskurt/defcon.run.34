"""Ghost guardrail sidecar.

A thin FastAPI wrapper around Guardrails-AI Guard objects so meshtk depends on a
stable /guard contract rather than the evolving Guardrails server API. Two guards:
- input:  catch jailbreak / prompt-injection attempts.
- output: block toxic replies and flag/redact real-person PII.

The deterministic covert-flag reveal is filled server-side in meshtk and is NEVER
sent here, so the output PII validator cannot eat a flag code.

Contract (called by meshtk internal/app/fleet/guard.go):
  POST /guard  {"text": "...", "direction": "input"|"output"}
    -> 200 {"allowed": bool, "reason": str}
  GET  /healthz -> {"ok": true}
"""

from fastapi import FastAPI
from pydantic import BaseModel
from guardrails import Guard
from guardrails.hub import DetectJailbreak, ToxicLanguage, DetectPII

app = FastAPI()

# Input guard: catch jailbreak / prompt-injection attempts.
INPUT_GUARD = Guard().use(DetectJailbreak, on_fail="exception")

# Output guard: block toxic replies and flag real-person PII. Deliberately no
# blanket "illicit-activity" validator — the personas are hacker-culture figures
# and are expected to discuss 2600, phreaking, exploits (spec 6.3).
OUTPUT_GUARD = (
    Guard()
    .use(ToxicLanguage, threshold=0.8, on_fail="exception")
    .use(DetectPII, ["EMAIL_ADDRESS", "PHONE_NUMBER", "CREDIT_CARD"], on_fail="exception")
)


class GuardReq(BaseModel):
    text: str
    direction: str  # "input" | "output"


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.post("/guard")
def guard(req: GuardReq):
    g = INPUT_GUARD if req.direction == "input" else OUTPUT_GUARD
    try:
        g.validate(req.text)
        return {"allowed": True, "reason": ""}
    except Exception as e:  # validation failure -> block
        return {"allowed": False, "reason": type(e).__name__}
