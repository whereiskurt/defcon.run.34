# A stable facade over a churny dependency

**Wrap a volatile third-party thing — an ML framework, a security vendor's API, a
provider whose SDK breaks on its own schedule — behind your own minimal, stable
contract, so the rest of your system depends on your endpoint, not theirs. When the
dependency lurches, you swap the implementation behind the facade instead of
firefighting a system-wide outage.**

## Context

Some dependencies are load-bearing and unstable at the same time. An ML framework
with a fast-moving Hub and post-install machinery that assumes network access and
un-pinned transitive versions. A security vendor whose gateway you route production
traffic through, reached by an SDK that changes shape release to release. A managed
provider whose resources you're pulling into declarative infrastructure. You need
what they do, but you can't let their release cadence — or their outage — become
yours.

The naive integration threads the vendor's SDK, model, or API directly through your
call sites. Every module that touches the capability now imports the volatile thing,
so its next breaking change is a breaking change everywhere at once, and there's no
single place to absorb it.

## Forces

- **The capability is essential; the vendor's interface is not.** You need the guard,
  the classification, the gateway. You do *not* need their exact function signatures
  reaching into a dozen of your files.
- **Their machinery breaks against your pins.** Frameworks that download configs at
  runtime, validate model metadata strictly, or run post-install hooks will fail in
  ways you don't control — a strict validator rejecting a config that worked last week,
  a Hub outage, a transitive version bump. The convenient path is the fragile path.
- **Your backends should be interchangeable.** If a facade fronts the capability, you
  can swap the model, the provider, or the whole implementation without the callers
  noticing. Direct coupling forecloses that.
- **The blast radius should be one file, not the system.** When the dependency lurches,
  you want exactly one place to fix.

## The pattern

Define the smallest contract that expresses what you actually need, put it in front of
the volatile dependency, and make everything else depend on the contract.

```
  YOUR SYSTEM  ──depends on──▶  YOUR STABLE CONTRACT   e.g. POST /guard {text,dir}
                                        │                   → {allowed, reason}
                                        ▼
                                  FACADE / SIDECAR      (the ONE place that knows
                                        │                the vendor)
                                        ▼
                                VOLATILE DEPENDENCY      framework / vendor API /
                                                         provider — swappable
```

- **Publish a minimal contract you own.** Two endpoints, a couple of fields — the least
  surface that covers the need. Callers code to *this*, forever, regardless of what's
  behind it.
- **Isolate the vendor to one implementation.** A sidecar process, an adapter module —
  one place imports the framework or calls the vendor. Its churn stops there.
- **Deliberately avoid the fragile convenience path.** If the framework's post-install or
  Hub machinery is what breaks against your pins, don't use it. Load open model weights
  directly at build time and bake them into the image; skip the runtime download and the
  strict-validation dance entirely. The facade is where you get to make that call once.
- **Swap implementations without touching callers.** Backup provider, different model,
  new vendor — the contract holds, so the change is invisible upstream. A vendor SDK
  breaking your build goes from a system-wide outage to a swap behind a facade you
  control.

### Companion rule: keep secrets out of the redaction path

A facade that does moderation or PII scrubbing introduces a subtle ordering hazard: if a
secret you must reveal passes *through* the scrubber, the scrubber may eat it — a
credit-card regex will happily redact a flag code that looks numeric. The rule is to keep
the sensitive value out of that path entirely: inject it **downstream** of the scrubber,
on its own send path, so the scrubber can never see it and can never mangle it. Order the
pipeline so the redactor only ever handles content that is *supposed* to be redactable.

### Related infrastructure move: import, don't recreate

When the volatile thing is a *managed resource* you're adopting into declarative
infrastructure (a gateway binding, a rule, a distribution someone created in a console),
**import** it into your state rather than destroying and recreating it. Recreation risks
downtime, name collisions, and losing configuration the console captured that your code
doesn't yet express. Importing keeps the working resource and puts a stable declarative
handle in front of it — the same "front the volatile thing with something you control"
move, in infrastructure form.

## Key moves

- **The contract is the product; the vendor is an implementation detail.** Design the
  smallest interface that meets the need and make it the thing your system depends on.
- **One place knows the vendor.** Sidecar or adapter — the churn is quarantined to a single
  swappable unit.
- **Reject the fragile convenience.** Bake weights at build time instead of downloading at
  runtime; skip post-install hooks that assume network and loose pins. Trade a little
  convenience for a lot of stability.
- **Inject secrets downstream of any scrubber.** Never route a value that must survive
  through a redactor that might remove it.
- **Import externally-created resources; don't recreate them.** Preserve the working thing;
  wrap it in your declarative state.

## Traps

- **Letting the vendor's types leak through the facade.** If your "stable contract" passes
  the vendor's own objects around, it isn't a facade — the coupling just moved. The contract
  must be expressed entirely in your own terms.
- **A facade so thin it's a straight passthrough.** If the contract mirrors the vendor's API
  one-to-one, a vendor change still forces a contract change. The facade earns its keep by
  being *narrower and more stable* than what it fronts.
- **Routing a secret through the redactor.** The most reusable trap here: a PII scrubber that
  eats a legitimate secret because the secret was placed upstream of it. Inject downstream.
- **Recreating a managed resource "to bring it under code."** A destroy/recreate to adopt a
  console-made resource can drop config and cause an outage. Import it in place.
- **Pinning nothing behind the facade.** The facade lets you *control* the dependency; it
  doesn't pin it for you. Still pin versions and bake artifacts inside the isolated unit.

## When not to use it

- If the dependency is genuinely stable and well-versioned, a facade is indirection for its
  own sake — depend on it directly.
- If you use the capability in exactly one place, that place *is* your isolation boundary;
  a separate facade adds a hop for nothing.
- If the vendor's interface is already the minimal, stable contract you'd have designed
  anyway, wrapping it duplicates it.

## As built (defcon.run 34)

- **Sidecar facade over a churny ML framework:** `apps/run.mqtt/guardrails/app.py` — a
  two-endpoint `/guard` contract (`{text, direction}` in, `{allowed, reason}` out) that the
  Go fleet code depends on instead of any framework's API. It loads open model weights
  directly via `transformers` and bakes them into the image at build time, deliberately
  avoiding the Guardrails Hub post-install machinery that broke against the pinned
  `huggingface_hub`'s strict model-config validation. The header notes the companion rule:
  the deterministic flag reveal is filled downstream in the fleet code and is never sent to
  the guard, so the PII check cannot eat a flag code.
- **Import-don't-recreate for a managed security provider:**
  `infra/terraform/modules/impart/v1.0.0/main.tf` — the scaffold for the Impart Security
  gateway provider, with the two console-created bindings marked to be `terraform import`ed,
  not recreated, and rules exported as committed recipe JSON rather than rebuilt.
- Realized on a FastAPI sidecar co-located in the same task as the caller, open-weights
  classifiers baked into the image, and a Terraform provider fronting an external security
  gateway.
