/**
 * Simulated-rabbit identities — camouflage cover traffic for the rabbit layer.
 * Each sim rabbit is a meshtk node named `rabbit-sim-<slug>-NN`; this map turns
 * the slug into a display identity (rabbit_#### to mimic real run.human names)
 * and a distinct pin tint. Mirrors ghost-identities.ts — no run.human account.
 */
export type SimRabbit = { displayName: string; pinColor: string };

export const SIM_RABBITS: Record<string, SimRabbit> = {
  swift:  { displayName: "rabbit_4a1c", pinColor: "#e6007a" },
  dash:   { displayName: "rabbit_1337", pinColor: "#00d4aa" },
  comet:  { displayName: "rabbit_9f2a", pinColor: "#7b61ff" },
  nova:   { displayName: "rabbit_0b73", pinColor: "#ff6b35" },
  echo:   { displayName: "rabbit_c4e8", pinColor: "#00b4d8" },
  vega:   { displayName: "rabbit_2d5f", pinColor: "#f15bb5" },
  orbit:  { displayName: "rabbit_8ab0", pinColor: "#ffd166" },
  pixel:  { displayName: "rabbit_63d1", pinColor: "#06d6a0" },
  raven:  { displayName: "rabbit_f07e", pinColor: "#ef476f" },
  scout:  { displayName: "rabbit_5c92", pinColor: "#4cc9f0" },
  ember:  { displayName: "rabbit_a318", pinColor: "#fb5607" },
  frost:  { displayName: "rabbit_7e44", pinColor: "#8ecae6" },
};

const SIM_RE = /rabbit-sim/i;

export function isSimRabbit(longName: string | undefined, shortName?: string): boolean {
  return SIM_RE.test(longName ?? "") || SIM_RE.test(shortName ?? "");
}

/** "rabbit-sim-swift-00" → "swift"; non-sim names → null. */
export function simRabbitSlug(longName: string): string | null {
  const m = longName.toLowerCase().match(/rabbit-sim[-_]([a-z0-9]+)/);
  return m?.[1] ?? null;
}

export function simRabbit(slug: string): SimRabbit | undefined {
  return SIM_RABBITS[slug];
}
