import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * globals.css comment-terminator guard.
 *
 * ── The bug this exists to prevent (2026-08-01) ─────────────────────────────
 * A block comment in globals.css listed the HeroUI tokens the light theme
 * overrides as a slash-separated run ending in the word "content", a star, and
 * a slash. A CSS comment ends at the FIRST star-slash pair, so the comment
 * terminated in the middle of that word, the remaining prose became garbage at
 * the top level, and the parser silently swallowed the very next rule — the
 * `.drill-card` base, i.e. the entire LIGHT-mode card border.
 *
 * The build printed NO error. `npm run build` went green and shipped CSS that
 * was simply missing a rule; the only way to notice was to diff the emitted
 * stylesheet or look at the page in light mode. (An apostrophe later in the
 * same comment DID error, with a misleading "Unclosed string" pointing at a
 * line that was supposed to be inside a comment — that is the tell.)
 *
 * The same trap bites JS/TS block comments, which is why this very comment
 * describes the sequence in words instead of writing it.
 *
 * ── The check ───────────────────────────────────────────────────────────────
 * A well-formed stylesheet has exactly as many comment openers as closers. A
 * stray terminator inside a comment body makes closers outnumber openers,
 * which is precisely the failure above. Cheap, exact, no CSS parser needed.
 *
 * If this fails: find the comment whose prose contains a star-slash sequence
 * and reword it (e.g. "content1-4 and divider" rather than a slash-separated
 * list ending in a star).
 */

const here = dirname(fileURLToPath(import.meta.url)); // …/src/lib/__tests__
const CSS_PATH = resolve(here, "../../styles/globals.css");

/** Built at runtime so this file does not contain the literal sequences it
 *  counts — otherwise the test source could not describe its own subject. */
const OPEN = "/" + "*";
const CLOSE = "*" + "/";

const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

describe("globals.css comment terminators", () => {
  const css = readFileSync(CSS_PATH, "utf8");

  it("has exactly as many comment openers as closers", () => {
    expect(occurrences(css, CLOSE)).toBe(occurrences(css, OPEN));
  });

  it("still defines the drill-card base rule that the bug deleted", () => {
    // Guards the specific casualty: the LIGHT-mode card border. A rule swallowed
    // by an early comment terminator disappears from the build with no error.
    expect(css).toMatch(/^\.drill-card\s*\{/m);
    expect(css).toContain("border-left-width: 4px");
  });
});
