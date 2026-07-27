import { describe, it, expect } from "vitest";
import { loadVanityRedirects } from "./vanity-redirects";
import redirects from "@/data/redirects.json";

describe("loadVanityRedirects", () => {
  const all = loadVanityRedirects();

  it("routes donate through the resolver so its target stays editable", () => {
    const donate = all.find((r) => r.host === "donate");
    expect(donate).toBeDefined();
    expect(donate!.fqdn).toBe("donate.defcon.run");
    // donate. used to hardcode the auto-signin URL here, which meant retargeting
    // it needed a terraform apply. It now goes through the resolver like r/h/b/f,
    // so the destination lives on the `donate` Qr row and is editable from
    // /admin/qr. The auto-signin requirement did NOT go away — it moved to that
    // row (see scripts/repoint-donate-qr.mts): the destination must stay
    // /use1/api/auth/auto-signin?callbackUrl=…whoami%3Fopen%3Ddonate, because
    // bare /whoami spins forever for logged-out visitors.
    expect(donate!.targetUrl).toBe("https://q.defcon.run/donate");
    expect(donate!.splash).toBe("hackers");
    expect(donate!.statusCode).toBe("HTTP_302");
  });

  it("defaults splash to hackers and honors countdown", () => {
    expect(all.find((r) => r.host === "sao")!.splash).toBe("countdown");
    expect(all.find((r) => r.host === "r")!.splash).toBe("hackers");
  });

  it("builds targetUrl without a trailing ? when query is empty", () => {
    // h. now routes through the resolver (q.defcon.run/h) so its destination is
    // dynamic/schedulable; the empty target_query must still yield no trailing "?".
    // (Lowercase code path — the resolver uppercases on lookup, so /h hits code h.)
    expect(all.find((r) => r.host === "h")!.targetUrl).toBe("https://q.defcon.run/h");
  });

  it("routes r., h. and b. through the resolver so they are schedulable", () => {
    expect(all.find((r) => r.host === "r")!.targetUrl).toBe("https://q.defcon.run/r");
    expect(all.find((r) => r.host === "h")!.targetUrl).toBe("https://q.defcon.run/h");
    // b. and f. are the bib / flash vanity domains — lowercase codes, each with
    // its own splash template.
    expect(all.find((r) => r.host === "b")!.targetUrl).toBe("https://q.defcon.run/b");
    expect(all.find((r) => r.host === "b")!.splash).toBe("bib");
    expect(all.find((r) => r.host === "b")!.statusCode).toBe("HTTP_302");
    expect(all.find((r) => r.host === "f")!.targetUrl).toBe("https://q.defcon.run/f");
    expect(all.find((r) => r.host === "f")!.splash).toBe("flash");
    expect(all.find((r) => r.host === "f")!.statusCode).toBe("HTTP_302");
    // p. and g. are the phreak / ghost vanity domains — resolver codes seeded
    // to the rickroll for now (retargetable from /admin/qr), each with its own
    // splash template.
    expect(all.find((r) => r.host === "p")!.targetUrl).toBe("https://q.defcon.run/p");
    expect(all.find((r) => r.host === "p")!.splash).toBe("phone");
    expect(all.find((r) => r.host === "p")!.statusCode).toBe("HTTP_302");
    expect(all.find((r) => r.host === "g")!.targetUrl).toBe("https://q.defcon.run/g");
    expect(all.find((r) => r.host === "g")!.splash).toBe("ghost");
    expect(all.find((r) => r.host === "g")!.statusCode).toBe("HTTP_302");
  });

  it("returns hosts sorted by priority", () => {
    const hosts = all.map((r) => r.host);
    expect(hosts).toEqual(["r", "h", "sao", "donate", "b", "f", "p", "g"]);
  });

  it("uses only splash styles Terraform knows how to render", () => {
    // splash_style selects a template in cloudfront-redirect/assets — an unknown
    // value silently falls back to the hackers splash.
    const known = new Set(["hackers", "countdown", "bib", "flash", "phone", "ghost"]);
    for (const r of all) expect(known.has(r.splash), `splash ${r.splash}`).toBe(true);
  });

  it("every record has required fields", () => {
    for (const r of all) {
      expect(r.host).toBeTruthy();
      expect(r.fqdn).toContain(".defcon.run");
      expect(r.targetUrl.startsWith("https://")).toBe(true);
    }
  });

  it("every record carries the og fields Terraform requires", () => {
    for (const r of redirects as Array<{ og?: { title?: string; description?: string; image?: string } }>) {
      expect(r.og?.title, `og.title on a record`).toBeTruthy();
      expect(r.og?.description, `og.description`).toBeTruthy();
      expect(r.og?.image, `og.image`).toBeTruthy();
    }
  });
});
