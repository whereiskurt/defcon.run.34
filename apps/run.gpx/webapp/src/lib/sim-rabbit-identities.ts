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

const PACK_PALETTE = ["#e6007a","#00d4aa","#7b61ff","#ff6b35","#00b4d8","#f15bb5","#ffd166","#06d6a0"];

/** 16-bit FNV-1a over the full node name → stable, format-agnostic. */
function hash16(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h ^ (h >>> 16)) & 0xffff;
}

/** Resolve a sim node's display identity from its full longName. */
export function simRabbitIdentity(longName: string): SimRabbit | null {
  if (/rabbit-sim-pack-/i.test(longName)) {
    const h = hash16(longName.toLowerCase());
    return { displayName: "rabbit_" + h.toString(16).padStart(4, "0"), pinColor: PACK_PALETTE[h % PACK_PALETTE.length] };
  }
  const slug = simRabbitSlug(longName);
  return (slug && simRabbit(slug)) || null;
}
