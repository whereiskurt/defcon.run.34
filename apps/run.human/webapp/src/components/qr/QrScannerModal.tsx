'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, Button, Switch,
} from '@heroui/react';
import { ExternalLink, RotateCcw, X, Volume2, ClipboardCheck } from 'lucide-react';
import { parseRunnerQr, awardPathFor, type RunnerQr } from './parseRunnerQr';
import { getApiBasePath, apiUrl } from '@/lib/api';

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
  /** Admin/runadmin only: shows the attendance-mode toggle. */
  attendanceAvailable?: boolean;
}

type Phase = 'requesting' | 'scanning' | 'found' | 'unavailable';
type FlashKind = 'ok' | 'dup' | 'err';

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
const FLASH_MS = 1200;

const ATTENDANCE_KEY = 'socialqr.attendance';
const SOUND_KEY = 'socialqr.attendance.sound';
// A QR sitting in frame keeps decoding at ~8fps — re-announce "already
// scanned" at most this often per token so feedback pulses instead of strobing.
const REFEEDBACK_MS = 2500;

/**
 * Feedback sounds (WebAudio — no asset). Best-effort on iOS.
 * 'ok' = bright single beep; 'no' = two short low buzzes ("I see it, and no").
 */
function playBeep(ctxRef: { current: AudioContext | null }, kind: 'ok' | 'no') {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctxRef.current ??= new Ctor();
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') void ctx.resume();
    const note = (freq: number, at: number, dur: number, type: OscillatorType) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, at);
      gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + dur + 0.01);
    };
    const t = ctx.currentTime;
    if (kind === 'ok') {
      note(880, t, 0.15, 'sine');
    } else {
      note(294, t, 0.09, 'square');
      note(220, t + 0.11, 0.11, 'square');
    }
  } catch {
    // Sound is decoration — never let it break scanning.
  }
}

export default function QrScannerModal({
  isOpen, onClose, copy, attendanceAvailable = false,
}: Props) {
  const [phase, setPhase] = useState<Phase>('requesting');
  const [awardUrl, setAwardUrl] = useState<string | null>(null);
  const [showMiss, setShowMiss] = useState(false);
  const [attendanceOn, setAttendanceOn] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [tally, setTally] = useState({ ok: 0, dup: 0 });
  const [flash, setFlash] = useState<{ kind: FlashKind; msg: string } | null>(null);
  // Bumped on every flash so the bracket pulse animation restarts even when
  // two same-kind flashes land back to back.
  const [flashTick, setFlashTick] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const lastDecodeRef = useRef(0);
  const decodingRef = useRef(false);
  const missTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  // Attendance-mode dedup: tokens already POSTed this session (pending or
  // settled). Network failures are removed so the runner can be re-scanned.
  const seenRef = useRef<Set<string>>(new Set());
  // Last time each already-seen token got its "and no" pulse (REFEEDBACK_MS).
  const noFeedbackAtRef = useRef<Map<string, number>>(new Map());
  // Live mirrors for the decode callback (avoids stale-closure re-wiring).
  const attendanceRef = useRef(false);
  const soundRef = useRef(true);
  // Engine handles, resolved once per open: native BarcodeDetector when the
  // browser has one (Chrome/Android), else lazy-loaded jsQR (iPhone Safari —
  // the main real-world path at the con).
  const detectorRef = useRef<{ detect: (v: HTMLVideoElement) => Promise<string | null> } | null>(null);

  const stopStream = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const flashNow = useCallback((kind: FlashKind, msg: string) => {
    setFlash({ kind, msg });
    setFlashTick((t) => t + 1);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(null), FLASH_MS);
  }, []);

  /** Attendance mode: fire the pairing in the background and keep scanning. */
  const autoPair = useCallback(async (qr: RunnerQr) => {
    const key = `${qr.kind}:${qr.value}`;
    if (seenRef.current.has(key)) {
      // "I see it, and no" — pulse red + buzz, throttled so a QR sitting in
      // frame gets a heartbeat of feedback instead of a strobe.
      const last = noFeedbackAtRef.current.get(key) ?? 0;
      const now = Date.now();
      if (now - last > REFEEDBACK_MS) {
        noFeedbackAtRef.current.set(key, now);
        if (soundRef.current) playBeep(audioCtxRef, 'no');
        flashNow('dup', 'Already scanned');
      }
      return;
    }
    seenRef.current.add(key);
    try {
      const res = await fetch(apiUrl('/api/social-scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(qr.kind === 'token' ? { p: qr.value } : { h: qr.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTally((t) => ({ ...t, ok: t.ok + 1 }));
        if (soundRef.current) playBeep(audioCtxRef, 'ok');
        flashNow('ok', `PAIRED · ${data.ownerName ?? 'runner'}`);
      } else if (data.code === 'already_today') {
        setTally((t) => ({ ...t, dup: t.dup + 1 }));
        if (soundRef.current) playBeep(audioCtxRef, 'no');
        flashNow('dup', 'Already paired today');
      } else if (data.code === 'self') {
        if (soundRef.current) playBeep(audioCtxRef, 'no');
        flashNow('dup', "That's your own QR");
      } else {
        if (soundRef.current) playBeep(audioCtxRef, 'no');
        flashNow('err', data.message ?? 'Pairing failed');
      }
    } catch {
      // Network hiccup: allow a retry on the next sight of this QR.
      seenRef.current.delete(key);
      flashNow('err', 'Network hiccup - hold steady and retry');
    }
  }, [flashNow]);

  const onDecoded = useCallback((text: string) => {
    const qr = parseRunnerQr(text);
    if (!qr) {
      setShowMiss(true);
      if (missTimerRef.current) clearTimeout(missTimerRef.current);
      missTimerRef.current = setTimeout(() => setShowMiss(false), MISS_FLASH_MS);
      return;
    }
    if (attendanceRef.current) {
      // Camera stays on; award fires in the background.
      void autoPair(qr);
      return;
    }
    stopStream();
    setAwardUrl(awardPathFor(qr, getApiBasePath()));
    setPhase('found');
  }, [autoPair, stopStream]);

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
      // "Scan another" starts from the found state, where the <video> isn't
      // mounted yet — give React a few frames to render it before giving up
      // (no video after that means the modal closed mid-permission-prompt).
      for (let i = 0; i < 5 && !videoRef.current; i++) {
        await new Promise(requestAnimationFrame);
      }
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
    if (attendanceAvailable) {
      try {
        const att = localStorage.getItem(ATTENDANCE_KEY) === '1';
        setAttendanceOn(att);
        attendanceRef.current = att;
        const snd = localStorage.getItem(SOUND_KEY) !== '0';
        setSoundOn(snd);
        soundRef.current = snd;
      } catch {
        // Private-mode localStorage failures: defaults stand.
      }
    }
    setTally({ ok: 0, dup: 0 });
    seenRef.current = new Set();
    noFeedbackAtRef.current = new Map();
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
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Attendance sessions run long — keep the screen awake while scanning.
  useEffect(() => {
    if (!(isOpen && attendanceOn && phase === 'scanning')) return;
    let cancelled = false;
    (navigator as Navigator & {
      wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
    }).wakeLock?.request('screen')
      .then((lock) => {
        if (cancelled) void lock.release().catch(() => {});
        else wakeLockRef.current = lock;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [isOpen, attendanceOn, phase]);

  const toggleAttendance = (on: boolean) => {
    setAttendanceOn(on);
    attendanceRef.current = on;
    try { localStorage.setItem(ATTENDANCE_KEY, on ? '1' : '0'); } catch {}
    // The toggle press is a user gesture — warm up the AudioContext now so
    // later background beeps aren't blocked by autoplay policy.
    if (on && soundRef.current) playBeep(audioCtxRef, 'ok');
    // Flipping it on from the found card resumes scanning.
    if (on && phase === 'found') startCamera();
  };

  const toggleSound = (on: boolean) => {
    setSoundOn(on);
    soundRef.current = on;
    try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch {}
    if (on) playBeep(audioCtxRef, 'ok');
  };

  // window.open must run inside the tap gesture or popup blockers eat it —
  // this is why decode ends at a "found" card instead of auto-opening.
  const claim = () => {
    if (awardUrl) window.open(awardUrl, '_blank', 'noopener');
    onClose();
  };

  const bracket = 'absolute w-12 h-12 border-current';
  const bracketTone =
    flash?.kind === 'ok'
      ? 'text-success qrs-pulse'
      : flash && (flash.kind === 'dup' || flash.kind === 'err')
        ? 'text-danger qrs-pulse'
        : 'text-primary';
  const glow =
    flash?.kind === 'ok'
      ? 'ring-4 ring-success shadow-[0_0_28px_rgba(51,255,153,0.85)]'
      : flash?.kind === 'dup'
        ? 'ring-2 ring-warning'
        : flash?.kind === 'err'
          ? 'ring-2 ring-danger'
          : '';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      placement="center"
      size="md"
      hideCloseButton={phase === 'scanning' || phase === 'requesting'}
    >
      <ModalContent>
        <ModalHeader className="font-museo flex items-center gap-2">
          {copy.title}
          {attendanceOn && attendanceAvailable && (
            <span className="font-mono text-[10px] tracking-widest text-success border border-success rounded-full px-2 py-0.5">
              ATTENDANCE
            </span>
          )}
        </ModalHeader>
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
              <div
                className={`relative w-full overflow-hidden rounded-lg bg-black aspect-[3/4] transition-shadow duration-300 ${glow}`}
              >
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className="absolute inset-0 h-full w-full object-cover"
                />
                {/* Corner-bracket scan region: magenta idle, pulses green on a
                    pair and red on "I see it, and no". Soft glow = fuzz. */}
                <style>{`
                  .qrs-brackets { filter: drop-shadow(0 0 5px currentColor); }
                  .qrs-brackets.qrs-pulse { animation: qrs-pulse 0.7s ease-out; }
                  @keyframes qrs-pulse {
                    0%   { transform: scale(1);    filter: drop-shadow(0 0 5px currentColor); }
                    35%  { transform: scale(1.08); filter: drop-shadow(0 0 22px currentColor); }
                    100% { transform: scale(1);    filter: drop-shadow(0 0 5px currentColor); }
                  }
                `}</style>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div
                    key={flashTick}
                    className={`qrs-brackets relative h-3/5 w-4/5 max-w-[280px] ${bracketTone}`}
                  >
                    <span className={`${bracket} left-0 top-0 border-l-4 border-t-4 rounded-tl-lg`} />
                    <span className={`${bracket} right-0 top-0 border-r-4 border-t-4 rounded-tr-lg`} />
                    <span className={`${bracket} left-0 bottom-0 border-l-4 border-b-4 rounded-bl-lg`} />
                    <span className={`${bracket} right-0 bottom-0 border-r-4 border-b-4 rounded-br-lg`} />
                  </div>
                </div>
                {attendanceOn && attendanceAvailable && (tally.ok > 0 || tally.dup > 0) && (
                  <div className="absolute top-2 right-2 rounded-full bg-black/70 px-3 py-1 font-mono text-xs text-success">
                    {tally.ok} paired{tally.dup > 0 ? ` · ${tally.dup} dup` : ''}
                  </div>
                )}
                {phase === 'requesting' && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="animate-pulse font-mono text-xs text-white/70">
                      camera…
                    </span>
                  </div>
                )}
              </div>
              <p
                className={`text-center text-xs ${
                  flash
                    ? flash.kind === 'ok'
                      ? 'text-success font-mono'
                      : flash.kind === 'dup'
                        ? 'text-warning'
                        : 'text-danger'
                    : showMiss
                      ? 'text-warning'
                      : 'text-default-400'
                }`}
              >
                {flash ? flash.msg : showMiss ? copy.miss : copy.hint}
              </p>
              {attendanceAvailable && (
                <div className="flex w-full items-center justify-between rounded-lg bg-content2 px-3 py-2">
                  <Switch
                    size="sm"
                    color="success"
                    isSelected={attendanceOn}
                    onValueChange={toggleAttendance}
                    startContent={<ClipboardCheck className="w-3.5 h-3.5" />}
                  >
                    <span className="text-xs">Attendance mode</span>
                  </Switch>
                  <Switch
                    size="sm"
                    color="secondary"
                    isSelected={soundOn}
                    onValueChange={toggleSound}
                    isDisabled={!attendanceOn}
                    startContent={<Volume2 className="w-3.5 h-3.5" />}
                  >
                    <span className="text-xs">Sound</span>
                  </Switch>
                </div>
              )}
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
