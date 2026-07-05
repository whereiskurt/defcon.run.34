---
phase: 36-runtime-copy-toolkit
plan: 02
subsystem: ui
tags: [copy-catalog, xss, security, inline-markdown, react, vitest, run.bib]

# Dependency graph
requires:
  - phase: 36-runtime-copy-toolkit
    plan: 01
    provides: "copy-core t/interpolate resolves a copy value to a plain string; renderCopy is the safe render step for that string"
provides:
  - "renderCopy(value): pure string -> React.ReactNode escape-first, whitelist-second inline renderer (bold/italic/link/br)"
  - "The phase's XSS containment for editor-controlled copy: no raw-HTML injection, http/https/mailto link allowlist"
affects: [37-bib-donate-sponsor-proof, 38-custom-copy-admin, copy-provider, useCopy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Safe-by-construction inline markdown: return React text/element NODES (React escapes text children) — never build an HTML string, never dangerouslySetInnerHTML"
    - "Single ordered regex pass (bold before italic) tokenises the RAW string; non-token runs become escaped React text children"
    - "Link URL scheme allowlist via a leading-scheme regex; unsafe scheme drops the href and keeps the label as inert text"

key-files:
  created:
    - apps/run.bib/webapp/src/lib/copy-markdown.tsx
    - apps/run.bib/webapp/src/__tests__/copy-markdown.test.tsx
  modified: []

key-decisions:
  - "Relied on React text-node escaping rather than a manual escape() helper: since renderCopy returns React nodes (not an HTML string), React escapes every text child on render — a manual pre-escape would DOUBLE-escape (& -> &amp; -> &amp;amp;). The 'escape-first' invariant is satisfied structurally: anything not matched as a whitelisted token becomes an escaped text node."
  - "Schemeless/relative link URLs are treated as UNSAFE (label rendered as plain text), not allowed through — the allowlist is explicit http/https/mailto only, so no ambiguous relative-URL surface exists in copy links."
  - "Reworded a doc-comment mention of the raw-HTML injection prop so the plan's grep gate (which does not filter block comments) reads a true 0 — the gate proves the code contains no such call, and the comment must not create a false positive."

requirements-completed: [TOOL-05]

coverage:
  - id: D1
    description: "Whitelist renders each construct: **bold**->strong, *italic*->em, \\n->br, [label](url)->anchor with rel=noopener noreferrer + target=_blank"
    requirement: TOOL-05
    verification:
      - kind: unit
        ref: "src/__tests__/copy-markdown.test.tsx#renderCopy — whitelist"
        status: pass
    human_judgment: false
  - id: D2
    description: "Escape-first: raw <script> / <img onerror=...> payloads render as inert escaped text (&lt;script&gt;, &lt;img), no live element; metacharacters inside a bold run are escaped too"
    requirement: TOOL-05
    verification:
      - kind: unit
        ref: "src/__tests__/copy-markdown.test.tsx#renderCopy — escape-first (XSS inert)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Link scheme allowlist: javascript:/data: URLs drop the href and render the label as plain text; mailto + https survive"
    requirement: TOOL-05
    verification:
      - kind: unit
        ref: "src/__tests__/copy-markdown.test.tsx#renderCopy — link scheme allowlist"
        status: pass
    human_judgment: false

metrics:
  duration_minutes: 6
  tasks_completed: 1
  files_created: 2
  files_modified: 0
  commits: 3
  completed_date: 2026-07-05

status: complete
---

# Phase 36 Plan 02: Escape-First Inline Copy Renderer Summary

Built `renderCopy` — a pure `string -> React.ReactNode` inline markdown renderer that is safe by construction (no new deps, no raw-HTML injection), closing the phase's primary XSS surface (TOOL-05, SC-4 markdown half).

## What Was Built

`apps/run.bib/webapp/src/lib/copy-markdown.tsx` exports `renderCopy(value)`, which makes a single ordered regex pass over the RAW copy string and returns an array of React nodes:

- Non-token text runs become React **text children** — React escapes them on render, so any editor-injected `<script>` / `<img onerror=...>` is emitted as inert `&lt;script&gt;` / `&lt;img` text with no live element. This is the escape-first invariant, achieved structurally (returning nodes, never an HTML string).
- The whitelist re-introduces only four constructs as real elements: `**bold**` -> `<strong>`, `*italic*` -> `<em>`, `\n` -> `<br/>`, `[label](url)` -> `<a>`.
- Anchors gate the URL scheme against an http/https/mailto allowlist; a `javascript:`/`data:`/other scheme drops the href and renders the label as plain text. Every surviving anchor carries `rel="noopener noreferrer"` + `target="_blank"`.

Being a pure function of a string, the same escape-then-whitelist path runs server-side and (Plan 03) client-side via `useCopy`.

## How It Was Verified

- `npx vitest run src/__tests__/copy-markdown.test.tsx` — 10 tests pass (whitelist, both XSS payloads, metacharacters-inside-bold, javascript:/data: neutralisation, mailto/https allowed) under Node v23.6.0.
- `npx tsc --noEmit` — zero errors in the plan's files. (30 pre-existing project-wide `TS2307 Cannot find module` errors for UI deps — `clsx`, `@heroui/react`, `next-themes`, `framer-motion`, `qrcode` — stem from the partial `node_modules` install noted in the plan's environment notes and are unrelated to this plan.)
- Raw-HTML-injection grep gate returns 0 in `copy-markdown.tsx`.

## TDD Gate Compliance

- RED: `74ad47dd` `test(36-02):` — spec committed while the module did not exist (import fails). Confirmed failing before implementation.
- GREEN: `49617c77` `feat(36-02):` — implementation committed; all 10 tests pass.
- REFACTOR: none required (the grep-gate comment reword was folded into the GREEN commit before it landed).

## Deviations from Plan

None — plan executed as written. The only judgment call was a one-word doc-comment reword so the plan's grep gate (which does not filter block comments) reads a true 0; the code itself never contained a raw-HTML injection call.

## Out-of-Scope Observations (not fixed)

- The run.bib webapp `node_modules` is a partial/symlinked install: `qrcode`, `clsx`, `@heroui/react`, `next-themes`, `framer-motion` do not resolve under type-check, and the pre-existing `bib-preview.test.tsx` cannot load because of the missing `qrcode`. These are environment/install issues that predate this plan and are outside its file scope (`copy-markdown.tsx` + its test only).

## Self-Check: PASSED
- FOUND: apps/run.bib/webapp/src/lib/copy-markdown.tsx
- FOUND: apps/run.bib/webapp/src/__tests__/copy-markdown.test.tsx
- FOUND commit: 74ad47dd (test — RED)
- FOUND commit: 49617c77 (feat — GREEN)
