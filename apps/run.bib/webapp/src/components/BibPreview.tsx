import { DC34_LOGO_DATA_URI } from "./dc34-logo";

/**
 * BibPreview
 *
 * Pure presentational component. Renders the DC34 race-bib SVG with two
 * dynamic text slots driven by props:
 *   - #bib-number  ("1337" placeholder while `name` is empty, else the name)
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
  /** Name to render on the bib. Empty string shows the "1337" placeholder
   * in the primary display slot AND on the tear-off stubs. Kurt 2026-07-02:
   * name REPLACES the placeholder — no separate name row underneath. */
  name: string;
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

/** Design-contract placeholder rendered when the user has not typed a name.
 * Replaced by the user's name-on-bib in the primary display area (Kurt
 * 2026-07-02 feedback: name REPLACES 1337, not stacked underneath). */
const PRIMARY_PLACEHOLDER = "1337";

/** Working horizontal budget in SVG-user-units for the primary display text.
 * The black box is 856 wide with two 70px smiley badges nibbling the sides,
 * so budget ~740px so the text sits between the badges without overlapping. */
const PRIMARY_WIDTH_BUDGET = 740;
/** Base font sizes for the primary display slot. `1337` (4 chars) renders at
 * ~248px; longer names shrink via fitFontSize down to `NUMBER_MIN_SIZE`. */
const NUMBER_BASE_SIZE = 248;
const NUMBER_MIN_SIZE = 44;
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

/** Tear-off text budget. Stubs are 96×48 with padding for the smiley badges,
 * so ~86px of usable width. Same base + min tune as the primary but scaled. */
const STUB_WIDTH_BUDGET = 86;
const STUB_BASE_SIZE = 34;
const STUB_MIN_SIZE = 12;

export function BibPreview({
  name,
  hasSponsored = false,
}: BibPreviewProps) {
  const trimmedName = name.trim();
  const hasName = trimmedName.length > 0;

  // Kurt 2026-07-02 feedback: name REPLACES 1337 in the primary display; no
  // separate name row underneath. The runnerCode is NEVER shown on the bib
  // (transactions-only). Tear-off stubs show the name (or 1337 placeholder).
  const primaryText = hasName ? trimmedName : PRIMARY_PLACEHOLDER;
  const primarySize = fitFontSize(
    primaryText,
    NUMBER_BASE_SIZE,
    NUMBER_MIN_SIZE,
    PRIMARY_WIDTH_BUDGET
  );

  // Center the primary text vertically in the black box regardless of name
  // state (no separate name row anymore).
  const primaryY = 308;

  // Tear-off stub text: same slot for both stubs. Empty name falls back to
  // the "1337" placeholder to keep the visual balanced pre-name-entry.
  const stubText = hasName ? trimmedName : PRIMARY_PLACEHOLDER;
  const stubSize = fitFontSize(
    stubText,
    STUB_BASE_SIZE,
    STUB_MIN_SIZE,
    STUB_WIDTH_BUDGET
  );

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
          ? `Race bib preview for ${trimmedName}`
          : `Race bib preview, placeholder ${PRIMARY_PLACEHOLDER}`
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

      {/* PRIMARY SLOT (dynamic) — "1337" placeholder or the user's name
       * once entered. Replaces the previous two-row (number + name-below)
       * layout per Kurt 2026-07-02 feedback. The runnerCode is NEVER
       * shown on the bib — it exists only for payment reconciliation. */}
      <text
        id="bib-number"
        x="480"
        y={primaryY}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={primarySize}
        fontWeight="900"
        letterSpacing={hasName ? "-1" : "-6"}
        fill="#fff"
      >
        {primaryText}
      </text>

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
        fontSize={stubSize}
        fontWeight="900"
        fill="#fff"
      >
        {stubText}
      </text>

      <use href="#smiley-square" x="504" y="598" width="72" height="72" />
      <rect x="820" y="612" width="96" height="48" rx="6" fill="#000" />
      <text
        x="868"
        y="646"
        textAnchor="middle"
        fontSize={stubSize}
        fontWeight="900"
        fill="#fff"
      >
        {stubText}
      </text>
    </svg>
  );
}

export default BibPreview;
