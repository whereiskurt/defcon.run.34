/**
 * The ticket stub's QR code.
 *
 * It encodes `HTTPS://R.DEFCON.RUN` — the Run Hacker Run! splash, which fronts
 * the rickroll. The stub is labelled as a service advisory, because the troll
 * only works if the promise sounds worth scanning.
 *
 * WHY A HARDCODED PATH AND NOT A QR LIBRARY. The URL is a constant, so the code
 * is a constant. Generating it at runtime would mean shipping an encoder into
 * the bundle to recompute the same 625 modules on every popup.
 *
 * HOW IT WAS MADE (repeat this if the URL ever changes — do NOT hand-edit):
 *   Alphanumeric mode, error correction level H. The URL is 20 characters and
 *   every one of them is in the alphanumeric charset (0-9 A-Z $%*+-./:), which
 *   lands it in version 2 — a 25x25 grid, the chunkiest that fits, which is what
 *   keeps it scannable at ~96px on a phone screen. Uppercase is safe: scheme and
 *   host are case-insensitive and there is no path.
 *
 *     python -c "import qrcode; q=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H,
 *                box_size=1, border=0); q.add_data('HTTPS://R.DEFCON.RUN'); q.make(fit=True); ..."
 *
 *   The emitted path below was then rendered back to a bitmap and decoded with
 *   OpenCV's QRCodeDetector to confirm it resolves to the URL — verified by
 *   decode, not by trusting the encoder. `shuttle-qr.test.ts` pins the module
 *   count and the finder-pattern corners so a mangled edit fails loudly.
 */

/** Grid size in modules. Version 2 => 25x25. */
export const QR_MODULES = 25;

/** The URL the stub resolves to. */
export const QR_TARGET = 'HTTPS://R.DEFCON.RUN';

/**
 * Dark modules as one SVG path, horizontally run-length merged. Coordinates are
 * module units, so the consumer sets `viewBox="-1 -1 27 27"` for a 1-module
 * quiet zone.
 */
export const QR_PATH =
    'M0 0h7v1h-7zM8 0h6v1h-6zM15 0h2v1h-2zM18 0h7v1h-7zM0 1h1v1h-1zM6 1h1v1h-1zM10 1h4v1h-4zM16 1h1v1h-1zM18 1h1v1h-1zM24 1h1v1h-1zM0 2h1v1h-1zM2 2h3v1h-3zM6 2h1v1h-1zM8 2h3v1h-3zM12 2h1v1h-1zM14 2h1v1h-1zM18 2h1v1h-1zM20 2h3v1h-3zM24 2h1v1h-1zM0 3h1v1h-1zM2 3h3v1h-3zM6 3h1v1h-1zM9 3h2v1h-2zM12 3h1v1h-1zM16 3h1v1h-1zM18 3h1v1h-1zM20 3h3v1h-3zM24 3h1v1h-1zM0 4h1v1h-1zM2 4h3v1h-3zM6 4h1v1h-1zM8 4h1v1h-1zM12 4h1v1h-1zM18 4h1v1h-1zM20 4h3v1h-3zM24 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM9 5h2v1h-2zM15 5h2v1h-2zM18 5h1v1h-1zM24 5h1v1h-1zM0 6h7v1h-7zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h1v1h-1zM16 6h1v1h-1zM18 6h7v1h-7zM8 7h4v1h-4zM13 7h2v1h-2zM16 7h1v1h-1zM5 8h2v1h-2zM9 8h1v1h-1zM11 8h2v1h-2zM14 8h3v1h-3zM18 8h1v1h-1zM20 8h1v1h-1zM22 8h1v1h-1zM24 8h1v1h-1zM0 9h1v1h-1zM4 9h2v1h-2zM7 9h1v1h-1zM9 9h1v1h-1zM14 9h1v1h-1zM16 9h2v1h-2zM21 9h2v1h-2zM0 10h1v1h-1zM2 10h3v1h-3zM6 10h3v1h-3zM11 10h1v1h-1zM13 10h5v1h-5zM20 10h1v1h-1zM23 10h2v1h-2zM0 11h1v1h-1zM3 11h1v1h-1zM5 11h1v1h-1zM8 11h1v1h-1zM10 11h1v1h-1zM13 11h2v1h-2zM20 11h2v1h-2zM3 12h1v1h-1zM5 12h2v1h-2zM8 12h1v1h-1zM11 12h2v1h-2zM14 12h6v1h-6zM21 12h3v1h-3zM0 13h1v1h-1zM2 13h1v1h-1zM5 13h1v1h-1zM7 13h1v1h-1zM9 13h1v1h-1zM11 13h3v1h-3zM19 13h3v1h-3zM0 14h1v1h-1zM2 14h5v1h-5zM10 14h1v1h-1zM13 14h3v1h-3zM17 14h2v1h-2zM20 14h3v1h-3zM0 15h1v1h-1zM4 15h1v1h-1zM7 15h1v1h-1zM9 15h1v1h-1zM14 15h4v1h-4zM22 15h3v1h-3zM0 16h1v1h-1zM4 16h1v1h-1zM6 16h1v1h-1zM8 16h2v1h-2zM11 16h4v1h-4zM16 16h5v1h-5zM22 16h1v1h-1zM24 16h1v1h-1zM8 17h2v1h-2zM11 17h1v1h-1zM13 17h4v1h-4zM20 17h4v1h-4zM0 18h7v1h-7zM9 18h2v1h-2zM16 18h1v1h-1zM18 18h1v1h-1zM20 18h1v1h-1zM22 18h3v1h-3zM0 19h1v1h-1zM6 19h1v1h-1zM8 19h1v1h-1zM10 19h1v1h-1zM12 19h1v1h-1zM14 19h1v1h-1zM16 19h1v1h-1zM20 19h3v1h-3zM0 20h1v1h-1zM2 20h3v1h-3zM6 20h1v1h-1zM9 20h1v1h-1zM13 20h2v1h-2zM16 20h5v1h-5zM0 21h1v1h-1zM2 21h3v1h-3zM6 21h1v1h-1zM10 21h4v1h-4zM17 21h1v1h-1zM20 21h3v1h-3zM24 21h1v1h-1zM0 22h1v1h-1zM2 22h3v1h-3zM6 22h1v1h-1zM9 22h2v1h-2zM12 22h1v1h-1zM15 22h3v1h-3zM19 22h1v1h-1zM21 22h1v1h-1zM24 22h1v1h-1zM0 23h1v1h-1zM6 23h1v1h-1zM10 23h1v1h-1zM12 23h4v1h-4zM17 23h3v1h-3zM21 23h2v1h-2zM0 24h7v1h-7zM11 24h1v1h-1zM14 24h1v1h-1zM19 24h1v1h-1zM21 24h1v1h-1zM23 24h2v1h-2z';

/** The stub's QR as inline SVG, with a one-module quiet zone. */
export function qrSvg(): string {
    return (
        `<svg class="dc34-shuttle-qr" viewBox="-1 -1 ${QR_MODULES + 2} ${QR_MODULES + 2}"` +
        ' xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"' +
        ' role="img" aria-label="Scan for live route status">' +
        `<rect x="-1" y="-1" width="${QR_MODULES + 2}" height="${QR_MODULES + 2}" fill="#fff"/>` +
        `<path fill="#1A1610" d="${QR_PATH}"/></svg>`
    );
}
