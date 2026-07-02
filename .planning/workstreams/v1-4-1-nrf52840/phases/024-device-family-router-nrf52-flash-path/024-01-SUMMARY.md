---
phase: 024-device-family-router-nrf52-flash-path
plan: 01
subsystem: run.flash / webapp
tags: [webapp, hooks, router, nrf52, dockerfile, hardware-list]
requires:
  - v1.4 shipped (esptool-js 0.6.0 + tlora-t3s3 dio override live on main)
provides:
  - "types/device.ts: NRF52_ARCHITECTURES, isNrf52Device, DeviceFamily, getDeviceFamily"
  - "hooks/use-flash-esp32.ts: verbatim extract of prior useFlash body as useFlashEsp32"
  - "hooks/use-flash-nrf52.ts: typed UseFlashNrf52Return stub, flash() throws for Plan 24-02"
  - "hooks/use-flash.ts: thin family-aware router preserving public UseFlashReturn shape"
  - "Dockerfile.webapp Stage 1: nrf52840 in ARCH loop + .uf2 unzip step + hardware-list jq filter admits nrf52840"
affects:
  - "hooks/use-flash.ts consumers (unchanged public shape — no consumer edits required)"
  - "Docker build: hardware-list.json now surfaces T-1000E slug; public/firmware/ ships .uf2 alongside .factory.bin"
tech-stack:
  added: []
  patterns:
    - "family-aware router hook (calls all delegates at top level per rules-of-hooks; dispatches on getDeviceFamily(device))"
    - "verbatim extract-and-move refactor (delegate is byte-identical to pre-phase body; reviewer eyeballs git-log -p)"
    - "fail-fast on unknown architectures (getDeviceFamily throws — no silent ESP32 fallback)"
key-files:
  created:
    - apps/run.flash/webapp/src/hooks/use-flash-esp32.ts
    - apps/run.flash/webapp/src/hooks/use-flash-nrf52.ts
  modified:
    - apps/run.flash/webapp/src/types/device.ts
    - apps/run.flash/webapp/src/config/devices.ts
    - apps/run.flash/webapp/src/hooks/use-flash.ts
    - apps/run.flash/webapp/Dockerfile.webapp
decisions:
  - "Extract-and-dispatch (CONTEXT D-01): useFlashEsp32 is a verbatim move so SC4 zero-regression is enforced by construction"
  - "Router calls BOTH delegates at top level (rules-of-hooks); active-family ref selects which delegate's state to expose"
  - "getDeviceFamily throws on unknown architectures (CONTEXT D-03 fail-fast — no silent ESP32 fallback that could brick unknown devices)"
  - "RECOMMENDED_SLUGS untouched (CONTEXT D-05: 5 ESP32 slugs frozen pending Phase 25 SC4 hardware verify); TODO comment added above the set"
  - "nRF52 stub throws 'nRF52 flash not yet implemented — Plan 24-02' (matches must_haves.truths verbatim)"
  - "Transport arg widened to ESPLoader | unknown at router boundary; Plan 24-02 narrows unknown → DfuDevice"
metrics:
  duration: 24m
  started: 2026-07-02T05:42:00Z
  completed: 2026-07-02T06:06:00Z
  tasks_completed: 2
  files_touched: 5
requirements:
  - DEVC-07
  - DPLY-07
must_haves_verified_here:
  - "getDeviceFamily(device) returns 'esp32' / 'nrf52' correctly (unit-verifiable in code, offline dry-run below)"
  - "useFlash is a router (visible in git diff — 217 LOC useFlash body -> 97 LOC router)"
  - "useFlashEsp32 is a byte-identical extract (git-diff evidence in Task 1 commit)"
  - "useFlashNrf52 stub throws 'nRF52 flash not yet implemented' (grep-verified)"
  - "Recommended set is unchanged, still 5 ESP32 slugs (grep -c returned 5)"
  - "Dockerfile Stage 1 admits nrf52840 + extracts .uf2 (grep-verified in Dockerfile.webapp)"
  - "tsc --noEmit clean (SC5 code-side)"
  - "next build succeeds (SC5)"
  - "DPLY-06 offline gate passes locally against .next/standalone + .next/static"
must_haves_deferred_to_human_verification:
  - "docker build --no-cache -f Dockerfile.webapp on the current Meshtastic stable release + hardware-list.json contains SEEED_TRACKER_T1000_E after build — no docker daemon in this sandbox"
  - "public/firmware/ contains firmware-t1000-e-{version}.uf2 in the built image — requires successful docker build"
---

# Phase 024 Plan 01: Device-family router + nRF52 Dockerfile Stage 1 Summary

## One-liner
Split `useFlash` into a family-aware router hook dispatching by `deviceHardware.architecture` and extend `Dockerfile.webapp` Stage 1 so `nrf52840` (T-1000E) firmware and hardware-list entry ship alongside the ESP32 set — zero ESP32 regression by construction (verbatim extract) and DPLY-06 offline gate untouched.

## Objectives Achieved

Router contract in place so Plan 24-02 can drop in the Web USB DFU write path with zero orchestration work:

- `types/device.ts` gains `NRF52_ARCHITECTURES = ["nrf52840"]`, `isNrf52Device`, `DeviceFamily = "esp32" | "nrf52"`, and `getDeviceFamily(device)` that throws on unknown architectures.
- `hooks/use-flash-esp32.ts` (new, 216 LOC) is a byte-identical extract of the prior `useFlash` body — every stage, the `tlora-t3s3 -> "dio"` quirk at lines 104–106, the `beforeunload` effect, and the state/refs all carried verbatim. Only the exported function name (`useFlash` → `useFlashEsp32`) and the return interface name (`UseFlashReturn` → `UseFlashEsp32Return`) changed.
- `hooks/use-flash-nrf52.ts` (new, 89 LOC) is a typed stub matching the `UseFlashEsp32Return` public shape. Its `flash()` throws `nRF52 flash not yet implemented — Plan 24-02`. Transport arg is `unknown` pending Plan 24-02's DFU library shootout narrowing.
- `hooks/use-flash.ts` (rewritten, 97 LOC — down from 217) is now a thin router: calls both delegates at the top level per rules-of-hooks, tracks last-active family in a ref, exposes the same public `UseFlashReturn` shape (so no consumer changes needed), dispatches on `getDeviceFamily(device)`.
- `config/devices.ts` gains a `// TODO(v1.4.1 close-out): promote T-1000E ...` marker above `RECOMMENDED_SLUGS`. Set contents unchanged — still 5 ESP32 slugs.
- `Dockerfile.webapp` Stage 1: `nrf52840` added to the `for ARCH in ...` loop; a parallel `unzip -q -o "/tmp/${ZIP}" "firmware-*.uf2" -d /firmware/` step runs alongside the existing `.factory.bin` extraction; the hardware-list jq filter admits `or .architecture == "nrf52840"` so `SEEED_TRACKER_T1000_E` surfaces in the regenerated `hardware-list.json`.

## Router Shape (as landed)

```typescript
export interface UseFlashReturn {
  progress: FlashProgress;
  isFlashing: boolean;
  isComplete: boolean;
  isError: boolean;
  flash: (
    transport: ESPLoader | unknown,       // widened at router boundary
    device: DeviceHardware,
    appendLog: (text: string) => void
  ) => Promise<void>;
  reset: () => void;
}

export function useFlash(): UseFlashReturn {
  const esp32 = useFlashEsp32();          // both delegates called unconditionally
  const nrf52 = useFlashNrf52();          //   at the top level (rules-of-hooks)
  const activeFamilyRef = useRef<DeviceFamily>("esp32");

  const flash = useCallback(async (transport, device, appendLog) => {
    const family = getDeviceFamily(device);
    activeFamilyRef.current = family;
    if (family === "esp32") {
      return esp32.flash(transport as ESPLoader, device, appendLog);
    }
    return nrf52.flash(transport, device, appendLog);
  }, [esp32, nrf52]);

  const reset = useCallback(() => { esp32.reset(); nrf52.reset(); }, [esp32, nrf52]);
  const active = activeFamilyRef.current === "esp32" ? esp32 : nrf52;

  return {
    progress: active.progress,
    isFlashing: active.isFlashing,
    isComplete: active.isComplete,
    isError: active.isError,
    flash,
    reset,
  };
}
```

Public shape identical to pre-phase — the only signature widening is `flash`'s `transport` argument moving from `ESPLoader` to `ESPLoader | unknown` (Plan 24-02 narrows `unknown` → `DfuDevice`).

## useFlashEsp32 LOC Evidence (verbatim-extract claim)

```
apps/run.flash/webapp/src/hooks/use-flash-esp32.ts | 216 ++++++++++++++++++++
apps/run.flash/webapp/src/hooks/use-flash-nrf52.ts |  89 +++++++++
apps/run.flash/webapp/src/hooks/use-flash.ts       | 221 +++++----------------
 3 files changed, 356 insertions(+), 170 deletions(-)
```

Pre-phase `use-flash.ts` was 217 LOC. Post-phase: `use-flash-esp32.ts` is 216 LOC (delta of 1 line — the interface rename from `UseFlashReturn` → `UseFlashEsp32Return` + `export` qualifier on the interface), and `use-flash.ts` shrank to 97 LOC (routing only). Reviewers can eyeball `git log -p` for the ESP32 delegate and see every logic branch preserved, including the `tlora-t3s3` `"dio"` override on lines 104–106.

## Automated Verification Evidence (in-sandbox)

**Task 1 grep gates (all passed):**
```
OK NRF52_ARCHITECTURES        (in src/types/device.ts)
OK getDeviceFamily            (in src/types/device.ts)
OK useFlashEsp32 imported     (in src/hooks/use-flash.ts)
OK useFlashNrf52 imported     (in src/hooks/use-flash.ts)
OK stub throw message         ('nRF52 flash not yet implemented' in use-flash-nrf52.ts)
OK TODO comment               ('TODO(v1.4.1 close-out)' above RECOMMENDED_SLUGS)
Recommended slug count: 5     (HELTEC_V3, TBEAM, TLORA_V2_1_1P6, RAK4631, STATION_G2)
```

**Task 2 grep gates (all passed):**
```
OK nrf52840 present            (in Dockerfile.webapp)
OK .uf2 unzip line present     (firmware-*.uf2)
OK jq filter extended          (or .architecture == "nrf52840")
```

**Type-check + build (SC5):**
- `npx tsc --noEmit` — clean (no output means zero errors).
- `NEXT_PUBLIC_FIRMWARE_VERSION=2.7.7 npx next build` — succeeded, 7 static pages generated, 4 dynamic routes compiled.
- Post-build DPLY-06 offline-gate grep reproduced locally against `.next/standalone` and `.next/static`: **PASS** (no `api.meshtastic.org` or `github.com/meshtastic` strings).

**Offline dry-run of extended jq filter** against a simulated 3-row hardware-list (esp32-s3 HELTEC_V3, nrf52840 T-1000E, stm32 unknown):
```json
[
  {"hwModel":9,"hwModelSlug":"HELTEC_V3","architecture":"esp32-s3", ...},
  {"hwModel":76,"hwModelSlug":"SEEED_TRACKER_T1000_E","architecture":"nrf52840", ...}
]
```
Filter correctly admits both ESP32-family and nRF52840 rows and rejects the unknown `stm32` arch. This proves the jq filter change is syntactically valid and semantically correct without needing a live `curl` against api.meshtastic.org.

## Human Verification Required (Docker build gate — sandbox blocked)

The plan's Task 2 `<automated>` block calls `docker build --no-cache -f Dockerfile.webapp ...` against the current Meshtastic stable release and then a `docker run` shell to confirm:
1. Stage 1 log line reports `Extracted N firmware binaries` where N includes at least one `.uf2`.
2. Built image contains `SEEED_TRACKER_T1000_E` in `/app/public/data/hardware-list.json`.
3. Built image contains at least one `firmware-*.uf2` in `/app/public/firmware/`.
4. Stage 2 DPLY-06 offline-gate grep still passes on the real build (not just local `next build`).

**Sandbox status:** no docker daemon (`command -v docker` → absent; `/var/run/docker.sock` → missing). These four verifications must be re-run outside the sandbox before the phase-24 wave is considered fully hardware-clean.

Recommended verification command (paste into a shell with docker + network):
```bash
docker build --no-cache -f apps/run.flash/webapp/Dockerfile.webapp \
  -t dc34-run-flash-app:phase24-p1 apps/run.flash/webapp/ \
  2>&1 | tee /tmp/build24-1.log | grep -qE 'Extracted [0-9]+ firmware binaries' && \
docker run --rm dc34-run-flash-app:phase24-p1 sh -c \
  'grep -q SEEED_TRACKER_T1000_E /app/public/data/hardware-list.json && \
   ls /app/public/firmware/ | grep -qE "\.uf2$" && \
   echo "FIRMWARE UF2 PRESENT: $(ls /app/public/firmware/ | grep uf2)"'
```

Note: this is a **build-in-loop** verification, not a hardware-in-loop verification. It confirms Meshtastic upstream ships `firmware-nrf52840-{version}.zip` at the release URL pattern and that the built container carries the artifacts. Actual T-1000E flash-and-boot from those `.uf2` bytes remains Phase 25's SC4 gate.

## Deviations from Plan

None. Plan executed exactly as written. `use-flash-esp32.ts` extended past `min_lines: 180` (landed at 216 LOC) and `use-flash-nrf52.ts` past `min_lines: 20` (landed at 89 LOC), both intentional to preserve the full public shape rather than shortcut the stub.

Small nicety carried in Task 2 that wasn't required but improves the build log signal: the `echo "Extracted ..."` line now counts `.factory.bin` + `.uf2` files together (previously `.factory.bin` only) so a build reviewer sees the true delivered artifact count. Trivial extension of the existing log statement, not a deviation from any locked decision.

## Threat Flags

None. This plan introduces:
- No new network endpoints (Docker build-time fetch endpoints unchanged — same `api.meshtastic.org` + `github.com/meshtastic` URLs, one additional `${ARCH}` value in the existing URL pattern).
- No new auth paths.
- No new file-access patterns (`.uf2` extraction is a sibling of `.factory.bin` extraction into the same `/firmware/` directory).
- No trust-boundary changes vs. the STRIDE register in the plan's `<threat_model>` (T-24.1-01 through T-24.1-SC unchanged).

## Commits

| Task | Description                                                                                          | Hash       |
| ---- | ---------------------------------------------------------------------------------------------------- | ---------- |
| 1    | refactor(024-01): extract useFlash into family-aware router + delegates                              | `bd8c828f` |
| 2    | feat(024-01): extend Dockerfile Stage 1 for nrf52840 + .uf2 artifact + hardware-list                 | `56f6a6fb` |

## Files Touched

**Created:**
- `apps/run.flash/webapp/src/hooks/use-flash-esp32.ts` (216 LOC — verbatim extract)
- `apps/run.flash/webapp/src/hooks/use-flash-nrf52.ts` (89 LOC — typed stub)

**Modified:**
- `apps/run.flash/webapp/src/types/device.ts` (+30 LOC: `NRF52_ARCHITECTURES`, `isNrf52Device`, `DeviceFamily`, `getDeviceFamily`)
- `apps/run.flash/webapp/src/config/devices.ts` (+1 LOC: TODO comment above `RECOMMENDED_SLUGS`)
- `apps/run.flash/webapp/src/hooks/use-flash.ts` (rewritten as 97-LOC router; -120 net LOC vs. pre-phase 217)
- `apps/run.flash/webapp/Dockerfile.webapp` (+4 LOC / -3 LOC: `nrf52840` in ARCH loop + `.uf2` unzip + jq filter)

## Self-Check: PASSED

- `apps/run.flash/webapp/src/types/device.ts` FOUND, contains `NRF52_ARCHITECTURES` + `getDeviceFamily`
- `apps/run.flash/webapp/src/config/devices.ts` FOUND, contains `TODO(v1.4.1 close-out)` above `RECOMMENDED_SLUGS`
- `apps/run.flash/webapp/src/hooks/use-flash.ts` FOUND, contains `useFlashEsp32` + `useFlashNrf52` imports
- `apps/run.flash/webapp/src/hooks/use-flash-esp32.ts` FOUND (new, 216 LOC — verbatim extract with `tlora-t3s3` quirk preserved)
- `apps/run.flash/webapp/src/hooks/use-flash-nrf52.ts` FOUND (new, 89 LOC — throws `nRF52 flash not yet implemented`)
- `apps/run.flash/webapp/Dockerfile.webapp` FOUND, contains `nrf52840` in `for ARCH` loop + `firmware-*.uf2` unzip + `or .architecture == "nrf52840"` jq filter
- Commit `bd8c828f` FOUND on `gsd/v1.4.1-wave`
- Commit `56f6a6fb` FOUND on `gsd/v1.4.1-wave`
- `tsc --noEmit` FOUND clean
- `next build` FOUND succeeded
- Local reproduction of DPLY-06 offline-gate grep FOUND clean
