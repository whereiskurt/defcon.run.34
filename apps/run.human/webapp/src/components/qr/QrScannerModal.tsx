'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, Button,
} from '@heroui/react';
import { ExternalLink, RotateCcw, X } from 'lucide-react';
import { parseRunnerQr, awardPathFor } from './parseRunnerQr';
import { getApiBasePath } from '@/lib/api';

export interface ScannerCopy {
  title: string;
  hint: string;
  miss: string;
  found: string;
  claim: string;
  again: string;
  unavailable: string;
  cancel: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  copy: ScannerCopy;
}

type Phase = 'requesting' | 'scanning' | 'found' | 'unavailable';

// Minimal shape of the (not-yet-in-lib.dom) native BarcodeDetector API.
interface NativeBarcodeDetector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
interface BarcodeDetectorCtor {
  new (opts: { formats: string[] }): NativeBarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

// Decode budget: ~8 fps is plenty for a QR held in frame and keeps phone CPUs
// cool; frames are downscaled to ≤640px on the long edge before decode.
const DECODE_INTERVAL_MS = 125;
const MAX_DECODE_EDGE = 640;
const MISS_FLASH_MS = 1500;

export default function QrScannerModal({ isOpen, onClose, copy }: Props) {
  const [phase, setPhase] = useState<Phase>('requesting');
  const [awardUrl, setAwardUrl] = useState<string | null>(null);
  const [showMiss, setShowMiss] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const lastDecodeRef = useRef(0);
  const decodingRef = useRef(false);
  const missTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Engine handles, resolved once per open: native BarcodeDetector when the
  // browser has one (Chrome/Android), else lazy-loaded jsQR (iPhone Safari —
  // the main real-world path at the con).
  const detectorRef = useRef<{ detect: (v: HTMLVideoElement) => Promise<string | null> } | null>(null);

  const stopStream = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const onDecoded = useCallback((text: string) => {
    const qr = parseRunnerQr(text);
    if (!qr) {
      setShowMiss(true);
      if (missTimerRef.current) clearTimeout(missTimerRef.current);
      missTimerRef.current = setTimeout(() => setShowMiss(false), MISS_FLASH_MS);
      return;
    }
    stopStream();
    setAwardUrl(awardPathFor(qr, getApiBasePath()));
    setPhase('found');
  }, [stopStream]);

  const decodeLoop = useCallback(() => {
    const tick = async () => {
      rafRef.current = requestAnimationFrame(tick);
      const video = videoRef.current;
      const detector = detectorRef.current;
      const now = performance.now();
      if (
        !video || !detector || decodingRef.current ||
        video.readyState < video.HAVE_ENOUGH_DATA ||
        now - lastDecodeRef.current < DECODE_INTERVAL_MS
      ) return;
      lastDecodeRef.current = now;
      decodingRef.current = true;
      try {
        const text = await detector.detect(video);
        if (text && streamRef.current) onDecoded(text);
      } catch {
        // Transient decode errors (e.g. detector on a stopped track) — keep looping.
      } finally {
        decodingRef.current = false;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [onDecoded]);

  const buildDetector = useCallback(async () => {
    const BD = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
      .BarcodeDetector;
    if (BD) {
      try {
        const supported: string[] = (await BD.getSupportedFormats?.()) ?? [];
        if (supported.includes('qr_code')) {
          const native = new BD({ formats: ['qr_code'] });
          return {
            detect: async (video: HTMLVideoElement) => {
              const codes = await native.detect(video);
              return codes[0]?.rawValue ?? null;
            },
          };
        }
      } catch {
        // Fall through to jsQR.
      }
    }
    const jsQR = (await import('jsqr')).default;
    return {
      detect: async (video: HTMLVideoElement) => {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) return null;
        const scale = Math.min(1, MAX_DECODE_EDGE / Math.max(vw, vh));
        const w = Math.round(vw * scale);
        const h = Math.round(vh * scale);
        const canvas = (canvasRef.current ??= document.createElement('canvas'));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(video, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        return jsQR(img.data, w, h)?.data ?? null;
      },
    };
  }, []);

  const startCamera = useCallback(async () => {
    setPhase('requesting');
    setAwardUrl(null);
    setShowMiss(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase('unavailable');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      // The modal may have closed while the permission prompt was up.
      if (!videoRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => {});
      detectorRef.current ??= await buildDetector();
      setPhase('scanning');
      lastDecodeRef.current = 0;
      decodeLoop();
    } catch {
      setPhase('unavailable');
    }
  }, [buildDetector, decodeLoop]);

  // Camera lifecycle: start on open; stop on close/unmount/page-hide. The
  // camera light must NEVER stay on past the modal.
  useEffect(() => {
    if (!isOpen) return;
    startCamera();
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        stopStream();
        onClose();
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      if (missTimerRef.current) clearTimeout(missTimerRef.current);
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // window.open must run inside the tap gesture or popup blockers eat it —
  // this is why decode ends at a "found" card instead of auto-opening.
  const claim = () => {
    if (awardUrl) window.open(awardUrl, '_blank', 'noopener');
    onClose();
  };

  const bracket = 'absolute w-8 h-8 border-primary';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      placement="center"
      size="md"
      hideCloseButton={phase === 'scanning' || phase === 'requesting'}
    >
      <ModalContent>
        <ModalHeader className="font-museo">{copy.title}</ModalHeader>
        <ModalBody className="pb-6">
          {phase === 'unavailable' ? (
            <div className="rounded-lg bg-content2 p-4 text-sm text-default-500">
              {copy.unavailable}
            </div>
          ) : phase === 'found' ? (
            <div className="flex flex-col items-center gap-4 py-2">
              <p className="font-museo text-lg font-bold text-foreground">{copy.found}</p>
              <Button
                color="primary" fullWidth
                startContent={<ExternalLink className="w-4 h-4" />}
                onPress={claim}
              >
                {copy.claim}
              </Button>
              <Button
                size="sm" variant="flat" fullWidth
                startContent={<RotateCcw className="w-4 h-4" />}
                onPress={startCamera}
              >
                {copy.again}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="relative w-full overflow-hidden rounded-lg bg-black aspect-[3/4]">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className="absolute inset-0 h-full w-full object-cover"
                />
                {/* Corner-bracket scan region, same magenta vocabulary as the flair */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="relative h-3/5 w-4/5 max-w-[280px]">
                    <span className={`${bracket} left-0 top-0 border-l-[3px] border-t-[3px] rounded-tl-md`} />
                    <span className={`${bracket} right-0 top-0 border-r-[3px] border-t-[3px] rounded-tr-md`} />
                    <span className={`${bracket} left-0 bottom-0 border-l-[3px] border-b-[3px] rounded-bl-md`} />
                    <span className={`${bracket} right-0 bottom-0 border-r-[3px] border-b-[3px] rounded-br-md`} />
                  </div>
                </div>
                {phase === 'requesting' && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="animate-pulse font-mono text-xs text-white/70">
                      camera…
                    </span>
                  </div>
                )}
              </div>
              <p className={`text-center text-xs ${showMiss ? 'text-warning' : 'text-default-400'}`}>
                {showMiss ? copy.miss : copy.hint}
              </p>
              <Button
                size="sm" variant="flat" fullWidth
                startContent={<X className="w-4 h-4" />}
                onPress={onClose}
              >
                {copy.cancel}
              </Button>
            </div>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
