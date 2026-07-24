# run.flash Multi-Firmware + rp2040 + App Downloads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let flashers pick between three baked firmware versions (default 2.7.26 stable, plus 2.7.15 and the 2.8.0 develop nightly), add rp2040 device support, and offer self-hosted app downloads (2 Android APKs + iOS App Store link).

**Architecture:** Two checked-in build-config files (`firmware-versions.json`, `app-downloads.sources.json`) drive Dockerfile Stage 1, which downloads all firmware versions + APKs and writes runtime manifests into `public/data/` (tracked snapshots overwritten at build, exactly like `hardware-list.json`). The client statically imports the manifests (no fetch). Selected version state lives in `WizardContainer` and threads through the existing `loadFirmware(device, version)` parameter that every helper already accepts.

**Tech Stack:** Next.js 16, React 19, HeroUI, vitest, Docker multi-stage, busybox sh (alpine), jq.

**Spec:** `docs/superpowers/specs/2026-07-23-flash-multi-firmware-app-downloads-design.md`

## Global Constraints

- All work under `apps/run.flash/webapp/` unless a path says otherwise. Run all npm/vitest commands from that directory.
- vitest requires Node ≥22.12: `nvm use 22.12.0` before running tests.
- `npm run lint` crashes with a PRE-EXISTING eslintrc circular-JSON error — do not try to fix it; skip lint.
- DPLY-06 offline gate: the strings `api.meshtastic.org` and `github.com/meshtastic` must NEVER appear in client-bundled code or in `public/data/*.json` snapshots. GitHub URLs live ONLY in `app-downloads.sources.json` / `firmware-versions.json` (build-side, never imported by src/).
- Pinned firmware versions: stable `2.7.26.54e0d8d` (default), previous `2.7.15.567b8ea`. Nightly resolved at build from `https://raw.githubusercontent.com/meshtastic/meshtastic.github.io/master/firmware-nightly/index.json` (today: `2.8.0.ef1aedd`).
- APK sources (verified 2026-07-23): `https://github.com/meshtastic/Meshtastic-Android/releases/download/v2.7.13/app-fdroid-release.apk` and `https://github.com/meshtastic/Meshtastic-Android/releases/download/2.8.0-open.1/androidApp-fdroid-universal-release.apk`.
- iOS App Store URL: `https://apps.apple.com/us/app/meshtastic/id1586432531` (verify with a HEAD request during Task 5; correct the id if it 404s).
- New UI copy uses string literals (the copy-catalog `t()` echoes missing keys — do NOT invent new `t()` keys; CMS entries are a later sweep).
- Commit after every task with the messages given. Do not push until the final task.

---

### Task 1: Firmware version manifest — config, types, snapshot, tests

**Files:**
- Create: `apps/run.flash/webapp/firmware-versions.json`
- Create: `apps/run.flash/webapp/public/data/firmware-manifest.json`
- Modify: `apps/run.flash/webapp/src/config/firmware.ts` (top of file, after existing imports)
- Test: `apps/run.flash/webapp/src/config/firmware-manifest.test.ts`

**Interfaces:**
- Produces: `FirmwareVersionEntry { slot, version, label, default, experimental }`, `FIRMWARE_VERSIONS: FirmwareVersionEntry[]`, `DEFAULT_FIRMWARE_VERSION: string` — all exported from `@/config/firmware`. Later tasks import these names exactly.

- [ ] **Step 1: Write the build-config file** `firmware-versions.json` (webapp root — consumed only by Dockerfile + scripts, never imported from src/):

```json
{
  "versions": [
    { "slot": "stable", "pin": "2.7.26.54e0d8d", "label": "2.7.26 — recommended", "default": true },
    { "slot": "previous", "pin": "2.7.15.567b8ea", "label": "2.7.15 — previous stable" },
    { "slot": "nightly", "pin": "", "label": "2.8.0 nightly — experimental", "experimental": true }
  ]
}
```

- [ ] **Step 2: Write the tracked runtime snapshot** `public/data/firmware-manifest.json` (overwritten by Docker Stage 1 in prod builds, same pattern as `hardware-list.json`):

```json
{
  "versions": [
    { "slot": "stable", "version": "2.7.26.54e0d8d", "label": "2.7.26 — recommended", "default": true, "experimental": false },
    { "slot": "previous", "version": "2.7.15.567b8ea", "label": "2.7.15 — previous stable", "default": false, "experimental": false },
    { "slot": "nightly", "version": "2.8.0.ef1aedd", "label": "2.8.0 nightly — experimental", "default": false, "experimental": true }
  ]
}
```

- [ ] **Step 3: Write the failing test** `src/config/firmware-manifest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import manifest from "@/../public/data/firmware-manifest.json";
import { FIRMWARE_VERSIONS, DEFAULT_FIRMWARE_VERSION } from "./firmware";

describe("firmware-manifest snapshot", () => {
  it("has at least one version entry", () => {
    expect(manifest.versions.length).toBeGreaterThan(0);
  });

  it("has exactly one default version", () => {
    expect(manifest.versions.filter((v) => v.default)).toHaveLength(1);
  });

  it("every entry has a well-formed meshtastic version and non-empty label", () => {
    for (const v of manifest.versions) {
      expect(v.version).toMatch(/^\d+\.\d+\.\d+\.[0-9a-f]+$/);
      expect(v.label.length).toBeGreaterThan(0);
    }
  });

  it("never leaks upstream hostnames (DPLY-06)", () => {
    const raw = JSON.stringify(manifest);
    expect(raw).not.toContain("api.meshtastic.org");
    expect(raw).not.toContain("github.com/meshtastic");
  });
});

describe("firmware config exports", () => {
  it("FIRMWARE_VERSIONS mirrors the snapshot", () => {
    expect(FIRMWARE_VERSIONS.map((v) => v.version)).toEqual(
      manifest.versions.map((v) => v.version)
    );
  });

  it("DEFAULT_FIRMWARE_VERSION is the default entry's version", () => {
    const def = manifest.versions.find((v) => v.default);
    expect(DEFAULT_FIRMWARE_VERSION).toBe(def?.version);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/run.flash/webapp && nvm use 22.12.0 && npx vitest run src/config/firmware-manifest.test.ts`
Expected: FAIL — `FIRMWARE_VERSIONS` is not exported from `./firmware`.

- [ ] **Step 5: Implement in `src/config/firmware.ts`** — add directly below the existing `FIRMWARE_VERSION` export (line 4):

```ts
import firmwareManifest from "@/../public/data/firmware-manifest.json";

/** One selectable firmware version from public/data/firmware-manifest.json
 *  (tracked snapshot, overwritten by Dockerfile Stage 1 at build time). */
export interface FirmwareVersionEntry {
  slot: string;
  version: string;
  label: string;
  default: boolean;
  experimental: boolean;
}

export const FIRMWARE_VERSIONS: FirmwareVersionEntry[] =
  firmwareManifest.versions as FirmwareVersionEntry[];

/** The preselected version — falls back to the build-time env single-version
 *  value so a malformed manifest can never blank the flasher. */
export const DEFAULT_FIRMWARE_VERSION: string =
  FIRMWARE_VERSIONS.find((v) => v.default)?.version ?? FIRMWARE_VERSION;
```

(The `import` line must go at the very top of the file with the other import.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/config/firmware-manifest.test.ts`
Expected: PASS (6 tests). Also run the full suite to confirm no regression: `npx vitest run` → all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/run.flash/webapp/firmware-versions.json apps/run.flash/webapp/public/data/firmware-manifest.json apps/run.flash/webapp/src/config/firmware.ts apps/run.flash/webapp/src/config/firmware-manifest.test.ts
git commit -m "feat(run.flash): firmware version manifest — three selectable versions"
```

---

### Task 2: rp2040 device family

**Files:**
- Modify: `apps/run.flash/webapp/src/types/device.ts:24-49`
- Modify: `apps/run.flash/webapp/src/config/devices.ts:51-60` (getArchLabel)
- Modify: `apps/run.flash/webapp/src/components/flash/nrf52-flash-step.tsx` (bootloader instructions branch)
- Test: `apps/run.flash/webapp/src/types/device.test.ts` (create if absent; extend if present)

**Interfaces:**
- Consumes: nothing new.
- Produces: `getDeviceFamily(device)` returns `"nrf52"` for `architecture === "rp2040"` (the "nrf52" family value now means "UF2 mass-storage bootloader class"). All existing wizard routing (skip Connect, guided flash, serial Configure) applies to rp2040 automatically.

- [ ] **Step 1: Write the failing test** `src/types/device.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getDeviceFamily, type DeviceHardware } from "./device";

function dev(architecture: string): DeviceHardware {
  return {
    hwModel: 1,
    hwModelSlug: "X",
    platformioTarget: "x",
    architecture,
    activelySupported: true,
    displayName: "X",
  };
}

describe("getDeviceFamily", () => {
  it("routes esp32 family to esp32", () => {
    expect(getDeviceFamily(dev("esp32"))).toBe("esp32");
    expect(getDeviceFamily(dev("esp32-s3"))).toBe("esp32");
  });

  it("routes nrf52840 to the uf2-class nrf52 flow", () => {
    expect(getDeviceFamily(dev("nrf52840"))).toBe("nrf52");
  });

  it("routes rp2040 to the uf2-class nrf52 flow", () => {
    expect(getDeviceFamily(dev("rp2040"))).toBe("nrf52");
  });

  it("throws on unsupported architectures", () => {
    expect(() => getDeviceFamily(dev("portduino"))).toThrow(/Unsupported/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/types/device.test.ts`
Expected: FAIL on the rp2040 case (`Unsupported device architecture: rp2040`).

- [ ] **Step 3: Implement in `src/types/device.ts`** — replace lines 24-34 (`NRF52_ARCHITECTURES` through `isNrf52Device`) with:

```ts
/** UF2 mass-storage bootloader class: no Web-Serial connect step, guided
 *  drag-drop flash, serial reconnect at Configure. nRF52840 (Adafruit
 *  bootloader) and RP2040 (BOOTSEL / RPI-RP2) behave identically at the
 *  wizard level; only the on-device bootloader-entry instructions differ. */
export const UF2_ARCHITECTURES = ["nrf52840", "rp2040"] as const;

export function isUf2Device(device: DeviceHardware): boolean {
  return (UF2_ARCHITECTURES as readonly string[]).includes(device.architecture);
}

/** @deprecated alias — the family value is still "nrf52" for compatibility. */
export const isNrf52Device = isUf2Device;
```

and change `getDeviceFamily`'s second branch from `if (isNrf52Device(device)) return "nrf52";` to `if (isUf2Device(device)) return "nrf52";`. Update the `DeviceFamily` doc comment to note `"nrf52"` = UF2 class.
Then run `grep -rn "isNrf52Device\|NRF52_ARCHITECTURES" src/` and fix any import that referenced `NRF52_ARCHITECTURES` directly (switch to `UF2_ARCHITECTURES`).

- [ ] **Step 4: Add the rp2040 arch label** in `src/config/devices.ts` `getArchLabel` labels map, after the `nrf52840` line:

```ts
    rp2040: "RP2040",
```

- [ ] **Step 5: Add rp2040 bootloader instructions** in `src/components/flash/nrf52-flash-step.tsx`. Below the `isT1000e` const (line 41) add:

```ts
  const isRp2040 = device.architecture === "rp2040";
```

Change the bootloader-entry `<li>` (lines 114-132) to a three-way branch — insert the rp2040 case first:

```tsx
          {isRp2040 ? (
            <li>
              Enter bootloader mode:{" "}
              <span className="text-foreground">
                unplug the device, then hold the BOOTSEL button while
                reconnecting the USB cable
              </span>
              , and release it once connected.
            </li>
          ) : isT1000e ? (
            /* existing T1000E <li> unchanged */
          ) : (
            /* existing double-tap RESET <li> unchanged */
          )}
```

And the drive-name `<li>` (line 134-140): change the drive-name expression to:

```tsx
              {isRp2040 ? "RPI-RP2" : isT1000e ? "T1000-E" : "FTHR840BOOT"}
```

and change the trailing parenthetical `(the Adafruit UF2 bootloader)` to `(the UF2 bootloader)`.

- [ ] **Step 6: Regenerate the hardware snapshot is deferred** — the tracked `public/data/hardware-list.json` is regenerated in Task 7 after the script gains rp2040+nrf52840. Nothing to do here.

- [ ] **Step 7: Run tests**

Run: `npx vitest run`
Expected: ALL PASS including the 4 new device.test.ts tests.

- [ ] **Step 8: Commit**

```bash
git add apps/run.flash/webapp/src/types/device.ts apps/run.flash/webapp/src/types/device.test.ts apps/run.flash/webapp/src/config/devices.ts apps/run.flash/webapp/src/components/flash/nrf52-flash-step.tsx
git commit -m "feat(run.flash): rp2040 support via the UF2 device class"
```

---

### Task 3: Thread selected version through the flash pipeline

**Files:**
- Modify: `apps/run.flash/webapp/src/hooks/use-flash.ts:34-38,67-81` (flash signature)
- Modify: `apps/run.flash/webapp/src/hooks/use-flash-esp32.ts` (flash callback signature + `loadFirmware` call, ~line 53-65)
- Modify: `apps/run.flash/webapp/src/hooks/use-flash-nrf52.ts` (flash callback signature + `loadUf2` call, ~line 66-77)
- Modify: `apps/run.flash/webapp/src/config/firmware.ts:20,52,78,97` (default param becomes `DEFAULT_FIRMWARE_VERSION`)
- Test: `apps/run.flash/webapp/src/config/firmware.test.ts` (create)

**Interfaces:**
- Consumes: `DEFAULT_FIRMWARE_VERSION` from Task 1.
- Produces: `flash(transport, device, appendLog, version?: string)` on `UseFlashReturn` and both delegates — Task 4's `FlashStep.handleFlash` passes the 4th argument.

- [ ] **Step 1: Write the failing test** `src/config/firmware.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  getFactoryFilename,
  getUf2Filename,
  DEFAULT_FIRMWARE_VERSION,
} from "./firmware";
import type { DeviceHardware } from "@/types/device";

const device: DeviceHardware = {
  hwModel: 9,
  hwModelSlug: "TBEAM",
  platformioTarget: "tbeam",
  architecture: "esp32",
  activelySupported: true,
  displayName: "T-Beam",
};

describe("firmware filename helpers", () => {
  it("uses an explicitly passed version", () => {
    expect(getFactoryFilename(device, "2.8.0.ef1aedd")).toBe(
      "firmware-tbeam-2.8.0.ef1aedd.factory.bin"
    );
    expect(getUf2Filename(device, "2.8.0.ef1aedd")).toBe(
      "firmware-tbeam-2.8.0.ef1aedd.uf2"
    );
  });

  it("defaults to DEFAULT_FIRMWARE_VERSION (manifest default), not the env var", () => {
    expect(getFactoryFilename(device)).toBe(
      `firmware-tbeam-${DEFAULT_FIRMWARE_VERSION}.factory.bin`
    );
  });
});
```

- [ ] **Step 2: Run test to verify current default behavior fails**

Run: `npx vitest run src/config/firmware.test.ts`
Expected: The "defaults to DEFAULT_FIRMWARE_VERSION" test FAILS in the bare test env (`FIRMWARE_VERSION` env is empty → filename is `firmware-tbeam-.factory.bin` while `DEFAULT_FIRMWARE_VERSION` resolves from the manifest).

- [ ] **Step 3: Switch default params in `src/config/firmware.ts`** — in all four signatures (`getFactoryFilename`, `loadFirmware`, `getUf2Filename`, `loadUf2`) change `version: string = FIRMWARE_VERSION` to `version: string = DEFAULT_FIRMWARE_VERSION`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/config/firmware.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the version param to the delegates.** In `use-flash-esp32.ts` extend the `flash` callback signature:

```ts
    async (
      espLoader: ESPLoader,
      device: DeviceHardware,
      appendLog: (text: string) => void,
      version?: string
    ) => {
```

and change `const firmware = await loadFirmware(device);` to `const firmware = await loadFirmware(device, version);`. Also update the hook's `UseFlashEsp32Return.flash` type (top of file) to include `version?: string`.
Mirror exactly in `use-flash-nrf52.ts`: signature gains `version?: string`, call becomes `await loadUf2(device, version)`, return-type updated.
(`loadFirmware(device, undefined)` still triggers the default param — safe.)

- [ ] **Step 6: Add the version param to the router** `use-flash.ts` — `UseFlashReturn.flash` type (line 34-38) and the `flash` callback both gain trailing `version?: string`; pass it through:

```ts
      if (family === "esp32") {
        return esp32.flash(transport as ESPLoader, device, appendLog, version);
      }
      return nrf52.flash(transport as DfuDevice, device, appendLog, version);
```

Also update the inline `flashState.flash` prop type in `src/components/flash/flash-step.tsx:49-53` to include the trailing `version?: string`.

- [ ] **Step 7: Type-check + full tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean tsc, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/run.flash/webapp/src/hooks/use-flash.ts apps/run.flash/webapp/src/hooks/use-flash-esp32.ts apps/run.flash/webapp/src/hooks/use-flash-nrf52.ts apps/run.flash/webapp/src/config/firmware.ts apps/run.flash/webapp/src/config/firmware.test.ts apps/run.flash/webapp/src/components/flash/flash-step.tsx
git commit -m "feat(run.flash): thread selected firmware version through flash pipeline"
```

---

### Task 4: Version picker UI

**Files:**
- Create: `apps/run.flash/webapp/src/components/flash/firmware-version-select.tsx`
- Modify: `apps/run.flash/webapp/src/components/wizard/wizard-container.tsx` (state + props)
- Modify: `apps/run.flash/webapp/src/components/flash/flash-step.tsx` (idle panel + handleFlash)
- Modify: `apps/run.flash/webapp/src/components/flash/nrf52-flash-step.tsx` (select + download link)
- Modify: `apps/run.flash/webapp/src/components/done/done-step.tsx` (firmware row)

**Interfaces:**
- Consumes: `FIRMWARE_VERSIONS`, `DEFAULT_FIRMWARE_VERSION` (Task 1); `flash(..., version)` (Task 3).
- Produces: `FirmwareVersionSelect({ value, onChange })`; new props `firmwareVersion: string` + `onFirmwareVersionChange: (v: string) => void` on `FlashStep` and `Nrf52FlashStep`; `firmwareVersion: string` on `DoneStep`.

- [ ] **Step 1: Create `firmware-version-select.tsx`:**

```tsx
"use client";

import { Chip, Select, SelectItem } from "@heroui/react";
import { FIRMWARE_VERSIONS } from "@/config/firmware";

interface FirmwareVersionSelectProps {
  value: string;
  onChange: (version: string) => void;
}

/** Firmware version dropdown, populated from the build-time manifest.
 *  Keys are the full meshtastic version strings; the default entry is
 *  preselected by the wizard container. */
export function FirmwareVersionSelect({
  value,
  onChange,
}: FirmwareVersionSelectProps) {
  return (
    <Select
      aria-label="Firmware version"
      selectedKeys={[value]}
      disallowEmptySelection
      onSelectionChange={(keys) => {
        const key = Array.from(keys)[0];
        if (typeof key === "string") onChange(key);
      }}
      size="sm"
      className="w-64"
      classNames={{ trigger: "font-mono" }}
    >
      {FIRMWARE_VERSIONS.map((v) => (
        <SelectItem key={v.version} textValue={`Meshtastic ${v.version}`}>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm">{v.label}</span>
            {v.experimental && (
              <Chip size="sm" variant="flat" color="warning">
                experimental
              </Chip>
            )}
          </div>
        </SelectItem>
      ))}
    </Select>
  );
}
```

(If the HeroUI version in this repo complains about `SelectItem` children shape, check an existing `Select` usage under `src/components/configure/` and match it.)

- [ ] **Step 2: Add state in `wizard-container.tsx`.** Import `useState`, `DEFAULT_FIRMWARE_VERSION`:

```ts
import { useCallback, useState } from "react";
import { DEFAULT_FIRMWARE_VERSION } from "@/config/firmware";
```

Inside `WizardContainer` (after the hooks block):

```ts
  // Selected firmware version — sticky across "Flash Another Device" so a
  // booth operator's choice survives multi-board provisioning runs.
  const [firmwareVersion, setFirmwareVersion] = useState(
    DEFAULT_FIRMWARE_VERSION
  );
```

Pass the new props: `FlashStep` and `Nrf52FlashStep` get `firmwareVersion={firmwareVersion}` and `onFirmwareVersionChange={setFirmwareVersion}`; `DoneStep` gets `firmwareVersion={firmwareVersion}`.

- [ ] **Step 3: Wire `flash-step.tsx`.** Add props to `FlashStepProps`:

```ts
  /** Selected firmware version (full meshtastic version string). */
  firmwareVersion: string;
  onFirmwareVersionChange: (version: string) => void;
```

Destructure both in the component. In `handleFlash`, pass the version as the 4th arg to both `flashState.flash(...)` calls. Replace the idle-panel firmware row (lines 188-198, the block showing `t("flash.flash.firmwareName")` + `Meshtastic {FIRMWARE_VERSION}`) with:

```tsx
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-default-500">{t("flash.flash.firmwareLabel")}</span>
              <FirmwareVersionSelect
                value={firmwareVersion}
                onChange={onFirmwareVersionChange}
              />
            </div>
```

Change the file row (line 203) to `getFactoryFilename(device, firmwareVersion)`. Remove the now-unused `FIRMWARE_VERSION` import; import `FirmwareVersionSelect`.

- [ ] **Step 4: Wire `nrf52-flash-step.tsx`.** Add the same two props to `Nrf52FlashStepProps` and destructure. Change line 39-40 to:

```ts
  const downloadName = getUf2Filename(device, firmwareVersion);
  const firmwareUrl = `${FIRMWARE_BASE_PATH}/${downloadName}`;
```

Replace `Meshtastic {FIRMWARE_VERSION}` (line 78) with `Meshtastic {firmwareVersion}`, drop the `FIRMWARE_VERSION` import, and insert the select directly ABOVE the download `<Button>`:

```tsx
            <FirmwareVersionSelect
              value={firmwareVersion}
              onChange={onFirmwareVersionChange}
            />
```

- [ ] **Step 5: Wire `done-step.tsx`.** Add `firmwareVersion: string;` to `DoneStepProps` (with doc comment `/** Firmware version that was flashed */`), destructure it, and append a row inside the config-summary card after the radio row (line 156-161):

```tsx
          <div className="border-t border-default-200/10" />
          <div className="flex items-center justify-between text-sm">
            <span className="text-default-500">Firmware</span>
            <span className="font-mono text-foreground">
              Meshtastic {firmwareVersion}
            </span>
          </div>
```

- [ ] **Step 6: Type-check + tests + eyeball**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean. Then start dev (`PORT=3003 npm run dev` — flash dev port per repo tasks; any free port works) and confirm the dropdown renders on the Flash step with "2.7.26 — recommended" preselected and the warning chip on the nightly entry. (Flashing requires hardware — visual check only.)

- [ ] **Step 7: Commit**

```bash
git add apps/run.flash/webapp/src/components/flash/firmware-version-select.tsx apps/run.flash/webapp/src/components/wizard/wizard-container.tsx apps/run.flash/webapp/src/components/flash/flash-step.tsx apps/run.flash/webapp/src/components/flash/nrf52-flash-step.tsx apps/run.flash/webapp/src/components/done/done-step.tsx
git commit -m "feat(run.flash): firmware version picker on flash steps"
```

---

### Task 5: App downloads — sources, manifest, card, placements

**Files:**
- Create: `apps/run.flash/webapp/app-downloads.sources.json`
- Create: `apps/run.flash/webapp/public/data/apps-manifest.json`
- Create: `apps/run.flash/webapp/src/config/apps.ts`
- Create: `apps/run.flash/webapp/src/components/app-downloads-card.tsx`
- Modify: `apps/run.flash/webapp/src/components/done/done-step.tsx` (insert full card)
- Modify: `apps/run.flash/webapp/src/components/wizard/wizard-container.tsx` (insert compact card)
- Modify: `apps/run.flash/webapp/.gitignore` (ignore `public/apps/*.apk`)
- Test: `apps/run.flash/webapp/src/config/apps.test.ts`

**Interfaces:**
- Produces: `APP_DOWNLOADS: AppDownloadEntry[]`, `getAppHref(entry)`, `AppDownloadsCard({ variant })`.

- [ ] **Step 1: Verify the iOS App Store id** before hardcoding:

Run: `curl -sI -o /dev/null -w '%{http_code}' https://apps.apple.com/us/app/meshtastic/id1586432531`
Expected: 200. If not, find the right URL via a web search for "Meshtastic App Store" and use that.

- [ ] **Step 2: Create `app-downloads.sources.json`** (webapp root, build-side only — the ONLY place GitHub URLs may live):

```json
{
  "apps": [
    {
      "id": "android-reliable",
      "kind": "apk",
      "label": "Android 2.7.13",
      "sublabel": "Most reliable — proven BLE pairing",
      "filename": "meshtastic-android-2.7.13.apk",
      "url": "https://github.com/meshtastic/Meshtastic-Android/releases/download/v2.7.13/app-fdroid-release.apk"
    },
    {
      "id": "android-beta",
      "kind": "apk",
      "label": "Android 2.8.0 beta",
      "sublabel": "Newest — improved BLE bonding",
      "filename": "meshtastic-android-2.8.0-open.1.apk",
      "url": "https://github.com/meshtastic/Meshtastic-Android/releases/download/2.8.0-open.1/androidApp-fdroid-universal-release.apk"
    },
    {
      "id": "ios",
      "kind": "store",
      "label": "iOS",
      "sublabel": "Meshtastic on the App Store",
      "storeUrl": "https://apps.apple.com/us/app/meshtastic/id1586432531"
    }
  ]
}
```

- [ ] **Step 3: Create the tracked runtime snapshot** `public/data/apps-manifest.json` — the sources file with every `url` key removed (`storeUrl` stays):

```json
{
  "apps": [
    { "id": "android-reliable", "kind": "apk", "label": "Android 2.7.13", "sublabel": "Most reliable — proven BLE pairing", "filename": "meshtastic-android-2.7.13.apk" },
    { "id": "android-beta", "kind": "apk", "label": "Android 2.8.0 beta", "sublabel": "Newest — improved BLE bonding", "filename": "meshtastic-android-2.8.0-open.1.apk" },
    { "id": "ios", "kind": "store", "label": "iOS", "sublabel": "Meshtastic on the App Store", "storeUrl": "https://apps.apple.com/us/app/meshtastic/id1586432531" }
  ]
}
```

- [ ] **Step 4: Write the failing test** `src/config/apps.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import manifest from "@/../public/data/apps-manifest.json";
import { APP_DOWNLOADS, getAppHref } from "./apps";

describe("apps-manifest snapshot", () => {
  it("has two APKs and one store entry", () => {
    expect(manifest.apps.filter((a) => a.kind === "apk")).toHaveLength(2);
    expect(manifest.apps.filter((a) => a.kind === "store")).toHaveLength(1);
  });

  it("never leaks upstream hostnames (DPLY-06)", () => {
    const raw = JSON.stringify(manifest);
    expect(raw).not.toContain("github.com/meshtastic");
    expect(raw).not.toContain("api.meshtastic.org");
  });
});

describe("getAppHref", () => {
  it("builds local APK paths and passes store URLs through", () => {
    const apk = APP_DOWNLOADS.find((a) => a.kind === "apk")!;
    expect(getAppHref(apk)).toBe(`/apps/${apk.filename}`);
    const store = APP_DOWNLOADS.find((a) => a.kind === "store")!;
    expect(getAppHref(store)).toBe(store.storeUrl);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run src/config/apps.test.ts`
Expected: FAIL — `./apps` module does not exist.

- [ ] **Step 6: Create `src/config/apps.ts`:**

```ts
import appsManifest from "@/../public/data/apps-manifest.json";

/** Base path for mirrored phone-app installers. Served from S3 via CloudFront
 *  in production (asset prefix), locally from public/apps/ in dev. */
export const APPS_BASE_PATH = process.env.NEXT_PUBLIC_ASSET_PREFIX
  ? `${process.env.NEXT_PUBLIC_ASSET_PREFIX}/apps`
  : "/apps";

export interface AppDownloadEntry {
  id: string;
  kind: "apk" | "store";
  label: string;
  sublabel: string;
  filename?: string;
  storeUrl?: string;
}

export const APP_DOWNLOADS: AppDownloadEntry[] =
  appsManifest.apps as AppDownloadEntry[];

export function getAppHref(entry: AppDownloadEntry): string {
  if (entry.kind === "store") return entry.storeUrl ?? "#";
  return `${APPS_BASE_PATH}/${entry.filename}`;
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/config/apps.test.ts`
Expected: PASS.

- [ ] **Step 8: Create `src/components/app-downloads-card.tsx`:**

```tsx
"use client";

import { Button } from "@heroui/react";
import { Download, ExternalLink, Smartphone } from "lucide-react";
import { APP_DOWNLOADS, getAppHref } from "@/config/apps";

interface AppDownloadsCardProps {
  /** "full" = Done-step card with sublabels + sideload note;
   *  "compact" = single row of buttons for the device-picker screen. */
  variant?: "full" | "compact";
}

/** Self-hosted phone-app downloads (2 Android APKs mirrored to our S3) plus
 *  the iOS App Store link. APKs are pinned build-time artifacts — see
 *  app-downloads.sources.json. */
export function AppDownloadsCard({ variant = "full" }: AppDownloadsCardProps) {
  if (variant === "compact") {
    return (
      <div className="glass-card rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-default-500">
          <Smartphone className="w-4 h-4" />
          <span className="font-mono">Phone app:</span>
        </div>
        {APP_DOWNLOADS.map((app) => (
          <Button
            key={app.id}
            as="a"
            href={getAppHref(app)}
            {...(app.kind === "apk"
              ? { download: app.filename }
              : { target: "_blank", rel: "noopener noreferrer" })}
            size="sm"
            variant="flat"
            color="primary"
            startContent={
              app.kind === "apk" ? (
                <Download className="w-3.5 h-3.5" />
              ) : (
                <ExternalLink className="w-3.5 h-3.5" />
              )
            }
            className="font-mono"
          >
            {app.label}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl p-5">
      <h3 className="text-sm font-mono text-default-500 uppercase tracking-wider mb-4">
        Get the phone app
      </h3>
      <div className="space-y-3">
        {APP_DOWNLOADS.map((app) => (
          <div key={app.id} className="flex items-center gap-3">
            <Smartphone className="w-5 h-5 text-default-400 flex-shrink-0" />
            <div className="text-sm flex-1 min-w-0">
              <div className="text-foreground">{app.label}</div>
              <div className="text-xs text-default-500 mt-0.5">
                {app.sublabel}
              </div>
            </div>
            <Button
              as="a"
              href={getAppHref(app)}
              {...(app.kind === "apk"
                ? { download: app.filename }
                : { target: "_blank", rel: "noopener noreferrer" })}
              size="sm"
              variant="flat"
              color="primary"
              startContent={
                app.kind === "apk" ? (
                  <Download className="w-3.5 h-3.5" />
                ) : (
                  <ExternalLink className="w-3.5 h-3.5" />
                )
              }
              className="flex-shrink-0 font-mono"
            >
              {app.kind === "apk" ? "Download APK" : "App Store"}
            </Button>
          </div>
        ))}
      </div>
      <p className="text-xs text-default-500 mt-4">
        Android APKs install directly — your phone will ask you to allow
        installs from unknown sources. Both are official Meshtastic builds,
        mirrored here so they work on con Wi-Fi.
      </p>
    </div>
  );
}
```

- [ ] **Step 9: Place the card.** In `done-step.tsx`: import `AppDownloadsCard` and insert `<AppDownloadsCard />` between the Next-steps card (ends line 311) and the Flash-Another block (line 313). In `wizard-container.tsx`: import it and, inside the `currentStep === "pick-device"` branch, wrap so the compact card renders under the grid:

```tsx
          {currentStep === "pick-device" && (
            <div className="space-y-4">
              <DeviceGrid
                onSelect={selectDevice}
                selectedDevice={selectedDevice}
                onContinue={canAdvance("pick-device") ? advance : undefined}
              />
              <AppDownloadsCard variant="compact" />
            </div>
          )}
```

- [ ] **Step 10: Gitignore mirrored APKs.** Append to `apps/run.flash/webapp/.gitignore`:

```
public/apps/
```

- [ ] **Step 11: Type-check + tests + eyeball**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean. Dev-server eyeball: compact card under the device grid; the two APK links will 404 locally until Task 7's script runs — expected.

- [ ] **Step 12: Commit**

```bash
git add apps/run.flash/webapp/app-downloads.sources.json apps/run.flash/webapp/public/data/apps-manifest.json apps/run.flash/webapp/src/config/apps.ts apps/run.flash/webapp/src/config/apps.test.ts apps/run.flash/webapp/src/components/app-downloads-card.tsx apps/run.flash/webapp/src/components/done/done-step.tsx apps/run.flash/webapp/src/components/wizard/wizard-container.tsx apps/run.flash/webapp/.gitignore
git commit -m "feat(run.flash): self-hosted app downloads card (2 APKs + App Store)"
```

---

### Task 6: Dockerfile Stage 1 rework

**Files:**
- Modify: `apps/run.flash/webapp/Dockerfile.webapp` (Stage 1 entirely; Stage 2 COPY block lines 72-75)

**Interfaces:**
- Consumes: `firmware-versions.json`, `app-downloads.sources.json` (Tasks 1/5).
- Produces: `/firmware/` (all versions' bins + `VERSION.txt` = default version), `/manifest/firmware-manifest.json`, `/manifest/apps-manifest.json`, `/apps/*.apk`, `/hardware/hardware-list.json` (now incl. rp2040).

- [ ] **Step 1: Rewrite Stage 1.** Replace lines 1-47 of `Dockerfile.webapp` with:

```dockerfile
# Stage 1: Vendor firmware versions + phone-app APKs, regenerate device list
FROM node:current-alpine AS firmware
RUN apk add --no-cache curl unzip jq
WORKDIR /firmware

COPY firmware-versions.json app-downloads.sources.json /build-config/

# Hardware list FIRST — the nightly fetcher derives per-target filenames from it.
RUN mkdir -p /hardware && \
    curl -fsSL --retry 5 --retry-all-errors --retry-connrefused \
      https://api.meshtastic.org/resource/deviceHardware \
      | jq '[.[] | select(.architecture == "esp32" or .architecture == "esp32-s3" or .architecture == "esp32-c3" or .architecture == "esp32-c6" or .architecture == "nrf52840" or .architecture == "rp2040")]' \
      > /hardware/hardware-list.json && \
    jq -e 'length > 0' /hardware/hardware-list.json

# Multi-version firmware fetch driven by firmware-versions.json.
# - Pinned slots (pin != ""): GitHub release arch zips, exactly the old path.
# - Empty pin, slot=nightly: resolve meshtastic.github.io firmware-nightly
#   (develop build), fetch per-target factory.bin/.uf2 (folder is flat, unzipped);
#   missing targets warn-and-continue (experimental tier).
# - Empty pin otherwise: resolve releases.stable[0] (legacy behavior).
# Writes /manifest/firmware-manifest.json + /firmware/VERSION.txt (default slot).
RUN set -e; \
    mkdir -p /manifest; \
    CFG=/build-config/firmware-versions.json; \
    NIGHTLY_BASE="https://raw.githubusercontent.com/meshtastic/meshtastic.github.io/master/firmware-nightly"; \
    COUNT=$(jq '.versions | length' "$CFG"); \
    : > /tmp/manifest-entries.jsonl; \
    DEFAULT_VER=""; \
    i=0; \
    while [ "$i" -lt "$COUNT" ]; do \
      SLOT=$(jq -r ".versions[$i].slot" "$CFG"); \
      PIN=$(jq -r ".versions[$i].pin" "$CFG"); \
      LABEL=$(jq -r ".versions[$i].label" "$CFG"); \
      IS_DEFAULT=$(jq -r ".versions[$i].default // false" "$CFG"); \
      IS_EXP=$(jq -r ".versions[$i].experimental // false" "$CFG"); \
      if [ -n "$PIN" ]; then \
        FW_VER="$PIN"; \
      elif [ "$SLOT" = "nightly" ]; then \
        FW_VER=$(curl -fsSL --retry 5 --retry-all-errors --retry-connrefused \
          "$NIGHTLY_BASE/index.json" | jq -r '.version'); \
      else \
        FW_VER=$(curl -fsSL --retry 5 --retry-all-errors --retry-connrefused \
          https://api.meshtastic.org/github/firmware/list \
          | jq -r '.releases.stable[0].id' | sed 's/^v//'); \
      fi; \
      if [ -z "$FW_VER" ] || [ "$FW_VER" = "null" ]; then \
        echo "ERROR: could not resolve version for slot $SLOT" && exit 1; \
      fi; \
      echo "=== Slot $SLOT -> $FW_VER ==="; \
      if [ "$SLOT" = "nightly" ] && [ -z "$PIN" ]; then \
        MISS=0; GOT=0; \
        for T in $(jq -r '.[] | select(.architecture | startswith("esp32")) | .platformioTarget' /hardware/hardware-list.json | sort -u); do \
          if curl -fsSL --retry 2 -o "/firmware/firmware-${T}-${FW_VER}.factory.bin" \
            "$NIGHTLY_BASE/firmware-${T}-${FW_VER}.factory.bin"; then GOT=$((GOT+1)); \
          else rm -f "/firmware/firmware-${T}-${FW_VER}.factory.bin"; MISS=$((MISS+1)); fi; \
        done; \
        for T in $(jq -r '.[] | select(.architecture == "nrf52840" or .architecture == "rp2040") | .platformioTarget' /hardware/hardware-list.json | sort -u); do \
          if curl -fsSL --retry 2 -o "/firmware/firmware-${T}-${FW_VER}.uf2" \
            "$NIGHTLY_BASE/firmware-${T}-${FW_VER}.uf2"; then GOT=$((GOT+1)); \
          else rm -f "/firmware/firmware-${T}-${FW_VER}.uf2"; MISS=$((MISS+1)); fi; \
        done; \
        echo "Nightly $FW_VER: $GOT targets fetched, $MISS missing (warn-only)"; \
        [ "$GOT" -gt 0 ] || { echo "ERROR: nightly fetched zero targets"; exit 1; }; \
      else \
        RELEASE_TAG="v${FW_VER}"; \
        BASE_URL="https://github.com/meshtastic/firmware/releases/download/${RELEASE_TAG}"; \
        for ARCH in esp32 esp32s3 esp32c3 esp32c6 nrf52840 rp2040; do \
          ZIP="firmware-${ARCH}-${FW_VER}.zip"; \
          echo "Downloading ${ZIP}..."; \
          curl -fL --retry 3 --retry-all-errors --retry-connrefused \
            -o "/tmp/${ZIP}" "${BASE_URL}/${ZIP}" || { echo "Warning: ${ZIP} not found"; continue; }; \
          unzip -q -o "/tmp/${ZIP}" "firmware-*.factory.bin" -d /firmware/ 2>/dev/null || true; \
          unzip -q -o "/tmp/${ZIP}" "firmware-*.uf2" -d /firmware/ 2>/dev/null || true; \
          rm -f "/tmp/${ZIP}"; \
        done; \
        [ "$(find /firmware -name "firmware-*-${FW_VER}.*" | wc -l)" -gt 0 ] || \
          { echo "ERROR: slot $SLOT ($FW_VER) produced zero firmware files"; exit 1; }; \
      fi; \
      jq -n --arg slot "$SLOT" --arg version "$FW_VER" --arg label "$LABEL" \
        --argjson default "$IS_DEFAULT" --argjson experimental "$IS_EXP" \
        '{slot:$slot, version:$version, label:$label, default:$default, experimental:$experimental}' \
        >> /tmp/manifest-entries.jsonl; \
      [ "$IS_DEFAULT" = "true" ] && DEFAULT_VER="$FW_VER"; \
      i=$((i+1)); \
    done; \
    find /firmware -name "*-update.bin" -delete; \
    jq -s '{versions: .}' /tmp/manifest-entries.jsonl > /manifest/firmware-manifest.json; \
    jq -e '[.versions[] | select(.default)] | length == 1' /manifest/firmware-manifest.json; \
    [ -n "$DEFAULT_VER" ] || { echo "ERROR: no default slot"; exit 1; }; \
    echo "$DEFAULT_VER" > /firmware/VERSION.txt; \
    echo "Baked $(find /firmware -name 'firmware-*' | wc -l) firmware files across $COUNT versions"

# Mirror phone-app APKs (offline guarantee — GitHub URLs never reach runtime).
# Hard-fail on any download error: these links are load-bearing at con.
RUN set -e; \
    mkdir -p /apps; \
    SRC=/build-config/app-downloads.sources.json; \
    COUNT=$(jq '[.apps[] | select(.kind == "apk")] | length' "$SRC"); \
    i=0; \
    while [ "$i" -lt "$COUNT" ]; do \
      URL=$(jq -r "[.apps[] | select(.kind == \"apk\")][$i].url" "$SRC"); \
      FN=$(jq -r "[.apps[] | select(.kind == \"apk\")][$i].filename" "$SRC"); \
      echo "Downloading $FN ..."; \
      curl -fL --retry 3 --retry-all-errors --retry-connrefused -o "/apps/$FN" "$URL"; \
      [ "$(wc -c < "/apps/$FN")" -gt 10000000 ] || { echo "ERROR: $FN suspiciously small"; exit 1; }; \
      i=$((i+1)); \
    done; \
    jq '{apps: [.apps[] | del(.url)]}' "$SRC" > /manifest/apps-manifest.json; \
    jq -e '.apps | length > 0' /manifest/apps-manifest.json
```

- [ ] **Step 2: Update the Stage 2 COPY block** (previously lines 72-75) to:

```dockerfile
# Firmware binaries + APKs into public/ for build.sh S3 extraction; runtime
# manifests overwrite the tracked public/data/ snapshots BEFORE npm run build
# so the statically-imported JSON matches the baked artifacts.
COPY --from=firmware /firmware/ ./public/firmware/
COPY --from=firmware /firmware/VERSION.txt /tmp/FIRMWARE_VERSION
COPY --from=firmware /hardware/hardware-list.json ./public/data/hardware-list.json
COPY --from=firmware /manifest/firmware-manifest.json ./public/data/firmware-manifest.json
COPY --from=firmware /manifest/apps-manifest.json ./public/data/apps-manifest.json
COPY --from=firmware /apps/ ./public/apps/
```

Leave the `ARG FIRMWARE_VERSION` pin? The old single-version ARG is now dead — delete the `ARG FIRMWARE_VERSION=""` block and its comment (pins live in `firmware-versions.json`).

- [ ] **Step 3: Verify with a local image build** (Stage 1 is network-heavy, ~2GB of downloads):

Run (from `apps/run.flash/webapp/`): `docker build -f Dockerfile.webapp --target firmware -t flash-fw-test . 2>&1 | tail -30`
Expected: ends with the "Baked N firmware files across 3 versions" line, APK downloads succeed, exit 0. Then sanity-check the outputs:

```bash
docker run --rm flash-fw-test sh -c 'cat /manifest/firmware-manifest.json; ls /apps; ls /firmware | grep -c factory.bin'
```

Expected: manifest with 3 entries (nightly version resolved), 2 .apk files, factory.bin count in the hundreds.

- [ ] **Step 4: Full image build** (proves the DPLY-06 gate + next build still pass):

Run: `docker build -f Dockerfile.webapp -t flash-webapp-test . 2>&1 | tail -15`
Expected: build completes; the grep-gate RUN passes (no meshtastic hostnames in bundle).

- [ ] **Step 5: Commit**

```bash
git add apps/run.flash/webapp/Dockerfile.webapp
git commit -m "feat(run.flash): bake 3 firmware versions + APK mirror in Docker stage 1"
```

---

### Task 7: Local dev scripts parity

**Files:**
- Modify: `apps/run.flash/webapp/scripts/download-firmware.sh` (multi-version + nightly + manifest snapshot)
- Modify: `apps/run.flash/webapp/scripts/generate-hardware-list.sh` (add nrf52840 + rp2040)
- Create: `apps/run.flash/webapp/scripts/download-apps.sh`
- Modify: `apps/run.flash/webapp/public/data/hardware-list.json` (regenerated)

**Interfaces:**
- Consumes: `firmware-versions.json`, `app-downloads.sources.json`.
- Produces: local `public/firmware/*`, `public/apps/*.apk`, refreshed `public/data/*.json` snapshots.

- [ ] **Step 1: Update `generate-hardware-list.sh`** — change the jq filter line to:

```bash
  | jq '[.[] | select(.architecture == "esp32" or .architecture == "esp32-s3" or .architecture == "esp32-c3" or .architecture == "esp32-c6" or .architecture == "nrf52840" or .architecture == "rp2040")]' \
```

and update the header comment's architecture set to match. Run it: `./scripts/generate-hardware-list.sh` — expect ~99 entries written; the tracked `public/data/hardware-list.json` now includes nrf52840 + rp2040 devices (this also fixes the pre-existing local/Docker drift where the script lacked nrf52840).

- [ ] **Step 2: Rewrite `download-firmware.sh`** to loop the same slots as the Dockerfile. Keep its interface: no args = all slots; one arg = that single explicit version (legacy pin path). Reuse the Dockerfile logic in bash (arrays allowed — this is `#!/usr/bin/env bash`, not busybox): resolve each slot's version (pin / nightly index.json / stable[0]), release slots via arch zips with `ARCH_ZIPS` extended to include `firmware-nrf52840-*` and `firmware-rp2040-*` and extracting both `firmware-*.factory.bin` AND `firmware-*.uf2`, nightly slot via the flat-folder per-target fetch driven by `public/data/hardware-list.json`. After the loop: write `public/data/firmware-manifest.json` via the same `jq -n` per-entry + `jq -s '{versions: .}'` pattern, and write `NEXT_PUBLIC_FIRMWARE_VERSION=<default slot version>` into `.env.local` (existing idempotent block unchanged).

- [ ] **Step 3: Create `scripts/download-apps.sh`:**

```bash
#!/usr/bin/env bash
# Mirror the pinned phone-app APKs for local dev (Dockerfile parity).
# Reads app-downloads.sources.json; writes public/apps/ + refreshes the
# tracked public/data/apps-manifest.json snapshot.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBAPP_DIR="$(dirname "$SCRIPT_DIR")"
SRC="$WEBAPP_DIR/app-downloads.sources.json"
APPS_DIR="$WEBAPP_DIR/public/apps"

mkdir -p "$APPS_DIR"

COUNT=$(jq '[.apps[] | select(.kind == "apk")] | length' "$SRC")
for ((i = 0; i < COUNT; i++)); do
  URL=$(jq -r "[.apps[] | select(.kind == \"apk\")][$i].url" "$SRC")
  FN=$(jq -r "[.apps[] | select(.kind == \"apk\")][$i].filename" "$SRC")
  echo "Downloading $FN ..."
  curl -fL --retry 3 -o "$APPS_DIR/$FN" "$URL"
done

jq '{apps: [.apps[] | del(.url)]}' "$SRC" > "$WEBAPP_DIR/public/data/apps-manifest.json"
echo "Mirrored $COUNT APKs to $APPS_DIR and refreshed apps-manifest.json"
```

`chmod +x scripts/download-apps.sh`.

- [ ] **Step 4: Run both scripts end-to-end**

Run: `./scripts/download-firmware.sh && ./scripts/download-apps.sh`
Expected: firmware for all three versions lands in `public/firmware/` (nightly reports fetched/missing counts), `public/data/firmware-manifest.json` matches the committed snapshot (same pins; nightly version may have advanced — if it did, commit the refreshed snapshot), 2 APKs in `public/apps/` (gitignored), apps-manifest unchanged.

- [ ] **Step 5: Full test suite + tsc**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean — proves the regenerated snapshots still satisfy the manifest tests.

- [ ] **Step 6: Commit**

```bash
git add apps/run.flash/webapp/scripts/download-firmware.sh apps/run.flash/webapp/scripts/generate-hardware-list.sh apps/run.flash/webapp/scripts/download-apps.sh apps/run.flash/webapp/public/data/hardware-list.json apps/run.flash/webapp/public/data/firmware-manifest.json
git commit -m "feat(run.flash): local script parity — multi-version, nightly, rp2040, APK mirror"
```

---

### Task 8: Ship — PR, release, deploy, live verify

**Files:** none new (release mechanics).

- [ ] **Step 1: Push branch + open the feature PR**

```bash
git push -u origin feat/flash-multi-firmware-app-downloads
gh pr create --title "feat(run.flash): firmware version picker (2.7.26/2.7.15/2.8 nightly), rp2040, app downloads" --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-07-23-flash-multi-firmware-app-downloads-design.md

- Three baked firmware versions with a Flash-step picker (default 2.7.26 stable; 2.7.15; 2.8.0 develop nightly, experimental-flagged, frozen at build time)
- rp2040 device support via the existing UF2 flow (RAK 11310, RP2040 LoRa, Pico) — full browser-flashable coverage
- Self-hosted phone-app downloads: Android 2.7.13 (last known-good BLE) + 2.8.0-open.1 APKs mirrored to S3, iOS App Store link; Done step + device-picker placements
- DPLY-06 offline gate intact — upstream URLs are build-time only

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Merge the feature PR** (authorized in session: "go all the way"): `gh pr merge --squash --admin`. If it errors locally on branch cleanup ("main is already used by worktree") check `gh pr view --json state` — remote merges succeed despite that local error; do NOT retry the merge.

- [ ] **Step 3: Release.** From the worktree root:

```bash
cp /Users/khundeck/working/defcon.run.34/env.local.sh ./env.local.sh   # LANDMINE: do this FIRST
git checkout main && git pull   # release runs from updated main
./apps/release-all.sh --apps run.flash --pr
```

Expected: image builds (Stage 1 now downloads ~2GB — allow time), pushes to ECR, S3 static sync succeeds (if it exits 255 at the S3 step, the env.local.sh landmine bit — fix and re-run `AWS_REGION=us-east-1 ./apps/build.sh webapp run.flash`), Release PR opens.

- [ ] **Step 4: Deploy via CI**

```bash
gh workflow run deploy.yml -f region=us-east-1 -f pr_number=<ReleasePR#> -f invalidate_cache=true
gh run watch <run-id>
```

- [ ] **Step 5: Live verify**

```bash
# app is auth-gated; signin page proves the new task serves
curl -s https://flash.defcon.run/use1/signin/ | grep -oE 'v0\.0\.[0-9]+'
# firmware for each version slot (esp32 example target + a uf2 target)
curl -sI -o /dev/null -w '%{http_code}\n' "https://flash.defcon.run/use1/assets/firmware/firmware-tbeam-2.7.26.54e0d8d.factory.bin"
curl -sI -o /dev/null -w '%{http_code}\n' "https://flash.defcon.run/use1/assets/firmware/firmware-tbeam-2.7.15.567b8ea.factory.bin"
curl -sI -o /dev/null -w '%{http_code}\n' "https://flash.defcon.run/use1/assets/firmware/firmware-tbeam-<nightly-version>.factory.bin"
curl -sI -o /dev/null -w '%{http_code}\n' "https://flash.defcon.run/use1/assets/firmware/firmware-rak11310-2.7.26.54e0d8d.uf2"
# both APKs
curl -sI -o /dev/null -w '%{http_code}\n' "https://flash.defcon.run/use1/assets/apps/meshtastic-android-2.7.13.apk"
curl -sI -o /dev/null -w '%{http_code}\n' "https://flash.defcon.run/use1/assets/apps/meshtastic-android-2.8.0-open.1.apk"
```

Expected: all 200 (rp2040 target name per hardware-list; adjust exact filenames from the baked manifest if needed).

- [ ] **Step 6: Hand off for UAT** — report to Kurt: signed-in wizard check (picker default 2.7.26, nightly chip), one real-radio default-path flash, one nightly-path flash + Configure bench test, phone APK install check.

---

## Self-Review Notes

- Spec §1 → Tasks 1, 6, 7. Spec §2 → Tasks 3, 4. Spec §3 → Tasks 2, 6, 7. Spec §4 → Task 5, 6. Spec §5 (testing) → per-task test steps + Task 8 verify. Spec §6 → Task 8. No gaps.
- Type consistency: `FirmwareVersionEntry`/`FIRMWARE_VERSIONS`/`DEFAULT_FIRMWARE_VERSION` (T1) consumed by T3/T4; `flash(..., version?)` defined in T3, consumed in T4; `AppDownloadEntry`/`getAppHref` (T5) self-contained.
- `hardware-list.json` regeneration ordered AFTER script fix (T7) so the snapshot and script agree in one commit.
