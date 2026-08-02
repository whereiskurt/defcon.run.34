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
  const { t } = useCopy();
  // t() echoes the raw key when unset -- same default-floor idiom as whoami.
  const copyOr = (key: string, fallback: string) => {
    const v = t(key);
    return !v || v === key ? fallback : v;
  };

  const copy = quickCheckInCopy(checkinPreference);
  const { phase: gpsPhase, samplesRef, restart } = useGpsSamples(isOpen);

  const [status, setStatus] = useState<Status>('confirm');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Set the instant the runner commits, so a confirm pressed during sampling
  // arms exactly one deferred submit -- never two.
  const armedRef = useRef(false);
  const openRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    openRef.current = isOpen;
    if (isOpen) {
      setStatus('confirm');
      setErrorMessage(null);
      armedRef.current = false;
    }
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [isOpen]);

  const submit = useCallback(async () => {
    setStatus('submitting');
    setErrorMessage(null);
    try {
      const res = await fetch(apiUrl('/api/checkins'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildQuickCheckInBody(samplesRef.current)),
      });
      if (!openRef.current) return;

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
        if (openRef.current) onClose();
      }, 1500);
    } catch {
      if (!openRef.current) return;
      armedRef.current = false;
      setErrorMessage('Something went wrong');
      setStatus('error');
    }
  }, [samplesRef, onClose]);

  const handleConfirm = () => {
    if (armedRef.current) return;
    armedRef.current = true;
    if (gpsPhase === 'ready') {
      submit();
    } else {
      setStatus('submitting'); // spinner while the fix lands; effect below fires
    }
  };

  // Warm start: a confirm pressed before the fix landed submits as soon as it does.
  useEffect(() => {
    if (armedRef.current && status === 'submitting' && gpsPhase === 'ready') {
      submit();
    }
  }, [gpsPhase, status, submit]);

  // A GPS failure while waiting cancels the armed submit -- there is nothing to send.
  useEffect(() => {
    if (gpsPhase !== 'error') return;
    armedRef.current = false;
    setErrorMessage(GPS_UNAVAILABLE_MESSAGE);
    setStatus('error');
  }, [gpsPhase]);

  const handleRetry = () => {
    setErrorMessage(null);
    armedRef.current = false;
    setStatus('confirm');
    if (gpsPhase === 'error') restart();
  };

  return (
    <Modal
      size="sm"
      placement="center"
      backdrop="blur"
      isOpen={isOpen}
      isDismissable={status !== 'submitting'}
      onClose={() => { if (status !== 'submitting') onClose(); }}
    >
      <ModalContent>
        {() => (
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
        )}
      </ModalContent>
    </Modal>
  );
}
