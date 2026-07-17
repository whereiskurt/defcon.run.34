import { describe, it, expect } from "vitest";
import { blocksToHtml } from "./strapi";

/**
 * Locks the §12 security invariant: `descriptionHtml` (the ONLY CMS field the
 * public-maps manifest injects raw via `{@html}` in the studio) is server-side
 * sanitized here by `blocksToHtml`. CMS rich-text is authored by trusted admins,
 * but a stray/hostile value must never yield executable markup, and every anchor
 * must carry rel="noopener noreferrer" (reverse-tabnabbing).
 *
 * Strapi v5 "blocks" are structured JSON — the renderer whitelists a small set of
 * tags and escapes every text node + href, so injection is impossible by
 * construction. These tests pin that behaviour so a future refactor can't
 * silently reintroduce an XSS sink into the official-overlay label path.
 */
describe("blocksToHtml (CMS descriptionHtml sanitizer)", () => {
  it("returns undefined for empty / non-array input", () => {
    expect(blocksToHtml(undefined)).toBeUndefined();
    expect(blocksToHtml(null)).toBeUndefined();
    expect(blocksToHtml([])).toBeUndefined();
    expect(blocksToHtml("not blocks")).toBeUndefined();
  });

  it("renders a paragraph and escapes hostile text nodes (no raw markup)", () => {
    const html = blocksToHtml([
      {
        type: "paragraph",
        children: [{ text: '<script>alert(1)</script> & "friends"' }],
      },
    ]);
    expect(html).toBeDefined();
    // The angle brackets / ampersand / quotes are entity-escaped, so no live tag.
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(html).toMatch(/^<p>/);
  });

  it("emits links with rel=noopener noreferrer and an escaped href", () => {
    const html = blocksToHtml([
      {
        type: "paragraph",
        children: [
          {
            type: "link",
            url: 'https://example.com/"><script>x</script>',
            children: [{ text: "click" }],
          },
        ],
      },
    ]);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    // The href is escaped — the injected script cannot break out of the attribute.
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("does not allow arbitrary tags — only the whitelist is emitted", () => {
    // An unknown block type falls through to the paragraph branch; its children
    // are still escaped, never passed through as raw HTML.
    const html = blocksToHtml([
      {
        type: "image",
        children: [{ text: '<img src=x onerror=alert(1)>' }],
      },
    ]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("renders headings, lists, quotes and code with escaped content", () => {
    const html = blocksToHtml([
      { type: "heading", level: 2, children: [{ text: "Title <b>" }] },
      {
        type: "list",
        format: "unordered",
        children: [{ children: [{ text: "item <x>" }] }],
      },
      { type: "code", children: [{ text: "const a = 1 < 2;" }] },
    ]);
    expect(html).toContain("<h2>");
    expect(html).toContain("<ul><li>");
    expect(html).toContain("<pre><code>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&lt;x&gt;");
    expect(html).toContain("1 &lt; 2");
  });
});
