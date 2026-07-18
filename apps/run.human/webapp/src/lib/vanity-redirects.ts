import redirects from "@/data/redirects.json";

/** One Terraform-managed vanity subdomain, shaped for read-only display. */
export type VanityRedirect = {
  host: string;
  fqdn: string;
  targetUrl: string;
  splash: string;
  statusCode: string;
};

type RawRedirect = {
  host: string;
  target_host: string;
  target_path: string;
  target_query: string;
  status_code: string;
  priority?: number;
  splash_style?: string;
  og?: { title?: string; description?: string; image?: string; image_file?: string };
};

/**
 * Load the vanity-redirect list from the shared redirects.json — the same file
 * the redirect-rules terragrunt unit reads. Read-only source of truth; edits go
 * to redirects.json + a terraform apply, never through the UI.
 */
export function loadVanityRedirects(): VanityRedirect[] {
  const raw = redirects as RawRedirect[];
  return raw
    .map((r) => {
      if (!r.host || !r.target_host) {
        throw new Error(`redirects.json: record missing host/target_host: ${JSON.stringify(r)}`);
      }
      const query = r.target_query ? `?${r.target_query}` : "";
      return {
        host: r.host,
        fqdn: `${r.host}.defcon.run`,
        targetUrl: `https://${r.target_host}${r.target_path}${query}`,
        splash: r.splash_style ?? "hackers",
        statusCode: r.status_code,
      };
    })
    .sort((a, b) => {
      const pa = raw.find((x) => x.host === a.host)?.priority ?? 0;
      const pb = raw.find((x) => x.host === b.host)?.priority ?? 0;
      return pa - pb;
    });
}
