#!/usr/bin/env node
/**
 * defcon.run 34 landing page compiler.
 *
 * Reads content.json (every user-facing string + config) and template.html,
 * then writes a single self-contained index.html ready to upload to S3.
 *
 *   node build.mjs
 *
 * Only external requests in the output are the Google Fonts stylesheet and any
 * card images you point at (content.json `cards[].image`). Everything else —
 * CSS, JS, the matrix backdrop — is inlined.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const content = JSON.parse(readFileSync(join(here, "content.json"), "utf8"));
let html = readFileSync(join(here, "template.html"), "utf8");

// --- escapers ---
const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const escAttr = (s) => esc(s).replaceAll('"', "&quot;");

// --- wordmark: highlight from the first dot, e.g. defcon.run -> defcon<b>.run</b> ---
function wordmarkHtml(word) {
  const i = String(word).indexOf(".");
  if (i === -1) return esc(word);
  return esc(word.slice(0, i)) + "<b>" + esc(word.slice(i)) + "</b>";
}

// --- cards ---
const cardsHtml = content.cards
  .map((c, i) => {
    const delay = (0.52 + i * 0.1).toFixed(2);
    return `<a class="card reveal" href="${escAttr(c.url)}" target="_blank" rel="noopener noreferrer" style="animation-delay: ${delay}s">
        <div class="card-media">
          <img src="${escAttr(c.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.classList.add('img-fail')" />
          <span class="card-emoji">${esc(c.emoji)}</span>
        </div>
        <div class="card-body">
          <span class="card-kicker">${esc(c.kicker)}</span>
          <span class="card-title">${esc(c.title)}</span>
          <span class="card-blurb">${esc(c.blurb)}</span>
          <span class="card-cta">${esc(c.cta)} <span class="arrow">&rarr;</span></span>
        </div>
      </a>`;
  })
  .join("\n      ");

// --- footer links ---
const footerLinks = (content.footer.links || [])
  .map((l) => `<a href="${escAttr(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`)
  .join(" · ");

// --- placeholder map ---
const map = {
  THEME_DEFAULT: content.theme?.default === "light" ? "light" : "dark",
  META_TITLE: esc(content.meta.title),
  META_DESC: escAttr(content.meta.description),
  META_THEME_COLOR: escAttr(content.meta.themeColor || "#00d4aa"),
  META_URL: escAttr(content.meta.url || "https://defcon.run/"),
  META_SITE_NAME: escAttr(content.meta.siteName || "defcon.run"),
  META_IMAGE: escAttr(content.meta.image || ""),
  META_IMAGE_ALT: escAttr(content.meta.imageAlt || content.meta.title),
  BRAND_WORDMARK_HTML: wordmarkHtml(content.brand.wordmark),
  BRAND_VERSION: esc(content.brand.version),
  HYPE_BADGE: esc(content.hype.badge),
  HYPE_KICKER: esc(content.hype.kicker),
  HYPE_HEADLINE: esc(content.hype.headline),
  HYPE_SUBHEAD: esc(content.hype.subhead),
  HYPE_EVENTLINE: esc(content.hype.eventLine),
  CD_LABEL: esc(content.countdown.label),
  CD_SUBLABEL: esc(content.countdown.sublabel),
  CD_U_DAYS: esc(content.countdown.units.days),
  CD_U_HOURS: esc(content.countdown.units.hours),
  CD_U_MINUTES: esc(content.countdown.units.minutes),
  CD_U_SECONDS: esc(content.countdown.units.seconds),
  CARDS: cardsHtml,
  FOOTER_TEXT: esc(content.footer.text),
  FOOTER_NOTE: esc(content.footer.note),
  FOOTER_LINKS: footerLinks,
  // JS-context values — JSON.stringify makes them safe quoted literals
  CD_TARGET_JSON: JSON.stringify(content.countdown.targetISO),
  CD_DONE_JSON: JSON.stringify(content.countdown.done),
};

for (const [key, value] of Object.entries(map)) {
  html = html.replaceAll(`{{${key}}}`, value);
}

// --- leftover-placeholder guard ---
const leftover = html.match(/\{\{[A-Z0-9_]+\}\}/g);
if (leftover) {
  console.error("✖ Unreplaced placeholders:", [...new Set(leftover)].join(", "));
  process.exit(1);
}

const outFile = join(here, "index.html");
writeFileSync(outFile, html, "utf8");

const kb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(1);
console.log(`✓ Built ${outFile} (${kb} KB) — ${content.cards.length} cards, countdown → ${content.countdown.targetISO}`);
