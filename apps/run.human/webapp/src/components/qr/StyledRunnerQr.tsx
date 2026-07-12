'use client';

import { useMemo } from 'react';
import { buildQrPayload } from './buildQrPayload';
import { renderStyledQr } from './renderStyledQr';

interface Props {
  hash?: string;
  eqrFallback?: string;
  className?: string;
  alt?: string;
}

/** Styled runner QR; falls back to the stored eqr PNG when hash is absent. */
export default function StyledRunnerQr({ hash, eqrFallback, className, alt }: Props) {
  const src = useMemo(() => {
    if (!hash) return eqrFallback ?? '';
    try {
      const svg = renderStyledQr(buildQrPayload(hash));
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    } catch {
      return eqrFallback ?? '';
    }
  }, [hash, eqrFallback]);

  if (!src) return null;
  return <img src={src} alt={alt ?? 'Your runner QR code'} className={className} />;
}
