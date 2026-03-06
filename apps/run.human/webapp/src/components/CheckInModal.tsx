'use client';

import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Progress,
  Switch,
} from '@heroui/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { apiUrl } from '@/lib/api';

interface GpsSample {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

interface CheckInModalProps {
  isOpen: boolean;
  onClose: () => void;
  checkinPreference?: string;
  onCheckInComplete?: () => void;
}

type Phase = 'collecting' | 'ready' | 'submitting' | 'success' | 'error';

export default function CheckInModal({
  isOpen,
  onClose,
  checkinPreference,
  onCheckInComplete,
}: CheckInModalProps) {
  const [phase, setPhase] = useState<Phase>('collecting');
  const [samples, setSamples] = useState<GpsSample[]>([]);
  const [sampleCount, setSampleCount] = useState(0);
  const [bestAccuracy, setBestAccuracy] = useState<number | null>(null);
  const [isPrivate, setIsPrivate] = useState(checkinPreference === 'private');
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isOpenRef = useRef(false);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const samplesRef = useRef<GpsSample[]>([]);

  const resetState = useCallback(() => {
    setPhase('collecting');
    setSamples([]);
    setSampleCount(0);
    setBestAccuracy(null);
    setIsPrivate(checkinPreference === 'private');
    setQuotaRemaining(null);
    setErrorMessage(null);
    samplesRef.current = [];
  }, [checkinPreference]);

  const clearTimeouts = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  }, []);

  const collectGps = useCallback(() => {
    if (!navigator.geolocation) {
      setPhase('error');
      setErrorMessage('Location unavailable -- enable GPS and try again');
      return;
    }

    let collected = 0;

    const takeSample = () => {
      if (!isOpenRef.current) return;

      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!isOpenRef.current) return;

          const sample: GpsSample = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: Date.now(),
          };

          samplesRef.current = [...samplesRef.current, sample];
          collected++;
          setSamples([...samplesRef.current]);
          setSampleCount(collected);

          if (collected >= 3) {
            const best = Math.min(...samplesRef.current.map((s) => s.accuracy));
            setBestAccuracy(best);
            setPhase('ready');
          } else {
            const t = setTimeout(takeSample, 667);
            timeoutsRef.current.push(t);
          }
        },
        () => {
          if (!isOpenRef.current) return;
          setPhase('error');
          setErrorMessage('Location unavailable -- enable GPS and try again');
        },
        { enableHighAccuracy: true, timeout: 10000 },
      );
    };

    takeSample();
  }, []);

  useEffect(() => {
    if (isOpen) {
      isOpenRef.current = true;
      resetState();
      const t = setTimeout(() => collectGps(), 100);
      timeoutsRef.current.push(t);
    } else {
      isOpenRef.current = false;
      clearTimeouts();
    }

    return () => {
      clearTimeouts();
    };
  }, [isOpen, resetState, collectGps, clearTimeouts]);

  const handleClose = useCallback(() => {
    if (phase === 'submitting') return;
    onClose();
  }, [phase, onClose]);

  const handleSubmit = async () => {
    setPhase('submitting');
    try {
      const res = await fetch(apiUrl('/api/checkins'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          samples: samplesRef.current,
          source: 'Web GPS',
          isPrivate,
        }),
      });

      if (res.status === 429) {
        setPhase('error');
        setErrorMessage('Check-in limit reached for today');
        return;
      }

      if (!res.ok) {
        setPhase('error');
        setErrorMessage('Something went wrong');
        return;
      }

      const data = await res.json();
      setQuotaRemaining(data.quota?.remaining ?? null);
      setPhase('success');
      window.dispatchEvent(new Event('checkin-created'));

      const t = setTimeout(() => {
        if (isOpenRef.current) {
          onClose();
          onCheckInComplete?.();
        }
      }, 1500);
      timeoutsRef.current.push(t);
    } catch {
      setPhase('error');
      setErrorMessage('Something went wrong');
    }
  };

  const handleRetry = () => {
    if (phase === 'error' && samplesRef.current.length === 3) {
      // Retry submit with existing samples
      handleSubmit();
    } else {
      // Retry GPS collection
      resetState();
      const t = setTimeout(() => collectGps(), 100);
      timeoutsRef.current.push(t);
    }
  };

  return (
    <Modal
      size="sm"
      placement="center"
      backdrop="blur"
      isOpen={isOpen}
      isDismissable={phase !== 'submitting'}
      onClose={handleClose}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex flex-col gap-1">GPS Check-in</ModalHeader>
            <ModalBody>
              {phase === 'collecting' && (
                <div className="flex flex-col gap-3">
                  <Progress
                    value={(sampleCount / 3) * 100}
                    color="primary"
                    label="Collecting GPS..."
                    showValueLabel
                    valueLabel={`${sampleCount}/3`}
                    className="w-full"
                  />
                </div>
              )}

              {phase === 'ready' && (
                <div className="flex flex-col gap-4">
                  <p className="text-success text-sm">
                    Location captured (+/-{Math.round(bestAccuracy ?? 0)}m)
                  </p>
                  <div className="flex items-center justify-between">
                    <Switch isSelected={isPrivate} onValueChange={setIsPrivate} size="sm">
                      {isPrivate ? 'Private' : 'Public'}
                    </Switch>
                  </div>
                </div>
              )}

              {phase === 'submitting' && (
                <div className="flex flex-col gap-4">
                  <p className="text-success text-sm">
                    Location captured (+/-{Math.round(bestAccuracy ?? 0)}m)
                  </p>
                  <div className="flex items-center justify-between">
                    <Switch isSelected={isPrivate} isDisabled size="sm">
                      {isPrivate ? 'Private' : 'Public'}
                    </Switch>
                  </div>
                </div>
              )}

              {phase === 'success' && (
                <div className="flex flex-col gap-2 items-center">
                  <p className="text-success text-lg font-semibold">Checked in!</p>
                  {quotaRemaining !== null && (
                    <p className="text-default-400 text-xs">
                      {quotaRemaining} check-in{quotaRemaining !== 1 ? 's' : ''} remaining today
                    </p>
                  )}
                </div>
              )}

              {phase === 'error' && (
                <div className="flex flex-col gap-2">
                  <p className="text-danger text-sm">{errorMessage}</p>
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              {phase === 'ready' && (
                <>
                  <Button variant="light" onPress={handleClose}>
                    Cancel
                  </Button>
                  <Button color="success" onPress={handleSubmit}>
                    Check In
                  </Button>
                </>
              )}

              {phase === 'submitting' && (
                <>
                  <Button variant="light" isDisabled>
                    Cancel
                  </Button>
                  <Button color="success" isLoading>
                    Check In
                  </Button>
                </>
              )}

              {phase === 'error' && (
                <>
                  <Button variant="light" onPress={handleClose}>
                    Cancel
                  </Button>
                  <Button color="primary" onPress={handleRetry}>
                    Retry
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
