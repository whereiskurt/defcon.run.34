/**
 * Pure assembly for the auth identity admin dashboard. NEVER import into a
 * client component with emailFull populated — the route masks/reveals.
 */

export type ProviderKey = "github" | "discord" | "linkedin" | "strava" | "email";

/** One OAuth ACCOUNT# row from the authjs adapter table. */
export type AccountRow = {
  provider: string;            // "github" | "discord" | "linkedin" | "strava" | ...
  providerAccountId: string;
  userId: string;              // AuthProfile.userId (= OIDC sub)
};

/** Projection of an AuthProfile needed for the report (Task 3 supplies this). */
export type ProfileRow = {
  userId: string;
  displayName: string | null;
  email: string | null;
  services: string[];
  lastProvider: string | null;
  createdAt: number | null;
  lockedOut: boolean;
  jailed?: boolean;
  jailLevel?: number;
  github: { linkedAt?: number } | null;
  discord: { linkedAt?: number } | null;
  strava: { linkedAt?: number } | null;
};

export type IdentityRow = {
  userId: string;
  displayName: string;
  emailFull: string | null;
  emailMasked: string;
  services: string[];
  providers: ProviderKey[];
  providerCount: number;
  lastProvider: string | null;
  createdAt: number | null;
  lockedOut: boolean;
  jailed: boolean;
  jailLevel: number | null;
  linkedAt: Partial<Record<ProviderKey, number>>;
};

export type IdentitySort = "created" | "providers" | "displayName";

export type SummaryTiles = {
  totalIdentities: number;
  new24h: number;
  multiProvider: number;
  locked: number;
  jailed: number;
};

const KNOWN_PROVIDERS: ProviderKey[] = ["github", "discord", "linkedin", "strava", "email"];

export function maskEmail(email: string | null): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

/**
 * RFC-4180 escape PLUS spreadsheet formula-injection guard: values beginning
 * with = + - @ are prefixed with a single quote so Excel/Sheets treat them as
 * text. displayName/email are attacker-controllable, so this is mandatory.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: { key: string; header: string }[], rows: Record<string, unknown>[]): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => csvCell(row[c.key])).join(","));
  return [head, ...body].join("\n");
}

/** Union of providers present in ACCOUNT rows, plus `email` if lastProvider says so. */
export function deriveProviders(accounts: AccountRow[], lastProvider: string | null): ProviderKey[] {
  const set = new Set<ProviderKey>();
  for (const a of accounts) {
    if ((KNOWN_PROVIDERS as string[]).includes(a.provider)) set.add(a.provider as ProviderKey);
  }
  if (lastProvider === "email") set.add("email");
  // An identity with no account rows but an email login still shows `email`.
  if (set.size === 0 && lastProvider === "email") set.add("email");
  return [...set];
}

/** linkedAt timestamp for a provider from the AuthProfile maps (null if absent). */
export function linkedAtFor(profile: ProfileRow, provider: ProviderKey): number | null {
  if (provider === "github") return profile.github?.linkedAt ?? null;
  if (provider === "discord") return profile.discord?.linkedAt ?? null;
  if (provider === "strava") return profile.strava?.linkedAt ?? null;
  return null; // linkedin/email have no AuthProfile map
}

export function mergeIdentityRows(
  profiles: ProfileRow[],
  accountsByUser: Record<string, AccountRow[]>,
): IdentityRow[] {
  return profiles.map((p) => {
    const accounts = accountsByUser[p.userId] ?? [];
    const providers = deriveProviders(accounts, p.lastProvider);
    const linkedAt: Partial<Record<ProviderKey, number>> = {};
    for (const prov of providers) {
      const t = linkedAtFor(p, prov);
      if (t != null) linkedAt[prov] = t;
    }
    return {
      userId: p.userId,
      displayName: p.displayName ?? "",
      emailFull: p.email ?? null,
      emailMasked: maskEmail(p.email ?? null),
      services: p.services ?? [],
      providers,
      providerCount: providers.length,
      lastProvider: p.lastProvider ?? null,
      createdAt: p.createdAt ?? null,
      lockedOut: p.lockedOut,
      jailed: p.jailed === true,
      jailLevel: typeof p.jailLevel === "number" ? p.jailLevel : null,
      linkedAt,
    };
  });
}

export function filterByEmail(rows: IdentityRow[], q: string): IdentityRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => (r.emailFull ?? "").toLowerCase().includes(needle));
}

export function sortRows(rows: IdentityRow[], sort: IdentitySort): IdentityRow[] {
  const cmp: Record<IdentitySort, (a: IdentityRow, b: IdentityRow) => number> = {
    created: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
    providers: (a, b) => b.providerCount - a.providerCount,
    displayName: (a, b) => a.displayName.localeCompare(b.displayName),
  };
  return [...rows].sort(cmp[sort]);
}

export function summaryTiles(rows: IdentityRow[]): SummaryTiles {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  return {
    totalIdentities: rows.length,
    new24h: rows.filter((r) => r.createdAt != null && now - r.createdAt <= DAY).length,
    multiProvider: rows.filter((r) => r.providerCount > 1).length,
    locked: rows.filter((r) => r.lockedOut).length,
    jailed: rows.filter((r) => r.jailed).length,
  };
}
