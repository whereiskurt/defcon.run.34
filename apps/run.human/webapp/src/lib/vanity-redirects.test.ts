import { describe, it, expect } from "vitest";
import { loadVanityRedirects } from "./vanity-redirects";
import redirects from "@/data/redirects.json";

describe("loadVanityRedirects", () => {
  const all = loadVanityRedirects();

  it("includes donate mapped to the whoami donate flow", () => {
    const donate = all.find((r) => r.host === "donate");
    expect(donate).toBeDefined();
    expect(donate!.fqdn).toBe("donate.defcon.run");
    expect(donate!.targetUrl).toBe("https://run.defcon.run/use1/whoami?open=donate");
    expect(donate!.splash).toBe("hackers");
    expect(donate!.statusCode).toBe("HTTP_302");
  });

  it("defaults splash to hackers and honors countdown", () => {
    expect(all.find((r) => r.host === "sao")!.splash).toBe("countdown");
    expect(all.find((r) => r.host === "r")!.splash).toBe("hackers");
  });

  it("builds targetUrl without a trailing ? when query is empty", () => {
    expect(all.find((r) => r.host === "h")!.targetUrl).toBe("https://run.defcon.run/");
  });

  it("returns hosts sorted by priority", () => {
    const hosts = all.map((r) => r.host);
    expect(hosts).toEqual(["r", "h", "sao", "donate"]);
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
