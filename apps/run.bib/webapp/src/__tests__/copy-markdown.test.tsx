import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { renderCopy } from "@/lib/copy-markdown";

/**
 * Phase 36-02 tests: the escape-first, whitelist inline markdown renderer.
 *
 * renderCopy is a pure `string -> React.ReactNode` function. We render its
 * output to a static string via react-dom/server (node env, no jsdom) and
 * pin two things:
 *   1. the whitelist actually works (bold / italic / link / line-break), and
 *   2. everything OUTSIDE the whitelist is inert — HTML metacharacters are
 *      escaped and dangerous URL schemes never produce a navigable href.
 *
 * This is the phase's primary XSS surface (T-36-05 / T-36-06), so the
 * injection payloads are first-class assertions, not an afterthought.
 */
const render = (value: string): string =>
  renderToStaticMarkup(<>{renderCopy(value)}</>);

describe("renderCopy — whitelist", () => {
  it("renders **bold** as <strong>", () => {
    const html = render("hello **there** world");
    expect(html).toContain("<strong>there</strong>");
  });

  it("renders *italic* as <em>", () => {
    const html = render("a *soft* word");
    expect(html).toContain("<em>soft</em>");
  });

  it("renders a newline as <br/>", () => {
    const html = render("line one\nline two");
    expect(html).toMatch(/<br\/?>/);
    expect(html).toContain("line one");
    expect(html).toContain("line two");
  });

  it("renders an https link with rel + target and the label text", () => {
    const html = render("see [the docs](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain(">the docs</a>");
  });

  it("allows a mailto link", () => {
    const html = render("[mail us](mailto:hi@example.com)");
    expect(html).toContain('href="mailto:hi@example.com"');
    expect(html).toContain(">mail us</a>");
  });
});

describe("renderCopy — escape-first (XSS inert)", () => {
  it("escapes a raw <script> payload to inert text — no live tag", () => {
    const html = render('<script>alert("xss")</script>');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("escapes an <img onerror=...> payload — no live element or handler tag", () => {
    const html = render('<img src=x onerror="alert(1)">');
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });

  it("escapes HTML metacharacters that appear inside whitelisted constructs", () => {
    const html = render("**<b>not real</b>**");
    // the bold wrapper is real (<strong>), but its inner < > are escaped text
    expect(html).toContain("<strong>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>not real</b>");
  });
});

describe("renderCopy — link scheme allowlist", () => {
  it("drops a javascript: URL and renders the label as plain text", () => {
    const html = render("[click me](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a");
    expect(html).toContain("click me");
  });

  it("drops a data: URL and renders the label as plain text", () => {
    const html = render("[x](data:text/html;base64,PHNjcmlwdD4=)");
    expect(html).not.toContain("data:text/html");
    expect(html).not.toContain("<a");
    expect(html).toContain("x");
  });
});
