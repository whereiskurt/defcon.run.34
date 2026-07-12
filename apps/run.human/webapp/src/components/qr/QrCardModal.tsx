'use client';

import { useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, Button,
} from '@heroui/react';
import { Smartphone, Share2 } from 'lucide-react';
import { buildQrPayload } from './buildQrPayload';
import { renderStyledQr } from './renderStyledQr';
import {
  composeWallpaperSvg, composeShareCardSvg, WALLPAPER, SHARECARD, type CardCopy,
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

export default function QrCardModal({ isOpen, onClose, hash, name, bib, copy }: Props) {
  const [busy, setBusy] = useState<'wallpaper' | 'share' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (kind: 'wallpaper' | 'share') => {
    setBusy(kind);
    setError(null);
    try {
      const qrSvg = renderStyledQr(buildQrPayload(hash));
      const bunnyDataUri = await assetAsDataUri(
        `${getApiBasePath()}/header/bunny-head-alpha.png`,
      );
      const args = { qrSvg, name, bib, bunnyDataUri, copy };
      if (kind === 'wallpaper') {
        await downloadCardPng(
          composeWallpaperSvg(args), WALLPAPER.w, WALLPAPER.h, 'defcon-run-qr-wallpaper.png',
        );
      } else {
        await downloadCardPng(
          composeShareCardSvg(args), SHARECARD.w, SHARECARD.h, 'defcon-run-qr-card.png',
        );
      }
      onClose();
    } catch (e) {
      console.error('QR card download failed:', e);
      setError('Download failed — try again or screenshot the QR above.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} placement="center">
      <ModalContent>
        <ModalHeader className="font-museo">Save QR card</ModalHeader>
        <ModalBody className="pb-6 space-y-3">
          <Button
            color="primary" variant="flat" size="lg"
            startContent={<Smartphone className="w-5 h-5" />}
            isLoading={busy === 'wallpaper'} isDisabled={busy !== null}
            onPress={() => save('wallpaper')}
          >
            {copy.optionWallpaper}
          </Button>
          <Button
            color="secondary" variant="flat" size="lg"
            startContent={<Share2 className="w-5 h-5" />}
            isLoading={busy === 'share'} isDisabled={busy !== null}
            onPress={() => save('share')}
          >
            {copy.optionShare}
          </Button>
          {error && <p className="text-tiny text-danger">{error}</p>}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
