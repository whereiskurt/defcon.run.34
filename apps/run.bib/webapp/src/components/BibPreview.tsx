import QRCode from "qrcode";
import { DC34_LOGO_DATA_URI } from "./dc34-logo";
import { DC34_SMILEY_DATA_URI } from "./dc34-smiley";

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
   * green (DC34 mint palette #6CCDB8) charm (~40px diameter, top-right of the card) as a visual
   * "thank you" for participants who have contributed any amount to a
   * bib sponsorship OR general donation. Optional — defaults to `false`
   * so the pre-22-05 BibPreview render remains bit-identical.
   *
   * Wired from `bib.paidAmount > 0` at the page.tsx level (server-side
   * data). Does NOT interact with the print gate — payment is orthogonal
   * to registration (see canPrintName in entities/bib.ts).
   */
  hasSponsored?: boolean;
  /** Runner code (e.g. BIB-XXXX) — rendered as a QR on each tear-off stub so
   * the code is scannable when a stub is torn off (Kurt 2026-07-03). Also the
   * fallback QR value when no social-QR URL is available. */
  runnerCode?: string;
  /**
   * Runner's real per-user social-QR URL (`/r?h=<hash>`) resolved server-side
   * (Plan 34-04, Slice C — C-T4). When present it is encoded (enlarged) on both
   * tear-off stubs so a scanned stub opens the runner's public profile QR — the
   * same `/r?h=` target run.human prints. When ABSENT the stub falls back to the
   * runnerCode QR: a missing hash never blanks a stub (SC34.8).
   */
  socialQrUrl?: string;
  /**
   * Unsaved-name state (Plan 34-03, SC34.5). When `true`, renders a red-orange
   * "UNSAVED" rubber stamp in the SAME slot as the green PAID stamp. UNSAVED
   * OUTRANKS PAID: while dirty, the PAID stamp is suppressed so the runner
   * can't mistake an unsaved name for a committed, paid bib.
   */
  dirty?: boolean;
  /**
   * Uncommitted "free bib" state (Kurt 2026-07-05). When `true`, renders a
   * white-on-black "DRAFT" rubber stamp in the same top-right slot as PAID /
   * UNSAVED — signalling the bib isn't finalized for a custom print until the
   * runner commits (pledges $20 in person, donates, OR sponsors). Cleared the
   * moment any of those happen. Stamp priority: UNSAVED (dirty) > PAID
   * (sponsored) > DRAFT (uncommitted) > none (committed via pledge/donation).
   */
  draft?: boolean;
}

/** Design-contract placeholder rendered when the user has not typed a name.
 * Replaced by the user's name-on-bib in the primary display area (Kurt
 * 2026-07-02 feedback: name REPLACES 1337, not stacked underneath). */
const PRIMARY_PLACEHOLDER = "1337";

/** Working horizontal budget in SVG-user-units for the primary display text.
 * The black box is 856 wide with two 70px smiley badges nibbling the sides,
 * so budget ~740px so the text sits between the badges without overlapping. */
const PRIMARY_WIDTH_BUDGET = 660;
/** Base font sizes for the primary display slot. `1337` (4 chars) renders at
 * ~248px; longer names shrink via fitFontSize down to `NUMBER_MIN_SIZE`. */
const NUMBER_BASE_SIZE = 248;
const NUMBER_MIN_SIZE = 44;
/** Approximate glyph-width factor for the SVG's Arial-Black stack.
 * Slightly conservative so the shrunk text always stays inside the budget. */
const GLYPH_WIDTH_FACTOR = 0.7;

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
  runnerCode,
  socialQrUrl,
  dirty = false,
  draft = false,
}: BibPreviewProps) {
  const trimmedName = name.trim();
  const hasName = trimmedName.length > 0;

  // Tear-off stub QR value: encode the runner's real social-QR URL when we have
  // it, else fall back to the runner code. A missing hash must NEVER blank a stub
  // (SC34.8) — the fallback keeps every stub scannable.
  const stubQrValue = socialQrUrl || runnerCode;

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
        {/* DEF CON smiley badge — the processed sticker image (Kurt 2026-07-03).
            Same round badge for the corner marks and the tear-off stubs. */}
        <symbol id="smiley-circle" viewBox="0 0 100 100">
          <image href={DC34_SMILEY_DATA_URI} x="0" y="0" width="100" height="100" />
        </symbol>
        <symbol id="smiley-square" viewBox="0 0 100 100">
          <image href={DC34_SMILEY_DATA_URI} x="0" y="0" width="100" height="100" />
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
        Small green (DC34 mint palette #6CCDB8) circle with a white star, rendered in the top-right
        corner of the card when the participant has any contribution
        (bib.paidAmount > 0). Kept inside the card border so it doesn't
        overlap the pin holes; z-order after the card rect so it renders
        on top.
      */}
      {/* Sponsor "PAID! THANK YOU!" stamp is rendered LAST (below) so it sits
          on top of the number box instead of being painted over. */}

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

      {/* Tear-off stub QR on each stub — encodes the runner's social-QR URL
        * (`/r?h=<hash>`) when available, else falls back to the runner code so a
        * stub is always scannable (SC34.8). Enlarged 76 → 112 SVG user-units and
        * repositioned to sit fully inside each stub between the corner smiley
        * (left ends x=116 / right ends x=576) and the number box (left starts
        * x=360 / right starts x=820), clear of the card's bottom border (y=696).
        * (Plan 34-04, Slice C — C-T4.) */}
      {stubQrValue && <QrBadge value={stubQrValue} x={182} y={582} size={112} />}
      {stubQrValue && <QrBadge value={stubQrValue} x={642} y={582} size={112} />}

      {/* Rubber stamp on the number box's top-right. Priority (Plan 34-03,
          SC34.5): a DIRTY (unsaved) name shows the red-orange UNSAVED stamp and
          SUPPRESSES the PAID stamp — an unsaved name must never read as a
          committed, paid bib. Only when the name is clean does the green
          "PAID! THANK YOU!" charm (Kurt 2026-07-03) show for sponsors. */}
      {dirty ? (
        <g
          id="unsaved-charm"
          role="img"
          aria-label="Unsaved name"
          data-testid="unsaved-charm"
          transform="rotate(-11 806 208)"
        >
          <rect
            x="712"
            y="176"
            width="188"
            height="64"
            rx="10"
            fill="#C2410C"
            stroke="#ffe9df"
            strokeWidth="3"
          />
          <text
            x="806"
            y="212"
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="30"
            fontWeight="900"
            fill="#fff"
            letterSpacing="2"
          >
            UNSAVED
          </text>
        </g>
      ) : draft ? (
        // Uncommitted free bib (Kurt 2026-07-05): white-on-black DRAFT stamp.
        // Cleared once the runner pledges in person / donates / sponsors.
        <g
          id="draft-charm"
          role="img"
          aria-label="Draft — not yet finalized"
          data-testid="draft-charm"
          transform="rotate(-11 806 208)"
        >
          <rect
            x="712"
            y="176"
            width="188"
            height="64"
            rx="10"
            fill="#0a0a0a"
            stroke="#ffffff"
            strokeWidth="3"
          />
          <text
            x="806"
            y="212"
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="30"
            fontWeight="900"
            fill="#fff"
            letterSpacing="4"
          >
            DRAFT
          </text>
        </g>
      ) : (
        hasSponsored && (
          <g
            id="sponsor-charm"
            role="img"
            aria-label="Paid — thank you"
            data-testid="sponsor-charm"
            transform="rotate(-11 806 208)"
          >
            <rect
              x="712"
              y="176"
              width="188"
              height="64"
              rx="10"
              fill="#3a8f79"
              stroke="#eafff8"
              strokeWidth="3"
            />
            <text
              x="806"
              y="203"
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="30"
              fontWeight="900"
              fill="#fff"
              letterSpacing="1"
            >
              PAID!
            </text>
            <text
              x="806"
              y="226"
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="13"
              fontWeight="700"
              fill="#eafff8"
              letterSpacing="2"
            >
              THANK YOU!
            </text>
          </g>
        )
      )}
    </svg>
  );
}

/**
 * Render a runner-code QR as crisp SVG rects (vector — stays sharp in print).
 * White quiet-zone background + black modules. Returns null if encoding fails.
 */
function QrBadge({
  value,
  x,
  y,
  size,
}: {
  value: string;
  x: number;
  y: number;
  size: number;
}) {
  let modules: { size: number; data: Uint8Array };
  try {
    const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
    modules = qr.modules as unknown as { size: number; data: Uint8Array };
  } catch {
    return null;
  }
  const n = modules.size;
  const quiet = 2;
  const cell = size / (n + quiet * 2);
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (modules.data[r * n + c]) {
        cells.push(
          <rect
            key={`${r}-${c}`}
            x={x + (c + quiet) * cell}
            y={y + (r + quiet) * cell}
            width={cell}
            height={cell}
            fill="#000"
          />
        );
      }
    }
  }
  return (
    <g role="img" aria-label={`Runner code QR: ${value}`}>
      <rect x={x} y={y} width={size} height={size} rx={4} fill="#fff" />
      {cells}
    </g>
  );
}

export default BibPreview;
