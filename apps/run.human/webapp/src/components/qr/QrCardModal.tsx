'use client';

import { useEffect, useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, Button,
} from '@heroui/react';
import { Smartphone, Share2 } from 'lucide-react';
import { buildQrPayload } from './buildQrPayload';
import { renderStyledQr } from './renderStyledQr';
import {
  composeWallpaperSvg, composeShareCardSvg, WALLPAPER, SHARECARD,
  type CardCopy, type CardArgs,
} from './composeCards';
import { downloadCardPng, assetAsDataUri } from './downloadCardPng';
import { getApiBasePath } from '@/lib/api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  hash: string;
  name: string;
  bib: string | null;
  copy: CardCopy & { optionWallpaper: string; optionShare: string };
}

const svgUri = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export default function QrCardModal({ isOpen, onClose, hash, name, bib, copy }: Props) {
  const [busy, setBusy] = useState<'wallpaper' | 'share' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Composed once per open: previews ARE the exact SVGs the download rasterizes.
  const [cards, setCards] = useState<{
    args: CardArgs; wallpaper: string; share: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const qrSvg = renderStyledQr(buildQrPayload(hash));
        const bunnyDataUri = await assetAsDataUri(
          `${getApiBasePath()}/header/bunny-head-alpha.png`,
        );
        const args = { qrSvg, name, bib, bunnyDataUri, copy };
        if (cancelled) return;
        setCards({
          args,
          wallpaper: svgUri(composeWallpaperSvg(args)),
          share: svgUri(composeShareCardSvg(args)),
        });
      } catch (e) {
        console.error('QR card preview failed:', e);
        if (!cancelled) setError('Preview failed - check your connection and reopen.');
      }
    })();
    return () => { cancelled = true; };
    // copy is rebuilt per render upstream; its values only change with CMS deploys
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, hash, name, bib]);

  const save = async (kind: 'wallpaper' | 'share') => {
    if (!cards) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'wallpaper') {
        await downloadCardPng(
          composeWallpaperSvg(cards.args), WALLPAPER.w, WALLPAPER.h, 'defcon-run-qr-wallpaper.png',
        );
      } else {
        await downloadCardPng(
          composeShareCardSvg(cards.args), SHARECARD.w, SHARECARD.h, 'defcon-run-qr-card.png',
        );
      }
      onClose();
    } catch (e) {
      console.error('QR card download failed:', e);
      setError('Download failed - try again or screenshot the QR above.');
    } finally {
      setBusy(null);
    }
  };

  const previewBox = 'rounded-lg overflow-hidden bg-content2 flex items-center justify-center';
  const skeleton = <div className="w-full h-full animate-pulse bg-content3" />;

  return (
    <Modal isOpen={isOpen} onClose={onClose} placement="center" size="lg">
      <ModalContent>
        <ModalHeader className="font-museo">Save QR card</ModalHeader>
        <ModalBody className="pb-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col items-center gap-2">
              <div className={`${previewBox} h-56 aspect-[9/16]`}>
                {cards ? (
                  <img src={cards.wallpaper} alt="Wallpaper preview" className="h-full w-auto" />
                ) : skeleton}
              </div>
              <Button
                color="primary" variant="flat" size="sm" fullWidth
                startContent={<Smartphone className="w-4 h-4" />}
                isLoading={busy === 'wallpaper'} isDisabled={busy !== null || !cards}
                onPress={() => save('wallpaper')}
              >
                {copy.optionWallpaper}
              </Button>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className={`${previewBox} h-56 aspect-square max-w-full`}>
                {cards ? (
                  <img src={cards.share} alt="Share card preview" className="max-h-full max-w-full" />
                ) : skeleton}
              </div>
              <Button
                color="secondary" variant="flat" size="sm" fullWidth
                startContent={<Share2 className="w-4 h-4" />}
                isLoading={busy === 'share'} isDisabled={busy !== null || !cards}
                onPress={() => save('share')}
              >
                {copy.optionShare}
              </Button>
            </div>
          </div>
          {error && <p className="text-tiny text-danger">{error}</p>}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
