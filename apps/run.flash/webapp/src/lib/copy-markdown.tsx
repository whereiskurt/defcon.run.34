/**
 * copy-markdown — the safe inline renderer for run.bib copy values (Phase 36-02).
 *
 * Copy strings are EDITOR-controlled (Strapi ui-string rows, or a compromised
 * CMS). Rendering them must be safe by construction: this is the phase's primary
 * XSS surface (T-36-05 / T-36-06). Two rules make it safe:
 *
 *   1. ESCAPE FIRST. `renderCopy` returns React element/text NODES, never an
 *      HTML string, and NEVER uses React's raw-HTML injection prop. Every
 *      non-token run of the input becomes a React text child, which React escapes on
 *      render — so an injected `<script>` or `<img onerror=...>` is emitted as
 *      inert `&lt;script&gt;` text, not a live element. There is no code path
 *      that turns raw copy into markup.
 *   2. WHITELIST SECOND. Only four lightweight constructs are re-introduced as
 *      real elements — `**bold**`, `*italic*`, a `\n` line-break, and a
 *      `[label](url)` link. Anything else stays escaped text.
 *
 * Links additionally gate the URL scheme to an http/https/mailto allowlist
 * (T-36-06); a `javascript:`/`data:` (or any other) scheme drops the href and
 * the label renders as plain text — no navigable dangerous URL survives. Every
 * surviving anchor carries rel="noopener noreferrer" + target="_blank".
 *
 * No markdown/sanitizer dependency (D-05): the escape-first step is what makes
 * it safe, the tiny whitelist is what makes it useful. Being a pure
 * `string -> React.ReactNode` function, server render and Plan 03's client
 * `useCopy` call the EXACT same escape-then-whitelist path.
 */

import { type ReactNode } from "react";

/** URL schemes a copy link is allowed to navigate to. Everything else is dropped. */
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * True only when `url` carries an explicit, safe scheme (http/https/mailto).
 * A schemeless/relative URL, or any other scheme (javascript:, data:, vbscript:…),
 * is treated as unsafe so it can never become a navigable href.
 */
function isSafeUrl(url: string): boolean {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url.trim());
  if (!m) return false;
  return SAFE_SCHEMES.has(m[1].toLowerCase() + ":");
}

/**
 * One combined, ORDERED pass over the raw string. Order matters: `**bold**` is
 * tried before `*italic*` (so a bold run is not mis-read as two italics), and
 * links are matched as a unit. `[\s\S]` is used (not `.`) so bold/italic runs
 * may legitimately span nothing exotic while newline handling stays explicit.
 */
const TOKEN = new RegExp(
  [
    "\\*\\*([\\s\\S]+?)\\*\\*", // 1: bold
    "\\*([\\s\\S]+?)\\*", //       2: italic
    "\\[([^\\]]+)\\]\\(([^)\\s]+)\\)", // 3: link label, 4: link url
    "(\\n)", //                   5: line-break
  ].join("|"),
  "g"
);

/**
 * Render an editor-controlled copy string as safe React nodes: escape-first
 * (every text run is a React text child), whitelist-second (only bold, italic,
 * links, and line-breaks become real elements). Returns an array of nodes so it
 * drops straight into JSX (`<span>{renderCopy(value)}</span>`).
 */
export function renderCopy(value: string): ReactNode {
  if (!value) return [];

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(value)) !== null) {
    const [full, bold, italic, linkLabel, linkUrl, br] = match;

    // Text between the previous token and this one → escaped React text child.
    if (match.index > lastIndex) {
      nodes.push(value.slice(lastIndex, match.index));
    }

    if (bold !== undefined) {
      nodes.push(<strong key={key++}>{bold}</strong>);
    } else if (italic !== undefined) {
      nodes.push(<em key={key++}>{italic}</em>);
    } else if (linkLabel !== undefined) {
      if (isSafeUrl(linkUrl)) {
        nodes.push(
          <a
            key={key++}
            href={linkUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {linkLabel}
          </a>
        );
      } else {
        // Unsafe scheme: drop the href entirely, keep the label as inert text.
        nodes.push(linkLabel);
      }
    } else if (br !== undefined) {
      nodes.push(<br key={key++} />);
    }

    lastIndex = match.index + full.length;
  }

  // Trailing text after the last token.
  if (lastIndex < value.length) {
    nodes.push(value.slice(lastIndex));
  }

  return nodes;
}
