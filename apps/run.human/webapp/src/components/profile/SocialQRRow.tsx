'use client';

/**
 * SocialQRRow — the QR tile row on the right of the whoami identity card.
 * Up to three tiles (Strava Group, Signal Group, Runner), each a scannable QR
 * with a small label. Strava/Signal are tap-to-open links whose QR is generated
 * in-browser from the CMS URL; Runner is the pre-generated `eqr` (display-only).
 *
 * Presence/order live in the pure `buildTiles` helper (unit-tested). This file
 * owns only the async QR encode + presentation.
 */

import { useEffect, useState } from 'react';
import * as qr from 'qrcode';
import { SiStrava, SiSignal } from 'react-icons/si';
import { Footprints } from 'lucide-react';
import { buildTiles, type SocialQRRowProps, type Tile } from './buildTiles';

const QR_PX = 84;

const labelMeta: Record<string, { Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color?: string }> = {
  Strava: { Icon: SiStrava, color: '#FC4C02' },
  Signal: { Icon: SiSignal, color: '#3A76F0' },
  Runner: { Icon: Footprints },
};

function QrImage({ src, alt, borderColor }: { src: string; alt: string; borderColor?: string }) {
  return (
    <div
      className="bg-white p-1.5 rounded-lg shadow-sm border-2"
      style={{ borderColor: borderColor ?? 'transparent' }}
    >
      <img src={src} alt={alt} width={QR_PX} height={QR_PX} style={{ width: QR_PX, height: QR_PX }} />
    </div>
  );
}

function QrPlaceholder() {
  return (
    <div className="bg-white p-1.5 rounded-lg shadow-sm border-2 border-transparent">
      <div className="rounded bg-content2 animate-pulse" style={{ width: QR_PX, height: QR_PX }} />
    </div>
  );
}

function TileLabel({ label }: { label: string }) {
  const meta = labelMeta[label];
  const Icon = meta?.Icon;
  return (
    <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-default-400">
      {Icon && <Icon className="w-2.5 h-2.5" style={meta.color ? { color: meta.color } : undefined} />}
      {label}
    </span>
  );
}

export default function SocialQRRow(props: SocialQRRowProps) {
  const tiles = buildTiles(props);

  // url -> generated data-URL ('' means generation failed → link-chip fallback)
  const [generated, setGenerated] = useState<Record<string, string>>({});

  const linkUrls = tiles.filter((t): t is Extract<Tile, { kind: 'link' }> => t.kind === 'link').map((t) => t.url);
  const urlKey = linkUrls.join('|');

  useEffect(() => {
    let cancelled = false;
    linkUrls.forEach((url) => {
      qr.toDataURL(url, { errorCorrectionLevel: 'M', width: 220, margin: 1 })
        .then((dataUrl) => { if (!cancelled) setGenerated((g) => ({ ...g, [url]: dataUrl })); })
        .catch(() => { if (!cancelled) setGenerated((g) => ({ ...g, [url]: '' })); });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);

  if (tiles.length === 0) return null;

  return (
    <div className="flex flex-wrap items-start justify-center sm:justify-end gap-2.5 w-full sm:w-auto shrink-0">
      {tiles.map((tile) => {
        if (tile.kind === 'image') {
          return (
            <div key={tile.label} className="flex flex-col items-center gap-1">
              <QrImage src={tile.src} alt="Your runner QR code" />
              <TileLabel label={tile.label} />
            </div>
          );
        }

        const dataUrl = generated[tile.url];
        // Generation failed → keep the tile useful as a plain outbound link chip.
        if (dataUrl === '') {
          return (
            <a
              key={tile.label}
              href={tile.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center justify-center gap-1 rounded-lg border border-default-200 px-3 hover:border-primary transition-colors"
              style={{ height: QR_PX + 12, width: QR_PX + 12 }}
            >
              <TileLabel label={tile.label} />
              <span className="text-[10px] text-primary">Open ↗</span>
            </a>
          );
        }

        return (
          <a
            key={tile.label}
            href={tile.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${tile.label} group`}
            className="flex flex-col items-center gap-1 hover:opacity-80 transition-opacity"
          >
            {dataUrl ? <QrImage src={dataUrl} alt={`${tile.label} group QR code`} borderColor={labelMeta[tile.label]?.color} /> : <QrPlaceholder />}
            <TileLabel label={tile.label} />
          </a>
        );
      })}
    </div>
  );
}
