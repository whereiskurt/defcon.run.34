/**
 * copy-mono — render an editor-controlled copy string whose `{token}` placeholders
 * surface as inline monospace-emphasized hardware terms.
 *
 * run.flash-SPECIFIC — NOT part of the verbatim run.bib copy toolkit (copy.ts /
 * copy-core.ts / copy-markdown.tsx / CopyProvider.tsx). Edit freely; there is no
 * cross-app byte-sync contract on this file.
 *
 * The flash troubleshooting + chip-mismatch copy embeds hardware identifiers —
 * button labels (BOOT / RESET), the literal words "this"/"not", chip names, USB
 * VID:PID pairs, device names — that the #722 readability pass renders in
 * `font-mono text-foreground` so they read as on-device labels, not prose. To keep
 * that styling while sourcing the sentence from the CMS, the copy string leaves
 * those terms as `{token}` placeholders (e.g. "hold {boot}, tap {reset}") and this
 * helper re-wraps each mapped token in a mono span. Static button labels and
 * dynamic hardware values (chipName, vidPid, deviceName) flow through the same
 * path — the caller just supplies the value map.
 *
 * SAFETY (mirrors copy-markdown): returns React NODES, never an HTML string, and
 * never uses raw-HTML injection. Every prose run between tokens is a React text
 * child that React escapes on render, so injected markup in an edited copy row is
 * emitted as inert text. The only elements introduced are inert <span>s.
 *
 * Pass the RAW copy value (from `t(key)` WITHOUT vars, so the `{token}` markers
 * survive) — renderMono does the placeholder substitution itself.
 */

import { type ReactNode } from "react";

/** Matches a `{token}` placeholder; the capture group is the token name. */
const TOKEN = /\{(\w+)\}/g;

/**
 * Split `value` on `{token}` placeholders, rendering each token whose name is in
 * `vars` as a `font-mono text-foreground` span and everything else as escaped
 * text. A token absent from `vars` is left visible (`{name}`) rather than dropped,
 * matching the copy-core fallback contract (a missing var surfaces, never blanks).
 */
export function renderMono(
  value: string,
  vars: Record<string, string>
): ReactNode {
  if (!value) return [];

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(value)) !== null) {
    const [full, name] = match;

    // Text between the previous token and this one → escaped React text child.
    if (match.index > lastIndex) {
      nodes.push(value.slice(lastIndex, match.index));
    }

    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      nodes.push(
        <span key={key++} className="font-mono text-foreground">
          {vars[name]}
        </span>
      );
    } else {
      // Unknown token: leave it visible rather than silently dropping it.
      nodes.push(full);
    }

    lastIndex = match.index + full.length;
  }

  // Trailing text after the last token.
  if (lastIndex < value.length) {
    nodes.push(value.slice(lastIndex));
  }

  return nodes;
}
