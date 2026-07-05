import { afterEach, describe, expect, it, vi } from "vitest";
import { runHumanUrl } from "@/lib/run-human-url";

/**
 * runHumanUrl unit tests (Plan 34-05, BIB-ADM-10).
 *
 * runHumanUrl is the single region-prefix helper for every cross-app link into
 * run.defcon.run (dropdown Profile/Check-in/QR + header/mobile Meshtastic).
 * run.defcon.run is mounted under /{region} (CloudFront routes /{region}/*), so
 * a region-less URL misroutes. These tests pin two invariants:
 *
 *   1. Default region is use1 when NEXT_PUBLIC_REGION_SHORT is unset, and the
 *      host is hardcoded to run.defcon.run (mirrors flash's RUN_BASE).
 *   2. The region is read at CALL time (not import/module-eval time), so a
 *      cac1 deployment's client bundle routes to /cac1/* — vi.stubEnv proves
 *      the call-time read.
 */

describe("runHumanUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to the use1 region + run.defcon.run host when unset", () => {
    vi.stubEnv("NEXT_PUBLIC_REGION_SHORT", "");
    expect(runHumanUrl("/whoami")).toBe("https://run.defcon.run/use1/whoami");
  });

  it("region-prefixes with NEXT_PUBLIC_REGION_SHORT read at call time", () => {
    vi.stubEnv("NEXT_PUBLIC_REGION_SHORT", "cac1");
    expect(runHumanUrl("/?open=checkin")).toBe(
      "https://run.defcon.run/cac1/?open=checkin"
    );
  });

  it("preserves the ?open=qr deep-link path", () => {
    vi.stubEnv("NEXT_PUBLIC_REGION_SHORT", "use1");
    expect(runHumanUrl("/?open=qr")).toBe(
      "https://run.defcon.run/use1/?open=qr"
    );
  });

  it("builds the meshtastic nav link", () => {
    vi.stubEnv("NEXT_PUBLIC_REGION_SHORT", "cac1");
    expect(runHumanUrl("/meshtastic")).toBe(
      "https://run.defcon.run/cac1/meshtastic"
    );
  });
});
