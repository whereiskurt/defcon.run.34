# run.flash Download Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user download the exact config run.flash would push (txt / json / meshtastic-CLI sh) before or without flashing, for manual radio setup.

**Architecture:** Client-side only. A pure serializer module turns the existing auth-gated `/api/config` `DeviceConfigPayload` into three text formats; a shared `DownloadConfigMenu` component (self-fetches the payload when not handed one) is mounted in two places — the Configure step and the pick-device (landing) step next to the existing `AppDownloadsCard`.

**Tech Stack:** Next.js 16 + HeroUI + vitest (existing run.flash webapp stack).

**Spec:** `docs/superpowers/specs/2026-07-26-flash-download-config-design.md`

## Global Constraints

- No server changes: `/api/config` and the flash/serial pipeline are untouched.
- Copy keys go through `useCopy()`/t() with fallbacks APPENDED to `src/lib/copy-snapshot.json` — append, never sort/reorder (snapshot byte-parity landmine).
- Files carry the user's own MQTT password + channel PSKs — txt/sh get a "keep this file private" header line.
- basePath for client fetches: copy the exact `const basePath = process.env.NODE_ENV === 'production' ? ... : ...` pattern from `src/hooks/use-configure.ts:16`.
- Release: use1 only (`release-all.sh --apps run.flash --regions use1 --pr`); deploy via `deploy.yml`; ECR immutable — let the script bump VERSION.

---

### Task 1: `config-export` serializers + download helper

**Files:**
- Create: `apps/run.flash/webapp/src/lib/config-export.ts`
- Test: `apps/run.flash/webapp/src/lib/config-export.test.ts`

**Interfaces:**
- Consumes: `DeviceConfigPayload` from `@/types/config`.
- Produces (Task 2 imports all four):
  - `type ExportFormat = "txt" | "json" | "sh"`
  - `toReadableText(p: DeviceConfigPayload): string`
  - `toJson(p: DeviceConfigPayload): string`
  - `toCliScript(p: DeviceConfigPayload): string`
  - `exportConfig(p: DeviceConfigPayload, f: ExportFormat): { filename: string; mime: string; content: string }`
  - `downloadConfig(p: DeviceConfigPayload, f: ExportFormat): void` (Blob + anchor; browser-only)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { toReadableText, toJson, toCliScript, exportConfig } from "./config-export";
import type { DeviceConfigPayload } from "@/types/config";

const payload: DeviceConfigPayload = {
  mqtt: { server: "mqtt.defcon.run", port: 4433, username: "abc123", password: "s3cret", tls: true, root: "msh/US" },
  channels: [
    { name: "dc.run", psk: "Wjt8kzHci9lqdS4tBzSF2VbQd86u6U3nhHaBl7V5TGE=", role: "PRIMARY", positionPrecision: 32 },
    { name: "LongFast", psk: "AQ==", role: "SECONDARY", positionPrecision: 0 },
  ],
  identity: { longName: "rabbit_abc1", shortName: "RABB" },
  radio: { region: "US", modemPreset: "LONG_FAST", hopLimit: 3 },
  ringtone: "ax:d=4,o=5,b=100:8g,8g",
  position: { broadcastSecs: 60, smartEnabled: true },
  mapReport: { enabled: true, positionPrecision: 32, publishIntervalSecs: 3600 },
};

describe("toReadableText", () => {
  it("contains every value a manual setup needs, grouped with a privacy header", () => {
    const txt = toReadableText(payload);
    expect(txt).toMatch(/keep this file private/i);
    for (const v of ["mqtt.defcon.run", "4433", "abc123", "s3cret", "msh/US",
      "dc.run", "Wjt8kzHci9lqdS4tBzSF2VbQd86u6U3nhHaBl7V5TGE=", "LongFast", "AQ==",
      "rabbit_abc1", "RABB", "US", "LONG_FAST", "ax:d=4,o=5,b=100:8g,8g"]) {
      expect(txt).toContain(v);
    }
    expect(txt).toMatch(/TLS:\s*on/i);
  });
});

describe("toJson", () => {
  it("round-trips the payload verbatim", () => {
    expect(JSON.parse(toJson(payload))).toEqual(payload);
  });
});

describe("toCliScript", () => {
  it("emits meshtastic CLI commands incl. base64 PSKs and quoted ringtone", () => {
    const sh = toCliScript(payload);
    expect(sh).toContain("--set mqtt.address 'mqtt.defcon.run:4433'");
    expect(sh).toContain("--set mqtt.username 'abc123'");
    expect(sh).toContain("--set mqtt.tls_enabled true");
    expect(sh).toContain("--ch-set psk 'base64:Wjt8kzHci9lqdS4tBzSF2VbQd86u6U3nhHaBl7V5TGE=' --ch-index 0");
    expect(sh).toContain("--ch-set psk 'base64:AQ==' --ch-index 1");
    expect(sh).toContain("--set lora.region US");
    expect(sh).toContain("--set-owner 'rabbit_abc1'");
    expect(sh).toContain("--set-ringtone 'ax:d=4,o=5,b=100:8g,8g'");
    expect(sh).toMatch(/keep this file private/i);
  });
});

describe("exportConfig", () => {
  it("maps format to filename and mime", () => {
    expect(exportConfig(payload, "txt").filename).toBe("dcrun-radio-config.txt");
    expect(exportConfig(payload, "json").filename).toBe("dcrun-radio-config.json");
    expect(exportConfig(payload, "sh").filename).toBe("dcrun-radio-config.sh");
    expect(exportConfig(payload, "json").mime).toBe("application/json");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/run.flash/webapp && npx vitest run src/lib/config-export.test.ts`
Expected: FAIL (module not found). If node_modules is thin, `npm install` first.

- [ ] **Step 3: Implement `config-export.ts`**

Pure functions; no React. Sketch (implementer fills sections following the
test's exact expectations):

```ts
import type { DeviceConfigPayload, ChannelConfig } from "@/types/config";

export type ExportFormat = "txt" | "json" | "sh";

const PRIVACY = "KEEP THIS FILE PRIVATE — it contains your personal MQTT password and channel keys.";

export function toReadableText(p: DeviceConfigPayload): string {
  const ch = (c: ChannelConfig, i: number) =>
    [`  Channel ${i} (${c.role}):`,
     `    Name: ${c.name}`,
     `    PSK (base64): ${c.psk}`,
     `    Position precision: ${c.positionPrecision ?? 0} (32=exact, 0=off)`].join("\n");
  return [
    `DEF CON run — Meshtastic manual setup`,
    PRIVACY,
    ``,
    `== MQTT (app: Settings → Module Configuration → MQTT) ==`,
    `  Server address: ${p.mqtt.server}:${p.mqtt.port}`,
    `  Username: ${p.mqtt.username}`,
    `  Password: ${p.mqtt.password}`,
    `  TLS: ${p.mqtt.tls ? "on" : "off"}`,
    `  Root topic: ${p.mqtt.root}`,
    `  Enabled: on   Proxy to client enabled: on`,
    ``,
    `== Channels (app: Settings → Radio Configuration → Channels) ==`,
    ...p.channels.map(ch),
    ``,
    `== LoRa (app: Settings → Radio Configuration → LoRa) ==`,
    `  Region: ${p.radio.region}`,
    `  Modem preset: ${p.radio.modemPreset}`,
    `  Hop limit: ${p.radio.hopLimit}`,
    ``,
    `== User (app: Settings → Radio Configuration → User) ==`,
    `  Long name: ${p.identity.longName}`,
    `  Short name: ${p.identity.shortName}`,
    ``,
    `== Ringtone (app: Module Configuration → External Notification) ==`,
    `  RTTTL: ${p.ringtone}`,
    ``,
    `== Position (app: Radio Configuration → Position) ==`,
    `  Broadcast interval (s): ${p.position.broadcastSecs}`,
    `  Smart position: ${p.position.smartEnabled ? "on" : "off"}`,
    ``,
    `== Map report (app: Module Configuration → MQTT → Map reporting) ==`,
    `  Enabled: ${p.mapReport.enabled ? "on" : "off"}`,
    `  Precision: ${p.mapReport.positionPrecision}`,
    `  Publish interval (s): ${p.mapReport.publishIntervalSecs}`,
  ].join("\n");
}

export function toJson(p: DeviceConfigPayload): string {
  return JSON.stringify(p, null, 2);
}

export function toCliScript(p: DeviceConfigPayload): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const lines = [
    `#!/bin/sh`,
    `# DEF CON run — Meshtastic manual setup via the Python CLI (pip install meshtastic)`,
    `# ${PRIVACY}`,
    `# Run with the radio on USB. Firmware 2.5+ setting names.`,
    ``,
    `meshtastic --set mqtt.address ${q(`${p.mqtt.server}:${p.mqtt.port}`)} \\`,
    `  --set mqtt.username ${q(p.mqtt.username)} --set mqtt.password ${q(p.mqtt.password)} \\`,
    `  --set mqtt.tls_enabled ${p.mqtt.tls} --set mqtt.root ${q(p.mqtt.root)} \\`,
    `  --set mqtt.enabled true --set mqtt.proxy_to_client_enabled true \\`,
    `  --set mqtt.map_reporting_enabled ${p.mapReport.enabled}`,
    ``,
    `meshtastic --set lora.region ${p.radio.region} --set lora.modem_preset ${p.radio.modemPreset} --set lora.hop_limit ${p.radio.hopLimit}`,
    `meshtastic --set position.position_broadcast_secs ${p.position.broadcastSecs} --set position.position_broadcast_smart_enabled ${p.position.smartEnabled}`,
    `meshtastic --set-owner ${q(p.identity.longName)} --set-owner-short ${q(p.identity.shortName)}`,
    `meshtastic --set-ringtone ${q(p.ringtone)}`,
    ``,
  ];
  p.channels.forEach((c, i) => {
    if (i > 0) lines.push(`meshtastic --ch-add ${q(c.name)}`);
    lines.push(
      `meshtastic --ch-set name ${q(c.name)} --ch-set psk ${q(`base64:${c.psk}`)} --ch-index ${i}`,
      `meshtastic --ch-set module_settings.position_precision ${c.positionPrecision ?? 0} --ch-index ${i}`,
    );
  });
  return lines.join("\n") + "\n";
}

const FORMATS: Record<ExportFormat, { ext: string; mime: string; render: (p: DeviceConfigPayload) => string }> = {
  txt: { ext: "txt", mime: "text/plain", render: toReadableText },
  json: { ext: "json", mime: "application/json", render: toJson },
  sh: { ext: "sh", mime: "text/x-shellscript", render: toCliScript },
};

export function exportConfig(p: DeviceConfigPayload, f: ExportFormat) {
  const { ext, mime, render } = FORMATS[f];
  return { filename: `dcrun-radio-config.${ext}`, mime, content: render(p) };
}

export function downloadConfig(p: DeviceConfigPayload, f: ExportFormat): void {
  const { filename, mime, content } = exportConfig(p, f);
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Run tests** — same command, expect PASS; then `npx vitest run` (whole suite) — no regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/run.flash/webapp/src/lib/config-export.ts apps/run.flash/webapp/src/lib/config-export.test.ts
git commit -m "feat(flash): config-export serializers (txt/json/cli) for manual setup"
```

---

### Task 2: `DownloadConfigMenu` component, both placements, copy keys

**Files:**
- Create: `apps/run.flash/webapp/src/components/download-config-menu.tsx`
- Modify: `apps/run.flash/webapp/src/components/configure/configure-step.tsx` (mount before/near the pipeline; payload from `configureState.configPayload` may be null → component self-fetches)
- Modify: `apps/run.flash/webapp/src/components/wizard/wizard-container.tsx:125-133` (pick-device step, below `<AppDownloadsCard variant="compact" />`)
- Modify: `apps/run.flash/webapp/src/lib/copy-snapshot.json` (APPEND keys at the end of the flash section — never sort)

**Interfaces:**
- Consumes: Task 1's `downloadConfig`, `ExportFormat`; `useCopy()` from `@/components/CopyProvider`; HeroUI `Dropdown/DropdownTrigger/DropdownMenu/DropdownItem, Button, Card` (mirror `components/header/dropdown-menu.tsx` for Dropdown usage and `components/app-downloads-card.tsx` for the card variant pattern).
- Produces: `<DownloadConfigMenu payload={DeviceConfigPayload | null} variant="button" | "card" />`.

- [ ] **Step 1: Component behavior (write it):**
  - Props: `payload: DeviceConfigPayload | null`, `variant: "button" | "card"`.
  - Internal state: `fetched` payload + `error`. On dropdown open (or card button press) when `payload ?? fetched` is null: `fetch(\`${basePath}/api/config\`)` (basePath pattern copied from `use-configure.ts:16`); 404 → set error → render t("flash.downloadConfig.notProvisioned"); other errors → t("flash.downloadConfig.error").
  - Menu items: txt / json / sh — labels t("flash.downloadConfig.txt"|"json"|"sh"); on select `downloadConfig(effectivePayload, format)`.
  - `variant="button"`: secondary HeroUI Button + Dropdown, label t("flash.downloadConfig.button") with a `Download` lucide icon.
  - `variant="card"`: compact glass-card matching `AppDownloadsCard variant="compact"` styling — title t("flash.downloadConfig.cardTitle"), body t("flash.downloadConfig.cardBody"), then the same dropdown button.

- [ ] **Step 2: Copy keys — APPEND to `copy-snapshot.json`** (inside the same object holding the other `flash.*` keys, at its end):

```json
    "flash.downloadConfig.button": "Download config",
    "flash.downloadConfig.cardTitle": "Manual setup",
    "flash.downloadConfig.cardBody": "No compatible browser or radio handy? Download your personal config and copy the values in by hand.",
    "flash.downloadConfig.txt": "Readable text (.txt)",
    "flash.downloadConfig.json": "Raw JSON (.json)",
    "flash.downloadConfig.sh": "meshtastic CLI script (.sh)",
    "flash.downloadConfig.notProvisioned": "Your account isn't MQTT-provisioned yet — open run.defcon.run first, then come back.",
    "flash.downloadConfig.error": "Couldn't load your config. Refresh and try again."
```

- [ ] **Step 3: Mount in configure-step.tsx** — in the idle/pre-push UI region (near the connect prompt, and also visible in the error state), `<DownloadConfigMenu payload={configPayload} variant="button" />`; the step already receives `configPayload` via props (check the prop list; if absent, thread it from `wizard-container.tsx:208`'s `configureState.configPayload`).

- [ ] **Step 4: Mount in wizard-container.tsx pick-device step** — directly below `<AppDownloadsCard variant="compact" />`: `<DownloadConfigMenu payload={null} variant="card" />`.

- [ ] **Step 5: Verify** — `npx vitest run` green; `npm run build` clean; `npx tsc --noEmit` reports nothing new in changed files.

- [ ] **Step 6: Commit**

```bash
git add apps/run.flash/webapp/src/components/download-config-menu.tsx apps/run.flash/webapp/src/components/configure/configure-step.tsx apps/run.flash/webapp/src/components/wizard/wizard-container.tsx apps/run.flash/webapp/src/lib/copy-snapshot.json
git commit -m "feat(flash): Download config menu on configure step + manual-setup card on landing"
```

---

### Task 3: PR, release, deploy, verify live

- [ ] **Step 1:** Push `feat/flash-download-config`, `gh pr create`, merge (autonomous delivery authorized 2026-07-26).
- [ ] **Step 2:** From merged main state (`git checkout -B flash-release-base origin/main` after fetch): `./apps/release-all.sh --apps run.flash --regions use1 --pr` (env.local.sh already present at repo root).
- [ ] **Step 3:** `gh workflow run deploy.yml -f region=us-east-1 -f pr_number=<ReleasePR#> -f invalidate_cache=true`; watch the run.
- [ ] **Step 4:** Verify: flash.defcon.run serves the new version (`curl -s https://flash.defcon.run/use1/ | grep -oE 'v0\.0\.[0-9]+'`); page renders the Manual setup card signed-out→signin gate intact (root serves 302 to signin when unauthenticated — expected). Report to Kurt for signed-in UAT: download all three formats from both placements, values match `/api/config`.

## Self-Review Notes

- Spec coverage: serializers+helper (T1), both placements + copy + provisioning-404 handling (T2), ship-live (T3). No server changes anywhere — matches spec.
- Type consistency: `ExportFormat`/`downloadConfig(payload, format)` names used identically in T1/T2.
- Privacy header asserted in tests for txt and sh.
