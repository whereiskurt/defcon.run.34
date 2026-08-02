'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button,
} from '@heroui/react';
import { MapPin, Check, AlertCircle } from 'lucide-react';
import { useGpsSamples } from '@/hooks/useGpsSamples';
import {
  quickCheckInCopy,
  buildQuickCheckInBody,
  quickCheckInError,
  GPS_UNAVAILABLE_MESSAGE,
} from '@/lib/quick-checkin';
import { useCopy } from '@/components/CopyProvider';
import { apiUrl } from '@/lib/api';
import type { GpsSample } from '@/lib/gps-samples';

interface QuickCheckInModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 'private' means this runner's check-ins default to private. */
  checkinPreference?: string;
}

type Status = 'confirm' | 'submitting' | 'success' | 'error';

/**
 * One-tap check-in: confirm, and go. GPS sampling starts the moment the modal
 * opens so the fix is usually already in hand by the time the runner presses
 * the button -- the "warm start".
 *
 * Everything configurable (privacy, pin) is deliberately absent; the runner's
 * profile decides, server-side. The full CheckInModal behind the Check-ins
 * card is still the way to override either for a single check-in.
 */
export default function QuickCheckInModal({
  isOpen, onClose, checkinPreference,
}: QuickCheckInModalProps) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <Modal
      size="sm"
      placement="center"
      backdrop="blur"
      isOpen={isOpen}
      isDismissable={!submitting}
      onClose={() => { if (!submitting) onClose(); }}
    >
      <ModalContent>
        {/* Body mounts on open and unmounts on close, so every open starts
            from clean state -- no reset bookkeeping, and sampling begins
            exactly when the runner can see the dialog. */}
        {() => (
          <QuickCheckInBody
            onClose={onClose}
            checkinPreference={checkinPreference}
            onSubmittingChange={setSubmitting}
          />
        )}
      </ModalContent>
    </Modal>
  );
}

interface QuickCheckInBodyProps {
  onClose: () => void;
  checkinPreference?: string;
  /** Lifted so the shell can block dismissal mid-submit. */
  onSubmittingChange: (submitting: boolean) => void;
}

function QuickCheckInBody({
  onClose, checkinPreference, onSubmittingChange,
}: QuickCheckInBodyProps) {
  const { t } = useCopy();
  // t() echoes the raw key when unset -- same default-floor idiom as whoami.
  const copyOr = (key: string, fallback: string) => {
    const v = t(key);
    return !v || v === key ? fallback : v;
  };

  const copy = quickCheckInCopy(checkinPreference);

  const [status, setStatus] = useState<Status>('confirm');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Set the instant the runner commits, so a confirm pressed during sampling
  // arms exactly one deferred submit -- never two.
  const armedRef = useRef(false);
  const mountedRef = useRef(true);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const submit = useCallback(async (samples: GpsSample[]) => {
    setStatus('submitting');
    onSubmittingChange(true);
    setErrorMessage(null);
    try {
      const res = await fetch(apiUrl('/api/checkins'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildQuickCheckInBody(samples)),
      });
      if (!mountedRef.current) return;
      onSubmittingChange(false);

      if (!res.ok) {
        armedRef.current = false;
        setErrorMessage(quickCheckInError(res.status));
        setStatus('error');
        return;
      }

      setStatus('success');
      // Same signal the full modal sends: the Check-ins card expands and refetches.
      window.dispatchEvent(new Event('checkin-created'));
      closeTimerRef.current = setTimeout(() => {
        if (mountedRef.current) onClose();
      }, 1500);
    } catch {
      if (!mountedRef.current) return;
      onSubmittingChange(false);
      armedRef.current = false;
      setErrorMessage('Something went wrong');
      setStatus('error');
    }
  }, [onClose, onSubmittingChange]);

  // Sampling starts on mount. Outcomes arrive as callbacks rather than a phase
  // the body has to watch with an effect.
  const { phase: gpsPhase, samplesRef, restart } = useGpsSamples(true, {
    onReady: (samples) => {
      // Warm start: the runner already pressed Check in, so go now.
      if (armedRef.current) submit(samples);
    },
    onError: () => {
      // Nothing to send -- cancel any armed submit.
      armedRef.current = false;
      onSubmittingChange(false);
      setErrorMessage(GPS_UNAVAILABLE_MESSAGE);
      setStatus('error');
    },
  });

  const handleConfirm = () => {
    if (armedRef.current) return;
    armedRef.current = true;
    if (gpsPhase === 'ready') {
      submit(samplesRef.current);
    } else {
      // Spinner while the fix lands; onReady fires the submit.
      setStatus('submitting');
      onSubmittingChange(true);
    }
  };

  const handleRetry = () => {
    setErrorMessage(null);
    armedRef.current = false;
    setStatus('confirm');
    if (gpsPhase === 'error') restart();
  };

  return (
    <>
      <ModalHeader className="flex items-center gap-2">
        <MapPin className="w-5 h-5 text-primary" />
        {copyOr(copy.titleKey, copy.titleFallback)}
      </ModalHeader>
      <ModalBody>
        {status === 'success' ? (
          <div className="flex items-center gap-2 py-2 text-success">
            <Check className="w-5 h-5" />
            <span className="font-medium">
              {copyOr('checkin.quick.done', 'Checked in!')}
            </span>
          </div>
        ) : status === 'error' ? (
          <div className="flex items-start gap-2 py-2 text-danger">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span className="text-sm">{errorMessage}</span>
          </div>
        ) : (
          <p className="text-sm text-default-600 py-2">
            {copyOr(copy.bodyKey, copy.bodyFallback)}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        {status === 'error' ? (
          <>
            <Button variant="light" onPress={onClose}>
              {copyOr('checkin.quick.cancel', 'Cancel')}
            </Button>
            <Button color="primary" onPress={handleRetry}>
              {copyOr('checkin.quick.retry', 'Try again')}
            </Button>
          </>
        ) : status === 'success' ? null : (
          <>
            <Button
              variant="light"
              isDisabled={status === 'submitting'}
              onPress={onClose}
            >
              {copyOr('checkin.quick.cancel', 'Cancel')}
            </Button>
            <Button
              color="primary"
              size="lg"
              isLoading={status === 'submitting'}
              onPress={handleConfirm}
            >
              {copyOr('checkin.quick.confirm', 'Check in')}
            </Button>
          </>
        )}
      </ModalFooter>
    </>
  );
}
