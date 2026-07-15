/** Ghost slug → persona for the reveal popup. Unknown slug → title-cased fallback. */
const IDENTITIES: Record<string, string> = {
  condor: "Kevin Mitnick",
  hopper: "Grace Hopper",
  turing: "Alan Turing",
  ladyada: "Limor Fried",
  mudge: "Peiter Zatko",
  goldstein: "Emmanuel Goldstein",
  dt: "The Dark Tangent",
  gibson: "Gibson",
  sharp: "Sharp",
  ricky: "Ricky",
  bigstar: "Big Star",
};

export function ghostWho(slug: string): string {
  return (
    IDENTITIES[slug] ??
    slug.replace(/(^|[-_])([a-z])/g, (_m, sep, c) => (sep ? " " : "") + c.toUpperCase())
  );
}
