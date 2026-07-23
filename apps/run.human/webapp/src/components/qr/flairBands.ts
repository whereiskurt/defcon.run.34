import type { BandTier } from "@/lib/social-rank";

/**
 * Visual parameters per social-rank band — the "Reactor Tuned" escalation
 * curve from sketch 003-D. Early gratification: visible flair starts at
 * TOP 50%; every band advertises the next unlock. LEADER goes gold.
 *
 * Scan-safety: scanHeight is capped at 18 (px at the 300px card) and the
 * overlay stays translucent — inside EC-H's ~30% damage budget alongside the
 * ~6% dcjack knockout. Do not widen.
 */

export type FlairParams = {
  /** 0..1 conic reactor ring opacity (0 = hidden). */
  reactorOpacity: number;
  /** Reactor spin period in seconds (faster = higher rank). */
  spinSecs: number;
  /** Scanline height px at 300px card (0 = hidden). Max 18. */
  scanHeight: number;
  scanOpacity: number;
  /** Halo bloom opacity 0..1. */
  haloOpacity: number;
  /** Neon-tube ring fill percent (0-100). */
  ringFill: number;
  /** How many of the 6 level ticks are lit. */
  ticksOn: number;
  /** Badge glow drop-shadow radius px (0 = none). */
  badgeGlow: number;
  /** Gold LEADER treatment. */
  gold: boolean;
  /** "NEXT //" unlock teaser (empty at LEADER). */
  teaser: string;
};

const PARAMS: Record<BandTier, FlairParams> = {
  none: {
    reactorOpacity: 0,
    spinSecs: 5,
    scanHeight: 0,
    scanOpacity: 0,
    haloOpacity: 0,
    ringFill: 0,
    ticksOn: 0,
    badgeGlow: 0,
    gold: false,
    teaser: "scan one runner to enter the board — flair starts at TOP 50%",
  },
  entered: {
    reactorOpacity: 0,
    spinSecs: 5,
    scanHeight: 0,
    scanOpacity: 0,
    haloOpacity: 0,
    ringFill: 8,
    ticksOn: 1,
    badgeGlow: 0,
    gold: false,
    teaser: "NEXT // TOP 50%: the reactor wakes up",
  },
  top50: {
    reactorOpacity: 0.25,
    spinSecs: 5,
    scanHeight: 10,
    scanOpacity: 0.4,
    haloOpacity: 0.35,
    ringFill: 28,
    ticksOn: 2,
    badgeGlow: 4,
    gold: false,
    teaser: "NEXT // TOP 25%: ring brightens, scanline strengthens",
  },
  top25: {
    reactorOpacity: 0.5,
    spinSecs: 5,
    scanHeight: 14,
    scanOpacity: 0.7,
    haloOpacity: 0.5,
    ringFill: 50,
    ticksOn: 3,
    badgeGlow: 7,
    gold: false,
    teaser: "NEXT // TOP 10%: full bloom + scanline surge",
  },
  top10: {
    reactorOpacity: 0.7,
    spinSecs: 4,
    scanHeight: 18,
    scanOpacity: 1,
    haloOpacity: 0.75,
    ringFill: 72,
    ticksOn: 4,
    badgeGlow: 11,
    gold: false,
    teaser: "NEXT // TOP 5%: badge rail ignites",
  },
  top5: {
    reactorOpacity: 0.9,
    spinSecs: 3,
    scanHeight: 18,
    scanOpacity: 1,
    haloOpacity: 0.95,
    ringFill: 88,
    ticksOn: 5,
    badgeGlow: 16,
    gold: false,
    teaser: "NEXT // №1: everything goes GOLD",
  },
  leader: {
    reactorOpacity: 1,
    spinSecs: 2.2,
    scanHeight: 18,
    scanOpacity: 1,
    haloOpacity: 1,
    ringFill: 100,
    ticksOn: 6,
    badgeGlow: 20,
    gold: true,
    teaser: "",
  },
};

export function flairParams(tier: BandTier): FlairParams {
  return PARAMS[tier];
}

export type MilestoneBadge = {
  id: string;
  glyph: string;
  cap: string;
  name: string;
  threshold: number;
  color: "magenta" | "green";
};

/** Milestone pins by socialScore. */
export const MILESTONES: MilestoneBadge[] = [
  { id: "c1", glyph: "1st", cap: "CONTACT", name: "FIRST CONTACT", threshold: 1, color: "magenta" },
  { id: "c15", glyph: "SE", cap: "LVL 15", name: "SOCIAL ENGINEER", threshold: 15, color: "magenta" },
  { id: "c30", glyph: "⌁30", cap: "MESH", name: "MESH NODE", threshold: 30, color: "green" },
  { id: "c60", glyph: "60", cap: "GHOST", name: "GHOST PROTOCOL", threshold: 60, color: "magenta" },
  { id: "c100", glyph: "100", cap: "LEGEND", name: "RABBIT LEGEND", threshold: 100, color: "green" },
];
