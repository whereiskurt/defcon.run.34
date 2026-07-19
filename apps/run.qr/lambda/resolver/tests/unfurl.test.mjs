/**
 * Tests for lib/unfurl.mjs — the opt-in Open-Graph "unfurl" card support.
 *
 * Coverage:
 *   - isCrawler: recognizes common link-preview bots, rejects real browsers/curl;
 *   - resolveTheme: known theme resolves, unknown/blank/non-string → null;
 *   - renderUnfurlHtml: emits og / twitter:card tags + the static image URL,
 *     forwards to the given URL, NEVER leaks the shared code, and HTML-escapes
 *     an operator-controlled destination (no attribute or </script> breakout);
 *   - loadThemeImageBase64: returns base64 for the bundled cherries PNG (present
 *     in assets/) and null for a bogus image (never throws).
 */

import { describe, it, expect } from "vitest";
import {
  isCrawler,
  resolveTheme,
  renderUnfurlHtml,
  loadThemeImageBase64,
  THEMES,
} from "../lib/unfurl.mjs";

describe("isCrawler", () => {
  const bots = [
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Discordbot/2.0 (+https://discordapp.com)",
    "WhatsApp/2.23",
    "TelegramBot (like TwitterBot)",
    "LinkedInBot/1.0 (compatible; Mozilla/5.0)",
    "Mozilla/5.0 (compatible; redditbot/1.0)",
  ];
  for (const ua of bots) {
    it(`recognizes ${ua.slice(0, 24)}…`, () => {
      expect(isCrawler(ua)).toBe(true);
    });
  }

  const humans = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36",
    "curl/8.4.0",
    "",
  ];
  for (const ua of humans) {
    it(`rejects a non-crawler UA (${ua.slice(0, 18) || "empty"})`, () => {
      expect(isCrawler(ua)).toBe(false);
    });
  }

  it("is safe on non-string input", () => {
    expect(isCrawler(undefined)).toBe(false);
    expect(isCrawler(null)).toBe(false);
    expect(isCrawler(123)).toBe(false);
  });
});

describe("resolveTheme", () => {
  it("resolves the cherries theme (case-insensitive)", () => {
    expect(resolveTheme("cherries")).toBe(THEMES.cherries);
    expect(resolveTheme("CHERRIES")).toBe(THEMES.cherries);
  });

  it("returns null for unknown/blank/non-string", () => {
    expect(resolveTheme("nope")).toBeNull();
    expect(resolveTheme("")).toBeNull();
    expect(resolveTheme(undefined)).toBeNull();
    expect(resolveTheme(null)).toBeNull();
    expect(resolveTheme(42)).toBeNull();
  });
});

describe("renderUnfurlHtml", () => {
  const theme = THEMES.cherries;

  it("emits og + twitter tags pointing at the static resolver-served image", () => {
    const html = renderUnfurlHtml({
      theme,
      forwardUrl: "https://run.defcon.run/use1/ctf/claim",
    });
    expect(html).toContain('property="og:image"');
    expect(html).toContain("https://q.defcon.run/_og/cherries.png");
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('property="og:title"');
    // Canonical og:url is the code-free share path.
    expect(html).toContain('property="og:url" content="https://q.defcon.run/c"');
  });

  it("forwards (meta-refresh + JS) to the given URL", () => {
    const fwd = "https://run.defcon.run/use1/ctf/claim";
    const html = renderUnfurlHtml({ theme, forwardUrl: fwd });
    expect(html).toContain(`0;url=${fwd}`);
    expect(html).toContain(`location.replace(${JSON.stringify(fwd)})`);
  });

  it("forwards to EXACTLY the given code-free URL and appends nothing", () => {
    // resolve() passes the pre-enrich base (no query); prove render doesn't
    // invent or append a query onto it — the forward target is verbatim.
    const fwd = "https://run.defcon.run/use1/ctf/claim";
    const html = renderUnfurlHtml({ theme, forwardUrl: fwd });
    expect(html).toContain(`content="0;url=${fwd}">`);
    expect(html).toContain(`location.replace(${JSON.stringify(fwd)});`);
    // A secret value handed to render would surface verbatim — it never gets one.
    expect(html).not.toContain("SECRET");
  });

  it("HTML-escapes an operator-controlled destination (no attribute breakout)", () => {
    const evil = 'https://x.test/"><script>alert(1)</script>';
    const html = renderUnfurlHtml({ theme, forwardUrl: evil });
    // The raw injection string must not appear intact anywhere.
    expect(html).not.toContain('"><script>alert(1)</script>');
    // Attribute context is escaped…
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
    // …and the inline <script> forward can't be broken out of.
    expect(html).not.toContain("</script>alert");
    expect(html).toContain("\\u003c");
  });
});

describe("loadThemeImageBase64", () => {
  it("returns base64 for the bundled cherries PNG", () => {
    const b64 = loadThemeImageBase64(THEMES.cherries);
    expect(typeof b64).toBe("string");
    expect(b64.length).toBeGreaterThan(100);
    // PNG magic bytes: \x89PNG → base64 prefix "iVBOR".
    expect(b64.startsWith("iVBOR")).toBe(true);
  });

  it("returns null (never throws) for a missing asset", () => {
    expect(loadThemeImageBase64({ image: "does-not-exist.png" })).toBeNull();
    expect(loadThemeImageBase64(null)).toBeNull();
    expect(loadThemeImageBase64({})).toBeNull();
  });
});
