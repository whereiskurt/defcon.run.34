import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MESHTK_FLEET_YAML } from "@/data/meshtk-fleet-yaml";
import {
  ghostCtfLinks,
  getMeshGhost,
  loadMeshGhosts,
  revealGhostOtp,
  type CtfRowLike,
} from "@/lib/mesh-ghosts";
import { deriveTotpSecret } from "@/lib/mesh-otp-derive";

/** Canonical fleet config in the monorepo (reachable in dev/CI, not in the image). */
const CANONICAL = resolve(
  __dirname,
  "../../../../../run.mqtt/meshtk/meshtk.dc34.yaml",
);

describe("snapshot parity", () => {
  it.skipIf(!existsSync(CANONICAL))(
    "committed snapshot is byte-identical to apps/run.mqtt/meshtk/meshtk.dc34.yaml (fix: node scripts/sync-meshtk-fleet.mjs)",
    () => {
      expect(MESHTK_FLEET_YAML).toBe(readFileSync(CANONICAL, "utf-8"));
    },
  );
});

describe("loadMeshGhosts", () => {
  const ghosts = loadMeshGhosts();

  it("finds the 10 ghost fleet entries and no rabbits", () => {
    expect(ghosts).toHaveLength(10);
    expect(ghosts.every((g) => g.id.startsWith("ghost."))).toBe(true);
  });

  it("extracts identity + config for a known ghost", () => {
    const g = getMeshGhost("ghost.goldstein");
    expect(g).toBeDefined();
    expect(g?.slug).toBe("goldstein");
    expect(g?.behaviours).toContain("chatbot");
    expect(g?.longNameTmpl).toContain("goldstein");
    expect(g?.chatbot.some((r) => r.type === "otp_success" && r.requiresOtp)).toBe(
      true,
    );
  });

  it("extracts the covert flag code from persona prompts", () => {
    expect(getMeshGhost("ghost.goldstein")?.flagCode).toBe("hackers4evr");
    expect(getMeshGhost("ghost.mudge")?.flagCode).toBe("0g3l33t");
    expect(getMeshGhost("ghost.condor")?.flagCode).toBe("fr33k3v1n");
  });

  it("carries committed otpauth URLs for the OTP-bearing ghosts", () => {
    const withOtp = ghosts.filter((g) => g.hasOtp);
    expect(withOtp.length).toBe(8);
    for (const g of withOtp) {
      expect(g.committedOtpauth).toMatch(/^otpauth:\/\/totp\//);
      expect(new URL(g.committedOtpauth!).searchParams.get("secret")).toBeTruthy();
    }
  });
});

describe("ghostCtfLinks", () => {
  const goldstein = getMeshGhost("ghost.goldstein")!;
  const committed = new URL(goldstein.committedOtpauth!).searchParams.get(
    "secret",
  )!;
  const derived = deriveTotpSecret("test-server-secret", "ghost.goldstein", committed);

  const rows: CtfRowLike[] = [
    { challenge: "goldstein", enabled: true, answerType: "static" },
    {
      challenge: "goldstein-otp",
      enabled: true,
      answerType: "otp",
      otp: { secret: committed },
    },
    { challenge: "unrelated", enabled: true, otp: { secret: "AAAA" } },
  ];

  it("joins by name and flags a committed-secret row as STALE", () => {
    const links = ghostCtfLinks(goldstein, rows, "test-server-secret");
    expect(links.map((l) => l.challenge)).toEqual(["goldstein", "goldstein-otp"]);
    expect(links[0].secretState).toBe("none");
    expect(links[1].secretState).toBe("committed");
  });

  it("reports derived (in-sync) when the row holds the derived secret", () => {
    const synced = ghostCtfLinks(
      goldstein,
      [{ challenge: "goldstein-otp", answerType: "otp", otp: { secret: derived } }],
      "test-server-secret",
    );
    expect(synced[0].secretState).toBe("derived");
  });

  it("matches by secret even when the name differs, and by name without a server secret", () => {
    const bySecret = ghostCtfLinks(
      goldstein,
      [{ challenge: "renamed-chain", otp: { secret: committed } }],
      undefined,
    );
    expect(bySecret).toHaveLength(1);
    expect(bySecret[0].secretState).toBe("committed");
    const other = ghostCtfLinks(
      goldstein,
      [{ challenge: "goldstein-otp", otp: { secret: "ZZZZ" } }],
      undefined,
    );
    expect(other[0].secretState).toBe("other");
  });
});

describe("revealGhostOtp", () => {
  const OLD = process.env.MESHTK_GHOST_KEY_SECRET;
  afterEach(() => {
    if (OLD === undefined) delete process.env.MESHTK_GHOST_KEY_SECRET;
    else process.env.MESHTK_GHOST_KEY_SECRET = OLD;
  });

  it("returns configured:false without the server secret", () => {
    delete process.env.MESHTK_GHOST_KEY_SECRET;
    expect(revealGhostOtp("ghost.goldstein")).toEqual({
      ghostId: "ghost.goldstein",
      configured: false,
    });
  });

  it("derives the deployed-bot otpauth when configured", () => {
    process.env.MESHTK_GHOST_KEY_SECRET = "test-server-secret";
    const reveal = revealGhostOtp("ghost.goldstein");
    expect(reveal?.configured).toBe(true);
    expect(reveal?.secret).toBe(
      deriveTotpSecret(
        "test-server-secret",
        "ghost.goldstein",
        reveal!.committedSecret!,
      ),
    );
    expect(new URL(reveal!.otpauth!).searchParams.get("secret")).toBe(
      reveal!.secret,
    );
  });

  it("returns null for unknown or OTP-less ghosts", () => {
    process.env.MESHTK_GHOST_KEY_SECRET = "test-server-secret";
    expect(revealGhostOtp("ghost.nope")).toBeNull();
    const otpless = loadMeshGhosts().find((g) => !g.hasOtp);
    if (otpless) expect(revealGhostOtp(otpless.id)).toBeNull();
  });
});
