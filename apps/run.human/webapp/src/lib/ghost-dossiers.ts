/**
 * Ghost slug → dossier for the /admin/ghosts roster. Copied from run.gpx's
 * ghost-identities.ts (the map-popup dossiers) — static data, duplicated rather
 * than shared across app boundaries on purpose. Each ghost node in the mesh is
 * a "flatlined" construct of a hacker-culture figure (see the persona prompts
 * in apps/run.mqtt/meshtk/meshtk.dc34.yaml).
 *
 * Blurbs are strictly biographical — they must NEVER hint at the covert CTF
 * flag phrases or secret codes baked into those persona prompts. (The admin
 * roster shows flag codes elsewhere on the card, behind the admin gate — but
 * dossier copy stays clean so it can be reused on any surface.)
 */
export interface GhostDossier {
  name: string; // the real figure the ghost is modeled on
  alias?: string; // their handle / callsign flavor
  blurb: string; // one-line "who is this" — biographical only, no CTF hints
  link?: string; // optional "learn more" URL (opened in a new tab)
}

const DOSSIERS: Record<string, GhostDossier> = {
  condor: {
    name: "Kevin Mitnick",
    alias: "Condor",
    blurb: "The '90s most-wanted hacker — a social-engineering legend who became a top security consultant.",
    link: "https://en.wikipedia.org/wiki/Kevin_Mitnick",
  },
  goldstein: {
    name: "Emmanuel Goldstein",
    alias: "2600",
    blurb: "Pen name of Eric Corley — founding voice of 2600 Magazine and the 'Off The Hook' radio show.",
    link: "https://en.wikipedia.org/wiki/Eric_Corley",
  },
  mudge: {
    name: "Peiter Zatko",
    alias: "Mudge",
    blurb: "L0pht and cDc member turned DARPA program manager; later blew the whistle on Twitter's security.",
    link: "https://en.wikipedia.org/wiki/Peiter_Zatko",
  },
  sharp: {
    name: "Gene Sharp",
    alias: "Sharp",
    blurb: "Scholar of nonviolent struggle whose 'From Dictatorship to Democracy' guided resistance worldwide.",
    link: "https://en.wikipedia.org/wiki/Gene_Sharp",
  },
  ladyada: {
    name: "Ada Lovelace",
    alias: "ladyada",
    blurb: "19th-century mathematician who wrote the first algorithm for Babbage's Analytical Engine.",
    link: "https://en.wikipedia.org/wiki/Ada_Lovelace",
  },
  hopper: {
    name: "Grace Hopper",
    alias: "Amazing Grace",
    blurb: "Navy rear admiral and computing pioneer who built the first compiler and popularized 'the bug'.",
    link: "https://en.wikipedia.org/wiki/Grace_Hopper",
  },
  turing: {
    name: "Alan Turing",
    alias: "Turing",
    blurb: "Father of computer science; broke the Enigma cipher and defined the machine that bears his name.",
    link: "https://en.wikipedia.org/wiki/Alan_Turing",
  },
  gibson: {
    name: "William Gibson",
    alias: "Gibson",
    blurb: "Cyberpunk novelist who wrote 'Neuromancer' and coined the word 'cyberspace'.",
    link: "https://en.wikipedia.org/wiki/William_Gibson",
  },
  dt: {
    name: "The Dark Tangent",
    alias: "DT",
    blurb: "Jeff Moss — founder of DEF CON and Black Hat, and the reason you're all here.",
    link: "https://en.wikipedia.org/wiki/Jeff_Moss_(hacker)",
  },
  ricky: {
    name: "Rick Astley",
    alias: "Ricky",
    blurb: "You know the rules, and so do I. Never gonna give this ghost up.",
    link: "https://en.wikipedia.org/wiki/Rick_Astley",
  },
  bigstar: {
    name: "Big Star",
    alias: "bigstar",
    blurb: "A ghost on the wire, drifting the Vegas mesh.",
  },
};

/** Full dossier for a slug; undefined for unknown slugs (caller falls back). */
export function ghostDossier(slug: string): GhostDossier | undefined {
  return DOSSIERS[slug];
}
