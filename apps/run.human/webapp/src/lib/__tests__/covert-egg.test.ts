import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  buildCovertUrl,
  buildCovertUrlFromV,
  shouldCelebrate,
  readAward,
  stashPending,
  readPending,
  clearPending,
  fireEgg,
  fireCovert,
  claimStashed,
  PENDING_KEY,
} from "../covert-egg";
import { encodeFlag } from "../ctf-covert-codec";
import { AWARD_PROP } from "../ctf-covert-css";
import { handleCovert, type CovertDeps } from "../../app/(ctf)/assets/theme/route";
import type { JudgeResult } from "../ctf-judge";

/**
 * covert-egg runs in the vitest DEFAULT node env — there is NO jsdom/happy-dom
 * installed, so document / getComputedStyle / localStorage are stubbed via
 * vi.stubGlobal. The fake <link> captures its load/error listeners so a test can
 * drive the covert loop deterministically, and exposes a `sheet` spy so we can
 * PROVE the win is never derived from the injected sheet's CSSOM rules.
 */

interface FakeLink {
  rel: string;
  href: string;
  remove: () => void;
  _fire: (type: string) => void;
  _sheetReads: number;
}

function makeFakeDom() {
  const links: FakeLink[] = [];
  const doc = {
    documentElement: {},
    head: { appendChild: (_el: unknown) => {} },
    createElement: (_tag: string) => {
      const listeners: Record<string, Array<() => void>> = {};
      const el: FakeLink = {
        rel: "",
        href: "",
        remove: vi.fn(),
        _fire: (type: string) => (listeners[type] || []).forEach((fn) => fn()),
        _sheetReads: 0,
      };
      // A CSSOM-rule read would touch .sheet — this spy proves we never do.
      Object.defineProperty(el, "sheet", {
        get() {
          el._sheetReads++;
          return null;
        },
      });
      (el as unknown as {
        addEventListener: (t: string, fn: () => void) => void;
      }).addEventListener = (t: string, fn: () => void) => {
        (listeners[t] = listeners[t] || []).push(fn);
      };
      links.push(el);
      return el;
    },
  };
  return { doc, links };
}

function fakeLocalStorage() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
  };
}

/** Install a full DOM stub; marker is what getComputedStyle reports for AWARD_PROP. */
function installDom(marker: string) {
  const { doc, links } = makeFakeDom();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => marker }));
  vi.stubGlobal("localStorage", fakeLocalStorage());
  return { doc, links };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildCovertUrl / buildCovertUrlFromV", () => {
  it("targets the 46-02 /assets/theme path with a pure-decimal ?v=", () => {
    const url = buildCovertUrl("dc34-egg", "1337");
    expect(url).toMatch(/\/assets\/theme\?v=[0-9]+$/);
    const v = url.split("v=")[1];
    expect(v).toBe(encodeFlag("dc34-egg", "1337"));
    expect(buildCovertUrlFromV(v)).toBe(url);
  });
});

describe("shouldCelebrate", () => {
  it("is true only for a non-empty numeric marker > 0", () => {
    expect(shouldCelebrate("10")).toBe(true);
    expect(shouldCelebrate(" 42 ")).toBe(true);
    expect(shouldCelebrate("0.5")).toBe(true);
  });
  it("is false for empty, whitespace, zero, or non-numeric", () => {
    expect(shouldCelebrate("")).toBe(false);
    expect(shouldCelebrate("   ")).toBe(false);
    expect(shouldCelebrate("0")).toBe(false);
    expect(shouldCelebrate("000")).toBe(false);
    expect(shouldCelebrate("abc")).toBe(false);
    expect(shouldCelebrate("--accent-ramp")).toBe(false);
  });
});

describe("readAward", () => {
  it("reads AWARD_PROP off getComputedStyle(document.documentElement)", () => {
    installDom("7");
    expect(readAward().trim()).toBe("7");
  });
});

describe("localStorage stash helpers", () => {
  it("stashes deduped and clears by value under PENDING_KEY", () => {
    installDom("");
    expect(readPending()).toEqual([]);
    stashPending("111");
    stashPending("111"); // dedupe
    stashPending("222");
    expect(readPending()).toEqual(["111", "222"]);
    expect(PENDING_KEY).toBe("dc34:covert:pending");
    clearPending("111");
    expect(readPending()).toEqual(["222"]);
  });

  it("is a silent no-op when localStorage is absent", () => {
    // no localStorage stub installed
    expect(() => stashPending("111")).not.toThrow();
    expect(readPending()).toEqual([]);
    expect(() => clearPending("111")).not.toThrow();
  });
});

describe("fireEgg — the signed-in loop (SC5)", () => {
  it("injects the link, reads the computed-style marker, and celebrates on a win", () => {
    const { links } = installDom("10"); // winning marker
    let result: boolean | undefined;
    fireEgg("dc34-egg", "1337", (win) => {
      result = win;
    });
    expect(links.length).toBe(1);
    expect(links[0].rel).toBe("stylesheet");
    expect(links[0].href).toMatch(/\/assets\/theme\?v=[0-9]+$/);
    // resolve on the stylesheet's load event → computed-style read → onResult(true)
    links[0]._fire("load");
    expect(result).toBe(true);
    // link cleaned up; win NEVER derived from the sheet's CSSOM rules
    expect(links[0].remove).toHaveBeenCalled();
    expect(links[0]._sheetReads).toBe(0);
  });

  it("does NOT celebrate when the marker is absent/zero", () => {
    const { links } = installDom(""); // no marker
    let result: boolean | undefined;
    fireEgg("dc34-egg", "1337", (win) => {
      result = win;
    });
    links[0]._fire("load");
    expect(result).toBe(false);
  });

  it("stashes the encoded v on fire and clears it on a same-fire win", () => {
    const { links } = installDom("10");
    fireEgg("dc34-egg", "1337", () => {});
    // stashed BEFORE the read (client cannot know auth state)
    expect(readPending()).toEqual([encodeFlag("dc34-egg", "1337")]);
    links[0]._fire("load"); // win → clears its own entry
    expect(readPending()).toEqual([]);
  });

  it("never calls fetch — the covert response body is never parsed", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { links } = installDom("10");
    fireEgg("dc34-egg", "1337", () => {});
    links[0]._fire("load");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("claimStashed — park-and-claim (SC2), credited exactly once", () => {
  it("re-fires a parked flag on the next signed-in load and celebrates once, second claim is a no-op", () => {
    // 1) UNAUTH fire: decoy (empty marker) → v stays parked
    const dom1 = installDom("");
    fireEgg("dc34-egg", "1337", () => {});
    dom1.links[0]._fire("load");
    const parked = readPending();
    expect(parked.length).toBe(1);

    // Carry the parked localStorage over to the "next load" (new DOM, winning marker)
    const carried = localStorage.getItem(PENDING_KEY)!;
    const dom2 = installDom("10");
    localStorage.setItem(PENDING_KEY, carried);

    let wins = 0;
    claimStashed(() => {
      wins++;
    });
    expect(dom2.links.length).toBe(1); // re-fired through the covert endpoint
    dom2.links[0]._fire("load");
    expect(wins).toBe(1);
    expect(readPending()).toEqual([]); // credited → cleared

    // 2) second claim finds nothing → no re-fire, no extra celebration (idempotent)
    const dom3 = installDom("10");
    // pending is empty from the shared closure; keep it empty
    let wins2 = 0;
    claimStashed(() => {
      wins2++;
    });
    expect(dom3.links.length).toBe(0);
    expect(wins2).toBe(0);
  });
});

describe("fireCovert — invisibility guard", () => {
  it("derives the win solely from getComputedStyle, never the sheet CSSOM", () => {
    const { links } = installDom("5");
    let win: boolean | undefined;
    fireCovert("123", (w) => {
      win = w;
    });
    links[0]._fire("load");
    expect(win).toBe(true);
    expect(links[0]._sheetReads).toBe(0);
  });
});

/**
 * COVERT REWARD-FREE INVARIANT (Slice 1a, CTFT-05 / SC-5 / T-53-04-01+03).
 *
 * 53-04 wires the reward `effect` onto `JudgeResult` for the NON-covert claim
 * response. This block LOCKS the other half of the invariant: the covert CSS
 * channel must NEVER carry a reward payload. It injects a fake judge into the
 * real `handleCovert` and proves the covert win sheet is BYTE-IDENTICAL whether
 * or not the (credited) result carries an `effect`, and that no reward substring
 * reaches the response. A source-grep gate keeps the covert files from ever
 * learning about rewards. No DynamoDB / auth (all deps injected).
 */
describe("covert channel stays reward-free (SC-5 / T-53-04-01)", () => {
  const OTP_ENROLL = {
    kind: "otp-enroll" as const,
    otpauth:
      "otpauth://totp/Defcon.run:goldstein-dawn?secret=JBSWY3DPEHPK3PXP&issuer=Defcon.run&period=120",
    nextFlag: "goldstein-dawn",
  };

  // Same CREDITED (points > 0) solve, one carrying the reward effect, one not.
  const CREDITED: JudgeResult = {
    solved: true,
    points: 7,
    ordinal: 1,
    firstBlood: true,
    capped: false,
  };
  const CREDITED_WITH_EFFECT: JudgeResult = { ...CREDITED, effect: OTP_ENROLL };

  function themeReq(v: string): Request {
    return new Request(
      `https://run.defcon.run/use1/assets/theme?v=${encodeURIComponent(v)}`,
    );
  }

  // Signed-in session + a fake judge that returns a fixed result, so the ONLY
  // variable across the two runs is whether the result carries an `effect`.
  function deps(result: JudgeResult): CovertDeps {
    return {
      getSession: async () => ({ user: { id: "u1" } }),
      judge: (async () => result) as CovertDeps["judge"],
    };
  }

  it("(a/b) the covert win sheet is byte-identical WITH vs WITHOUT an effect on the result", async () => {
    const v = encodeFlag("dc34-egg", "1337");
    const withEffect = await handleCovert(themeReq(v), deps(CREDITED_WITH_EFFECT));
    const withoutEffect = await handleCovert(themeReq(v), deps(CREDITED));

    const bodyWith = await withEffect.text();
    const bodyWithout = await withoutEffect.text();

    // (a) same 200 text/css no-store envelope.
    expect(withEffect.status).toBe(200);
    expect(withEffect.headers.get("content-type")?.startsWith("text/css")).toBe(true);
    expect(withEffect.headers.get("cache-control")).toBe("no-store");

    // It IS the win sheet (not two decoys) — carries the award property...
    expect(bodyWith).toContain(AWARD_PROP);
    // (b) ...and is byte-for-byte identical whether or not an effect was present:
    // the effect never reaches the covert body.
    expect(bodyWith).toBe(bodyWithout);
  });

  it("(c) no reward payload substring ever appears in the covert response body", async () => {
    const v = encodeFlag("dc34-egg", "1337");
    const res = await handleCovert(themeReq(v), deps(CREDITED_WITH_EFFECT));
    const body = await res.text();
    expect(body).not.toContain("otpauth");
    expect(body).not.toContain("otp-enroll");
    expect(body).not.toContain("goldstein-dawn");
    expect(body).not.toContain("JBSWY3DPEHPK3PXP");
    expect(body).not.toContain(OTP_ENROLL.otpauth);
  });

  it("source-grep: the covert files never reference the reward vocabulary", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const covertSources = [
      "../../app/(ctf)/assets/theme/route.ts",
      "../covert-egg.ts",
      "../ctf-covert-css.ts",
    ];
    for (const rel of covertSources) {
      const src = readFileSync(resolve(here, rel), "utf8");
      expect(src).not.toMatch(/otpauth/i);
      expect(src).not.toMatch(/otp-enroll/i);
      expect(src).not.toMatch(/\beffect\b/i);
    }
  });
});
