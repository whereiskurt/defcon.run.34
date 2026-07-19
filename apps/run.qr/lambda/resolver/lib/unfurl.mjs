/**
 * Social-preview (Open Graph) "unfurl" support for opted-in short codes.
 *
 * Most `q.defcon.run/<CODE>` scans are a plain 302 — a QR is scanned by a phone
 * that wants to GO somewhere, not previewed. But a few codes are meant to be
 * SHARED (a CTF flag-award link, `q.defcon.run/c?v=<CODE>`), and when such a link
 * is pasted into Slack / Discord / iMessage / Twitter the crawler wants an
 * Open-Graph card to render. This module renders that card.
 *
 * Design contract (see docs/superpowers/specs/2026-07-18-ctf-share-unfurl-cherries):
 *
 *   - OPT-IN per code. A `Qr` item carries `unfurl: "<theme>"`; only a code whose
 *     theme resolves here ever gets a card. Everything else is the untouched 302.
 *   - CRAWLERS ONLY. The card is HTML; the resolver serves it only to a recognized
 *     link-preview bot (`isCrawler`). A real human still gets the instant 302, so
 *     they never see this page and the shared secret (`v=<CODE>`) can never leak
 *     through a preview fetch — the card's forward URL is the destination BASE,
 *     with the query STRIPPED.
 *   - SECRET-SAFE. Nothing here echoes the code: the `og:image` is a static PNG,
 *     the copy is generic ("you hit a flag"), and every interpolated URL is
 *     HTML-escaped (the destination is operator-controlled DynamoDB data).
 *   - NEVER THROWS. `loadThemeImageBase64` degrades to `null` on any fs error so
 *     the resolver falls back to a 404 rather than a 5xx. Pure functions here
 *     take only plain data.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Absolute origin the resolver is served under. Used to build the absolute
 * `og:image` URL (crawlers require an absolute image src) and the canonical
 * `og:url`. Stable — `q.defcon.run` is the resolver apex.
 */
export const RESOLVER_ORIGIN = "https://q.defcon.run";

/**
 * Theme registry. Each theme is a static preview identity: the card copy plus
 * the bundled PNG filename served at `/_og/<image>`. Add a theme here and set a
 * `Qr` item's `unfurl` to its key to light it up — no resolver logic changes.
 *
 * Copy is deliberately code-free and celebratory (the code is a secret).
 */
export const THEMES = {
  cherries: {
    name: "cherries",
    image: "cherries-og.png",
    title: "🍒🍒🍒 JACKPOT — you lined up a DEF CON run flag!",
    description:
      "Three cherries, all the way. Tap in to claim your DEF CON 34 run CTF flag before the reels reset.",
  },
};

/**
 * Resolve a theme name (from `item.unfurl`) to its registry entry, or `null` if
 * unknown/blank. Case-insensitive and defensive against non-strings.
 *
 * @param {unknown} name
 * @returns {{name:string,image:string,title:string,description:string}|null}
 */
export function resolveTheme(name) {
  if (typeof name !== "string" || name.length === 0) return null;
  return THEMES[name.toLowerCase()] || null;
}

/**
 * Recognized link-preview / social crawler User-Agents. Kept broad on purpose:
 * a false negative just means "no card" (graceful), while a false positive only
 * matters if a real human's UA matches — and even then they get the same
 * meta-refresh forward, minus the secret query. Matched case-insensitively.
 */
const CRAWLER_RE =
  /(facebookexternalhit|facebookcatalog|Facebot|Twitterbot|Slackbot|Slack-ImgProxy|Discordbot|WhatsApp|TelegramBot|LinkedInBot|Pinterest|redditbot|Applebot|SkypeUriPreview|vkShare|Embedly|Iframely|opengraph|MetaInspector|Mastodon|Bluesky|Signal|Googlebot|Google-PageRenderer|bingbot|DuckDuckBot|Qwantify|Yeti|nuzzel|Snapchat)/i;

/**
 * Is this User-Agent a link-preview crawler that should get the OG card instead
 * of the 302?
 *
 * @param {unknown} ua
 * @returns {boolean}
 */
export function isCrawler(ua) {
  return typeof ua === "string" && CRAWLER_RE.test(ua);
}

/**
 * HTML-attribute escape. The interpolated URLs derive from operator-controlled
 * destination data, so escape defensively for the attribute + text contexts.
 *
 * @param {string} s
 * @returns {string}
 */
function escAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * JS string-literal escape for embedding a URL inside an inline `<script>`.
 * `JSON.stringify` handles quotes/backslashes; the extra `<`-escape prevents a
 * `</script>` breakout if a destination ever contained one.
 *
 * @param {string} s
 * @returns {string} a quoted, script-safe JS string literal
 */
function jsString(s) {
  return JSON.stringify(String(s)).replace(/</g, "\\u003c");
}

/**
 * Render the crawler-facing HTML card for a theme.
 *
 * The page is built for two audiences:
 *   - a CRAWLER reads the `<meta>` og / twitter:card tags and the static image;
 *   - the rare non-JS human is forwarded by `<meta http-equiv="refresh">`, and a
 *     JS human by `location.replace` — both to `forwardUrl` (the code-free base).
 *
 * @param {{
 *   theme: {name:string,image:string,title:string,description:string},
 *   forwardUrl: string,
 *   origin?: string,
 * }} args
 * @returns {string} a complete HTML document
 */
export function renderUnfurlHtml({ theme, forwardUrl, origin = RESOLVER_ORIGIN }) {
  // The public og:image path keys on the THEME NAME (`/_og/<name>.png`), which is
  // what parse-path/resolveTheme route on — the bundled filename (`theme.image`)
  // is an internal detail the resolver maps to. Using the filename here would
  // 404 the crawler's image fetch.
  const imageUrl = `${origin}/_og/${theme.name}.png`;
  const canonicalUrl = `${origin}/c`;
  const title = theme.title;
  const description = theme.description;

  const fwd = escAttr(forwardUrl);
  const img = escAttr(imageUrl);
  const canon = escAttr(canonicalUrl);
  const t = escAttr(title);
  const d = escAttr(description);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="DEF CON run">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${img}">
<meta property="og:image:secure_url" content="${img}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${t}">
<meta property="og:url" content="${canon}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">
<meta name="theme-color" content="#0a0014">
<meta http-equiv="refresh" content="0;url=${fwd}">
<style>
  :root { color-scheme: dark; }
  html,body { margin:0; height:100%; background:#0a0014; }
  body {
    display:flex; align-items:center; justify-content:center;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color:#ffe3fb;
    background:
      radial-gradient(ellipse at 50% -10%, rgba(255,0,153,.35), transparent 60%),
      radial-gradient(ellipse at 50% 120%, rgba(0,229,255,.25), transparent 55%),
      #0a0014;
  }
  main { text-align:center; padding:6vw 5vw; }
  img {
    width:min(88vw,760px); height:auto; border-radius:18px;
    box-shadow:0 0 2px #ff2d95, 0 0 40px rgba(255,45,149,.55), 0 0 90px rgba(0,229,255,.35);
  }
  a {
    display:inline-block; margin-top:26px; padding:14px 30px; border-radius:999px;
    font-weight:800; letter-spacing:.06em; text-transform:uppercase; text-decoration:none;
    color:#0a0014; background:linear-gradient(90deg,#ff2d95,#ffd400);
    box-shadow:0 0 24px rgba(255,45,149,.7);
  }
</style>
</head>
<body>
  <main>
    <img src="${img}" alt="${t}">
    <div><a href="${fwd}">Claim your flag &rarr;</a></div>
  </main>
  <script>location.replace(${jsString(forwardUrl)});</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Bundled OG image loading (cold-start cached, defensive)
// ---------------------------------------------------------------------------

/** `<resolver>/assets` — this file is `<resolver>/lib/unfurl.mjs`. */
const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

/** @type {Map<string, string|null>} filename → base64 (or null miss), cached. */
const _imgCache = new Map();

/**
 * Load a theme's bundled PNG as base64, cached across warm invocations. Returns
 * `null` on any read failure (missing asset, permissions) so the caller degrades
 * to a 404 instead of throwing. `theme.image` is a fixed registry value — never
 * user input — so there is no path-traversal surface.
 *
 * @param {{image:string}|null} theme
 * @returns {string|null} base64-encoded PNG, or null
 */
export function loadThemeImageBase64(theme) {
  if (!theme || typeof theme.image !== "string") return null;
  if (_imgCache.has(theme.image)) return _imgCache.get(theme.image);
  let b64 = null;
  try {
    b64 = readFileSync(join(ASSETS_DIR, theme.image)).toString("base64");
  } catch {
    b64 = null;
  }
  _imgCache.set(theme.image, b64);
  return b64;
}
