import { escapeHtml } from './escape-html';
import { qrSvg } from './shuttle-qr';
import { boardFor, type ShuttleFace } from './shuttle-svg';

/**
 * The shuttle popup: a BSidesLV "ground transport" ticket.
 *
 * The conceit comes from their own material. Their 2026 banner reads "The
 * Tuscany, Las Vegas (Earth)" — they disambiguate the planet, so the ticket's
 * destination field is where that gag lands. The fine print is real too: "VOID
 * 30 MINUTES AFTER LAST TELEMETRY" is literally the staleness threshold the
 * layer uses to dim a bus.
 *
 * The stub carries a QR to r.defcon.run (see shuttle-qr.ts). It is labelled as a
 * service advisory because a transit ticket promising live route status is
 * something people actually scan.
 *
 * Pure string builder — no DOM, no map. The layer owns mounting and the
 * "About the shuttles" hand-off to the egg modal.
 */

export type TicketData = {
    name: string;
    colorHex: string;
    color: string;
    kmh: number;
    hdg: number;
    lastFixMs: number | null;
    face: ShuttleFace;
    /** Ticket number shown top-right; stable per bus so it doesn't flicker. */
    seq: number;
};

/** Coarse "11h ago" phrasing. Popups are read at a glance, not audited. */
export function ago(ms: number): string {
    const mins = Math.floor(ms / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

/** Full board text for the ticket — the glyph uses the abbreviated form. */
export function ticketBoard(face: ShuttleFace): string {
    switch (face) {
        case 'moving': return 'BREAKING GROUND';
        case 'parked': return 'COMMON GROUND';
        case 'sleeping': return 'UNDERGROUND';
        case 'nofix': return 'GROUND TRUTH: ???';
    }
}

export function ticketHtml(d: TicketData): string {
    const esc = escapeHtml;
    const stale = d.face === 'sleeping' || d.face === 'nofix';
    const moving = d.face === 'moving';
    const seen = d.lastFixMs === null ? 'no fix reported' : ago(Date.now() - d.lastFixMs);
    // "Inbound for" while it is actually moving; "standing at" when parked. The
    // fleet lives in the Tuscany lot, which is also where BSidesLV itself is.
    const destLabel = moving ? 'INBOUND FOR' : 'STANDING AT';

    const rows: [string, string][] = [
        ['OPERATOR', d.name],
        ['LIVERY', d.color],
        ['GROUND SPEED', `${Math.round(d.kmh)} km/h`],
        ['BEARING', `${String(Math.round(d.hdg)).padStart(3, '0')}°`],
        ['LAST TELEMETRY', seen],
    ];
    const fields = rows
        .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
        .join('');

    return (
        `<div class="dc34-ticket${stale ? ' dc34-ticket-void' : ''}">` +
        (stale ? '<div class="dc34-ticket-stamp">STALE</div>' : '') +
        '<div class="dc34-ticket-main">' +
        '<div class="dc34-ticket-hd"><span class="dc34-ticket-who">GROUND TRANSPORT</span>' +
        `<span class="dc34-ticket-no">Nº ${esc(String(d.seq).padStart(2, '0'))}</span></div>` +
        '<div class="dc34-ticket-issuer">BSIDES LAS VEGAS · ISSUED BY DEF CON RUN 34</div>' +
        '<div class="dc34-ticket-roller"><small>DESTINATION BOARD</small>' +
        `${esc(ticketBoard(d.face))}</div>` +
        `<dl class="dc34-ticket-fields">${fields}</dl>` +
        `<div class="dc34-ticket-dest"><span class="dc34-ticket-lbl">${destLabel}</span>` +
        'The Tuscany, Las Vegas <span class="dc34-ticket-planet">(Earth)</span></div>' +
        '<div class="dc34-ticket-fine">VOID 30 MINUTES AFTER LAST TELEMETRY · ' +
        'NOT VALID FOR INTERPLANETARY TRAVEL</div>' +
        '<button type="button" class="dc34-ticket-more" data-dc34-shuttle-egg>' +
        'About the shuttles →</button>' +
        '</div>' +
        '<div class="dc34-ticket-stub">' +
        '<div class="dc34-ticket-stubhd">SERVICE<br>ADVISORY</div>' +
        qrSvg() +
        '<div class="dc34-ticket-stubcap">SCAN FOR LIVE<br>ROUTE STATUS</div>' +
        '<div class="dc34-ticket-stubno">SEC. 34 · ROW R</div>' +
        '</div></div>'
    );
}

/** Kept exported so the layer and the tests agree on the abbreviation source. */
export { boardFor };
