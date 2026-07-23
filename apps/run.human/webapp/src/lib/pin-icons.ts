/**
 * Check-in pin icon catalog (v1.8 Phase 4).
 *
 * Curated, parameterized SVG pins: the runner picks an icon + a color; the
 * glyph rides inside the branded map-pin silhouette. Entries with
 * `requiredService` are SECRET — the picker only shows them (and the server
 * only accepts them) when the session's services include that tag. Entries
 * with `fixedColor` ignore the runner's color (the gold star stays gold).
 *
 * MIRRORED in the gpx-studio build at
 * `apps/run.gpx/gpx-studio/website/src/lib/dc34-pins.ts` (separate Vite build,
 * cannot import this module) — keep ids and SVG output in sync.
 *
 * Designed to later support unlock codes: validation is services-based today;
 * an `unlockedPins: string[]` on RunUser can be OR'd in without schema changes.
 */

export type PinIconDef = {
  id: string;
  label: string;
  /** Secret pin: only selectable when session services include this tag. */
  requiredService?: string;
  /** Renders in this color regardless of the runner's pick (e.g. gold). */
  fixedColor?: string;
  glyph: string;
};

export const DEFAULT_PIN_ICON = "bunny";
export const DEFAULT_PIN_COLOR = "#e6007a"; // DC34 magenta - matches the Phase 3 pin

const W = 'fill="white"';

export const PIN_ICONS: readonly PinIconDef[] = [
  {
    id: "bunny",
    label: "Bunny",
    glyph: `<ellipse cx="10.2" cy="7" rx="1.2" ry="2.8" ${W}/><ellipse cx="13.8" cy="7" rx="1.2" ry="2.8" ${W}/><circle cx="12" cy="11" r="2.9" ${W}/>`,
  },
  {
    id: "star",
    label: "Star",
    glyph: `<path d="M12 4.8l1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.8 4-.6z" ${W}/>`,
  },
  {
    id: "flag",
    label: "Flag",
    glyph: `<path d="M9 4.5v11.5" stroke="white" stroke-width="1.6" stroke-linecap="round"/><path d="M9.8 5h5.7l-1.8 2.6 1.8 2.6H9.8z" ${W}/>`,
  },
  {
    id: "skull",
    label: "Skull",
    glyph: `<circle cx="12" cy="9.3" r="3.4" ${W}/><rect x="10.3" y="12" width="3.4" height="2.4" rx="1" ${W}/><circle cx="10.7" cy="9.1" r="1" fill="black" opacity="0.75"/><circle cx="13.3" cy="9.1" r="1" fill="black" opacity="0.75"/>`,
  },
  {
    id: "paw",
    label: "Paw",
    glyph: `<circle cx="12" cy="11.6" r="2" ${W}/><circle cx="9.2" cy="9.2" r="1.15" ${W}/><circle cx="12" cy="7.9" r="1.15" ${W}/><circle cx="14.8" cy="9.2" r="1.15" ${W}/>`,
  },
  {
    id: "bolt",
    label: "Lightning",
    glyph: `<path d="M13 4.5L8.6 11h2.9l-1.3 5.5 4.6-6.7h-2.9z" ${W}/>`,
  },
  {
    id: "diamond",
    label: "Diamond",
    glyph: `<path d="M12 4.8l3.9 4.3L12 15.6 8.1 9.1z" ${W}/>`,
  },
  {
    id: "crown",
    label: "Crown",
    glyph: `<path d="M8.2 13l-.9-5.2 2.7 2 2-3.4 2 3.4 2.7-2-.9 5.2z" ${W}/>`,
  },
  {
    // SECRET — the "gold star this event" pin (Kurt/Jesse). Gated on the
    // `admin` service today; grant a broader tag in run.auth to widen it.
    id: "goldstar",
    label: "Gold Star",
    requiredService: "admin",
    fixedColor: "#ffd700",
    glyph: `<path d="M12 3.8l2.1 4.2 4.6.7-3.3 3.2.8 4.6-4.2-2.2-4.2 2.2.8-4.6-3.3-3.2 4.6-.7z" ${W} stroke="#8a6d00" stroke-width="0.6"/>`,
  },
];

/** The branded map-pin silhouette with a glyph inside (lucide MapPin path). */
export function pinSvg(icon: PinIconDef, color: string): string {
  const body = icon.fixedColor ?? color;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"
          fill="${body}" stroke="#00d4aa" stroke-width="1.2"/>
    ${icon.glyph}
  </svg>`;
}

export function pinIconById(id: string | undefined): PinIconDef | undefined {
  return PIN_ICONS.find((i) => i.id === id);
}

export function isValidPinColor(color: unknown): color is string {
  return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color);
}

export function canUsePinIcon(icon: PinIconDef, services: string[]): boolean {
  return !icon.requiredService || services.includes(icon.requiredService);
}

/** Icons this session may pick (secret ones only with the gating service). */
export function allowedPinIcons(services: string[]): PinIconDef[] {
  return PIN_ICONS.filter((i) => canUsePinIcon(i, services));
}

/**
 * Resolve the pin to stamp on a new check-in (pure; unit-tested).
 * Request values win over profile prefs; anything invalid or not permitted
 * falls back; a fully-default pin stays undefined (default rendering).
 */
export function resolveCheckInPin(
  requested: { pinIcon?: unknown; pinColor?: unknown },
  prefs: { pinIcon?: string; pinColor?: string } | undefined,
  services: string[]
): { pinIcon?: string; pinColor?: string } {
  const pick = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const icon = pinIconById(value);
    return icon && canUsePinIcon(icon, services) ? icon.id : undefined;
  };
  const pinIcon = pick(requested.pinIcon) ?? pick(prefs?.pinIcon);
  const requestedColor = isValidPinColor(requested.pinColor)
    ? requested.pinColor
    : undefined;
  const prefColor = isValidPinColor(prefs?.pinColor) ? prefs?.pinColor : undefined;
  const pinColor = requestedColor ?? prefColor;
  return { pinIcon, pinColor };
}
