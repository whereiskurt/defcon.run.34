/**
 * Cartoon bus art for the B-Sides shuttle layer.
 *
 * WHY SIDE-VIEW AND NOT TOP-DOWN. The first cut drew the bus from above so it
 * could rotate to the feed's true compass bearing. At map scale that silhouette
 * is a rounded rectangle with no room for a face — Kurt's word was "boring", and
 * he was right: a bus seen from the roof cannot have an expression. Going
 * side-on trades exact rotation for a character. The bearing is not lost, it
 * moves onto the ticket, and the glyph instead flips left/right the way a
 * platformer sprite does. For a fleet that is parked ~99% of the year, a precise
 * parked heading was noise anyway.
 *
 * WHY THE ROOF BOARD. Every BSidesLV track is a "Ground" pun — Breaking Ground,
 * Common Ground, Ground Truth — and a shuttle is the one piece of con
 * infrastructure that is literally ground transport. So the destination roller
 * doubles as the status readout: the joke and the state are the same glyph.
 * See `boardFor()`.
 *
 * The vendor ships its own sprite PNGs (`pink-bus/pink-bus-345.png`); we don't
 * hotlink them. They'd be a cross-origin request per livery, pinned to the
 * vendor's asset hosting and locked to 24 heading steps.
 */

/** Which face the bus is wearing. Mirrors the feed states the proxy reports. */
export type ShuttleFace = 'moving' | 'parked' | 'sleeping' | 'nofix';

/**
 * Destination board text per state. Each is a real BSidesLV track reference that
 * also happens to describe the state accurately — that coincidence is the whole
 * joke, so keep the pairing if you add a state.
 *
 * Kept short: the board is ~52 units wide in the viewBox and longer strings
 * overrun it rather than shrinking.
 */
export function boardFor(face: ShuttleFace): string {
    switch (face) {
        case 'moving': return 'BREAKING GRD';
        case 'parked': return 'COMMON GRD';
        case 'sleeping': return 'UNDERGROUND';
        case 'nofix': return 'GRD TRUTH ?';
    }
}

/** Eyes + mouth per state. Sleeping gets closed lids; nofix gets a shrug. */
function faceArt(face: ShuttleFace): string {
    if (face === 'nofix') {
        // Outlined, not flat grey: a dark glyph on the powered-down grey-blue
        // glass was invisible at map size.
        return (
            '<text x="104" y="43" font-family="ui-rounded,system-ui,sans-serif" font-size="26"' +
            ' font-weight="800" fill="#F4EDDF" stroke="#1A1610" stroke-width="2.4"' +
            ' paint-order="stroke" text-anchor="middle">?</text>'
        );
    }
    if (face === 'sleeping') {
        // Lids down and a small contented mouth. The "z z" is drawn by the
        // caller, outside the flipping group, so it never renders mirrored.
        return (
            '<path d="M99 33 q4 3.4 8 0" stroke="#1A1610" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
            '<path d="M101 48 q6 -3 11 0" stroke="#1A1610" stroke-width="2.2" fill="none" stroke-linecap="round"/>'
        );
    }
    // Open eye. Moving looks ahead (pupil forward) and grins; parked looks level.
    const pupilX = face === 'moving' ? 104.8 : 103;
    const mouth =
        face === 'moving'
            ? '<path d="M100 47 q7 4 13 1" stroke="#1A1610" stroke-width="2.2" fill="none" stroke-linecap="round"/>'
            : '<path d="M101 48 h11" stroke="#1A1610" stroke-width="2.2" stroke-linecap="round"/>';
    return (
        '<circle cx="103" cy="33" r="4.6" fill="#fff" stroke="#1A1610" stroke-width="1.7"/>' +
        `<circle cx="${pupilX}" cy="33.5" r="2.2" fill="#1A1610"/>` +
        mouth
    );
}

/**
 * The bus, drawn nose-RIGHT. Callers flip it with a CSS transform rather than
 * re-rendering, so a heading change is a class toggle, not a repaint.
 *
 * `bodyHex` is the livery the proxy parsed out of the vendor icon path.
 */
export function shuttleSvg(bodyHex: string, face: ShuttleFace): string {
    // Glass goes grey-blue when the bus is asleep — the whole vehicle should read
    // as powered down, not just dimmed by opacity.
    const glass = face === 'sleeping' || face === 'nofix' ? '#6E8494' : '#8FC7E8';
    const speedLines =
        face === 'moving'
            ? '<g stroke="#F0E7D6" stroke-width="3" stroke-linecap="round" opacity=".8"' +
              ' stroke-dasharray="9 5" class="dc34-shuttle-dash">' +
              '<path d="M0 32 h16"/><path d="M0 45 h22"/><path d="M0 58 h13"/></g>'
            : '';

    // EVERYTHING THAT MAY BE MIRRORED lives in `.dc34-shuttle-body`. A westbound
    // bus is flipped with a CSS scaleX(-1) on that group alone — if the roof
    // board or the "z z" were inside it, their text would render backwards.
    // The board is centred on the viewBox (x=38, w=52 => centre 64) precisely so
    // it can sit outside the flip and still line up with the roof either way.
    return `<svg viewBox="0 0 128 92" xmlns="http://www.w3.org/2000/svg" role="img">
  <g class="dc34-shuttle-body">
    <g stroke="#1A1610" stroke-width="3.2" stroke-linejoin="round">
      <rect x="6" y="20" width="112" height="45" rx="13" fill="${bodyHex}"/>
      <path d="M97 24 q15 2 15 15 v6 h-15 z" fill="${glass}"/>
      <rect x="18" y="28" width="20" height="15" rx="3.5" fill="${glass}"/>
      <rect x="44" y="28" width="20" height="15" rx="3.5" fill="${glass}"/>
      <rect x="70" y="28" width="20" height="15" rx="3.5" fill="${glass}"/>
      <circle cx="34" cy="66" r="11" fill="#211E19"/>
      <circle cx="94" cy="66" r="11" fill="#211E19"/>
    </g>
    <circle cx="34" cy="66" r="3.6" fill="#8A8172"/>
    <circle cx="94" cy="66" r="3.6" fill="#8A8172"/>
    ${face === 'moving' || face === 'parked'
        ? '<circle cx="114" cy="56" r="3.6" fill="#FDE68A" stroke="#1A1610" stroke-width="1.8"/>'
        : ''}
    ${faceArt(face)}
    ${speedLines}
  </g>
  <rect x="38" y="8" width="52" height="13" rx="3.5" fill="#14120E"
        stroke="#1A1610" stroke-width="3.2" stroke-linejoin="round"/>
  <text x="64" y="18.5" font-family="ui-monospace,Menlo,monospace" font-size="8.5"
        fill="#DFA83C" text-anchor="middle" letter-spacing="1.1">${boardFor(face)}</text>
  ${face === 'sleeping'
      ? '<g class="dc34-shuttle-zzz" fill="#F0E7D6" stroke="#1A1610" stroke-width="1.6"' +
        ' paint-order="stroke" font-family="ui-rounded,system-ui,sans-serif"' +
        ' font-weight="700"><text x="96" y="26" font-size="15">z</text>' +
        '<text x="109" y="15" font-size="10">z</text></g>'
      : ''}
</svg>`;
}
