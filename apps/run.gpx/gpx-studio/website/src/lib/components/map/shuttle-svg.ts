/**
 * Bus glyph for the B-Sides shuttle layer.
 *
 * The upstream feed points at the vendor's own sprite PNGs
 * (`pink-bus/pink-bus-345.png`, where 345 is the heading snapped to 15°). We
 * don't hotlink those: it would be a cross-origin request per bus per livery,
 * pinned to their asset hosting, and locked to 24 heading steps. Instead we draw
 * one bus and tint it with the livery hex the proxy hands us, then spin it with
 * `icon-rotate` for smooth heading at any angle.
 *
 * Drawn nose-up (heading 0 = north) so `icon-rotate: ['get','hdg']` lines up
 * with the feed's compass bearing without an offset.
 */
export function shuttleSvg(bodyHex: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <g>
    <!-- drop shadow so the bus reads against both light and dark basemaps -->
    <rect x="17" y="7" width="30" height="52" rx="9" fill="#000" opacity="0.28"/>
    <!-- body -->
    <rect x="16" y="5" width="30" height="52" rx="9" fill="${bodyHex}" stroke="#10131a" stroke-width="2.5"/>
    <!-- windscreen (nose end, so the direction of travel is readable) -->
    <path d="M20 13 q11 -5 22 0 v7 q-11 -4 -22 0 z" fill="#0f172a" opacity="0.82"/>
    <!-- side windows -->
    <rect x="19" y="25" width="24" height="8" rx="2" fill="#0f172a" opacity="0.55"/>
    <rect x="19" y="36" width="24" height="8" rx="2" fill="#0f172a" opacity="0.55"/>
    <!-- headlights -->
    <circle cx="22" cy="9.5" r="2.1" fill="#fde68a"/>
    <circle cx="40" cy="9.5" r="2.1" fill="#fde68a"/>
    <!-- tail lights -->
    <circle cx="22" cy="53" r="1.9" fill="#ef4444"/>
    <circle cx="40" cy="53" r="1.9" fill="#ef4444"/>
  </g>
</svg>`;
}
