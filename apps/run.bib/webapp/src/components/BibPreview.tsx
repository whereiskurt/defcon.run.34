import { DC34_LOGO_DATA_URI } from "./dc34-logo";

/**
 * BibPreview
 *
 * Pure presentational component. Renders the DC34 race-bib SVG with two
 * dynamic text slots driven by props:
 *   - #bib-number  ("1337" placeholder while `name` is empty, else `code`)
 *   - #bib-name    (the user's `nameOnBib`, hidden when empty)
 *
 * The SVG structure mirrors the Kurt-provided asset at
 * `.planning/phases/21-bib-app-scaffold-registration/assets/bib-template.svg`
 * (converted to JSX so React can reactively re-render on prop change without
 * a fetch / dangerouslySetInnerHTML round-trip).
 *
 * Auto-shrink font-size logic:
 *   - `bib-number`: base 248px. Shrink when the string is wider than a
 *     ~740px working budget inside the 856-wide black box (accounting for
 *     the two corner smiley badges). Floor 60px.
 *   - `bib-name`: base 56px. Shrink to fit the same ~780px budget under the
 *     number. Floor 20px. Never wrap, never truncate — a 32-char server-cap
 *     name renders as small legible text at the floor size.
 *
 * The width budget assumes ~0.55 x font-size per glyph for the Arial-Black
 * family the SVG picks. Empirically that keeps the string in the box across
 * the full 1..32-char range.
 */
export interface BibPreviewProps {
  /** Name to render on the bib. Empty string hides the name row. */
  name: string;
  /** Runner code assigned by /api/bib (BIB-XXXX). Falls back to "1337" if
   * blank or if the user hasn't yet entered a name. */
  code: string;
  /**
   * Phase 22-05-06 sponsor charm accent. When `true`, renders a small
   * amber charm (~40px diameter, top-right of the card) as a visual
   * "thank you" for participants who have contributed any amount to a
   * bib sponsorship OR general donation. Optional — defaults to `false`
   * so the pre-22-05 BibPreview render remains bit-identical.
   *
   * Wired from `bib.paidAmount > 0` at the page.tsx level (server-side
   * data). Does NOT interact with the print gate — payment is orthogonal
   * to registration (see canPrintName in entities/bib.ts).
   */
  hasSponsored?: boolean;
}

/** Design-contract placeholder rendered when the user has not typed a name. */
const NUMBER_PLACEHOLDER = "1337";

/** Working horizontal budget in SVG-user-units for the big number.
 * The black box is 856 wide with two 70px smiley badges nibbling the sides,
 * so budget ~740px so the text sits between the badges without overlapping. */
const NUMBER_WIDTH_BUDGET = 740;
/** Working horizontal budget for the name row. Slightly wider because the
 * name sits below the badges (they hug the top-left / mid-right corners). */
const NAME_WIDTH_BUDGET = 780;
/** Base font sizes match the SVG template exactly. */
const NUMBER_BASE_SIZE = 248;
const NUMBER_MIN_SIZE = 60;
const NAME_BASE_SIZE = 56;
const NAME_MIN_SIZE = 20;
/** Approximate glyph-width factor for the SVG's Arial-Black stack.
 * Slightly conservative so the shrunk text always stays inside the budget. */
const GLYPH_WIDTH_FACTOR = 0.62;

/**
 * Given a target text, base font-size, min font-size, and horizontal budget,
 * compute the largest font-size (px) at which the text fits within the
 * budget. Never returns above the base or below the min.
 */
function fitFontSize(
  text: string,
  base: number,
  min: number,
  widthBudget: number
): number {
  if (!text) return base;
  // Guard against a zero-length string sneaking through (still return base).
  const est = widthBudget / (GLYPH_WIDTH_FACTOR * text.length);
  if (est >= base) return base;
  if (est <= min) return min;
  return Math.floor(est);
}

/**
 * Given a font-size and estimated glyph width, compute the SVG-y offset for
 * the name so it sits visually centered under the number even when the name
 * shrinks. The SVG uses dominant-baseline="middle" — this only re-centers
 * relative to the box, not the string metrics.
 *
 * Y range for the name row: 340..470 (centre 405).
 */
function nameY(_size: number): number {
  return 438;
}

export function BibPreview({
  name,
  code,
  hasSponsored = false,
}: BibPreviewProps) {
  const trimmedName = name.trim();
  const hasName = trimmedName.length > 0;

  const bigNumber = hasName ? code || NUMBER_PLACEHOLDER : NUMBER_PLACEHOLDER;
  const numberSize = fitFontSize(
    bigNumber,
    NUMBER_BASE_SIZE,
    NUMBER_MIN_SIZE,
    NUMBER_WIDTH_BUDGET
  );

  // When no name is present, re-center the number vertically in the black box
  // (per the SVG template's comment: "the component may re-center #bib-number
  // in the full box"). Otherwise keep the layout at y=284 so the name fits
  // under it at y=438.
  const numberY = hasName ? 284 : 308;
  const nameSize = fitFontSize(
    trimmedName,
    NAME_BASE_SIZE,
    NAME_MIN_SIZE,
    NAME_WIDTH_BUDGET
  );

  // Stub numbers on the tear-offs: always the runnerCode's XXXX portion
  // (or "1337" as a placeholder before a bib exists).
  const stubNumber = code || NUMBER_PLACEHOLDER;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 960 700"
      width="100%"
      style={{ display: "block", maxWidth: 720, height: "auto" }}
      fontFamily="'Arial Black','Arial Narrow',Helvetica,Arial,sans-serif"
      role="img"
      aria-label={
        hasName
          ? `Race bib preview for ${trimmedName}, runner code ${code || NUMBER_PLACEHOLDER}`
          : `Race bib preview, runner code ${code || NUMBER_PLACEHOLDER}`
      }
    >
      <defs>
        {/* DEF CON smiley: white smiley face over white crossbones;
            features cut to badge colour. Preserved verbatim from the
            template asset. */}
        <symbol id="smiley" viewBox="0 0 100 100">
          <g fill="#fff">
            <g transform="rotate(45 50 50)">
              <rect x="14" y="45.5" width="72" height="9" rx="4.5" />
              <circle cx="14" cy="43" r="6" />
              <circle cx="14" cy="57" r="6" />
              <circle cx="86" cy="43" r="6" />
              <circle cx="86" cy="57" r="6" />
            </g>
            <g transform="rotate(-45 50 50)">
              <rect x="14" y="45.5" width="72" height="9" rx="4.5" />
              <circle cx="14" cy="43" r="6" />
              <circle cx="14" cy="57" r="6" />
              <circle cx="86" cy="43" r="6" />
              <circle cx="86" cy="57" r="6" />
            </g>
          </g>
          <circle cx="50" cy="50" r="27" fill="#fff" />
          <g fill="#000">
            <ellipse cx="40" cy="45" rx="4.6" ry="6.2" />
            <ellipse cx="60" cy="45" rx="4.6" ry="6.2" />
          </g>
          <path
            d="M37 56 Q50 70 63 56"
            fill="none"
            stroke="#000"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </symbol>
        <symbol id="smiley-circle" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="50" fill="#000" />
          <use href="#smiley" />
        </symbol>
        <symbol id="smiley-square" viewBox="0 0 100 100">
          <rect x="0" y="0" width="100" height="100" rx="10" fill="#000" />
          <use href="#smiley" />
        </symbol>
      </defs>

      {/* card */}
      <rect
        x="4"
        y="4"
        width="952"
        height="692"
        rx="16"
        fill="#fff"
        stroke="#c8ccd4"
        strokeWidth="3"
      />

      {/*
        Sponsor charm accent (Phase 22-05-06).
        Small amber circle with a white star, rendered in the top-right
        corner of the card when the participant has any contribution
        (bib.paidAmount > 0). Kept inside the card border so it doesn't
        overlap the pin holes; z-order after the card rect so it renders
        on top.
      */}
      {hasSponsored && (
        <g
          id="sponsor-charm"
          role="presentation"
          aria-label="Sponsor charm"
          data-testid="sponsor-charm"
        >
          <circle
            cx="912"
            cy="46"
            r="22"
            fill="#d97706"
            stroke="#a05308"
            strokeWidth="2"
          />
          {/* 5-point star, scaled to sit inside the 22-radius circle */}
          <path
            d="M912 32 L916 42 L927 42 L918 49 L921 60 L912 53 L903 60 L906 49 L897 42 L908 42 Z"
            fill="#fff"
          />
        </g>
      )}

      {/* top banner: official DC34 logo (includes DEFCON) */}
      <image
        id="dc34-logo"
        href={DC34_LOGO_DATA_URI}
        x="80"
        y="14"
        width="800"
        height="112"
        preserveAspectRatio="xMidYMid meet"
      />

      {/* pin holes (top) */}
      <circle
        cx="70"
        cy="72"
        r="9"
        fill="#fff"
        stroke="#000"
        strokeWidth="2.5"
      />
      <circle
        cx="890"
        cy="72"
        r="9"
        fill="#fff"
        stroke="#000"
        strokeWidth="2.5"
      />

      {/* number box */}
      <rect x="52" y="140" width="856" height="336" rx="6" fill="#000" />

      {/* corner smiley badges */}
      <use href="#smiley-circle" x="76" y="160" width="70" height="70" />
      <use href="#smiley-circle" x="814" y="386" width="70" height="70" />

      {/* BIG NUMBER (dynamic) — top of the box */}
      <text
        id="bib-number"
        x="480"
        y={numberY}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={numberSize}
        fontWeight="900"
        letterSpacing="-6"
        fill="#fff"
      >
        {bigNumber}
      </text>

      {/* NAME (dynamic) — UNDER the number, inside the box; empty text hides it */}
      {hasName && (
        <text
          id="bib-name"
          x="480"
          y={nameY(nameSize)}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={nameSize}
          fontWeight="800"
          letterSpacing="1"
          fill="#fff"
        >
          {trimmedName}
        </text>
      )}

      {/* pin holes (bottom) */}
      <circle
        cx="70"
        cy="508"
        r="9"
        fill="#fff"
        stroke="#000"
        strokeWidth="2.5"
      />
      <circle
        cx="890"
        cy="508"
        r="9"
        fill="#fff"
        stroke="#000"
        strokeWidth="2.5"
      />

      {/* perforation */}
      <line
        x1="24"
        y1="578"
        x2="936"
        y2="578"
        stroke="#000"
        strokeWidth="1.5"
        strokeDasharray="7 7"
      />
      <line
        x1="480"
        y1="582"
        x2="480"
        y2="688"
        stroke="#000"
        strokeWidth="1.5"
        strokeDasharray="7 7"
      />

      {/* tear-off stubs: smiley + small number, x2 */}
      <use href="#smiley-square" x="44" y="598" width="72" height="72" />
      <rect x="360" y="612" width="96" height="48" rx="6" fill="#000" />
      <text
        x="408"
        y="646"
        textAnchor="middle"
        fontSize="34"
        fontWeight="900"
        fill="#fff"
      >
        {stubNumber}
      </text>

      <use href="#smiley-square" x="504" y="598" width="72" height="72" />
      <rect x="820" y="612" width="96" height="48" rx="6" fill="#000" />
      <text
        x="868"
        y="646"
        textAnchor="middle"
        fontSize="34"
        fontWeight="900"
        fill="#fff"
      >
        {stubNumber}
      </text>
    </svg>
  );
}

export default BibPreview;
