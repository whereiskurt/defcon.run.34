'use client';

import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Progress,
  Select,
  SelectItem,
} from '@heroui/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { apiUrl } from '@/lib/api';
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';

const TILES_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILES_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

const MapContainer = dynamic(
  () => import('react-leaflet').then((m) => m.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import('react-leaflet').then((m) => m.TileLayer),
  { ssr: false }
);
const CircleMarker = dynamic(
  () => import('react-leaflet').then((m) => m.CircleMarker),
  { ssr: false }
);
const Circle = dynamic(
  () => import('react-leaflet').then((m) => m.Circle),
  { ssr: false }
);

/** Compute zoom level so a circle of `radiusMeters` fits in ~60% of `pixelHeight` */
function zoomForAccuracy(radiusMeters: number, lat: number): number {
  // meters per pixel at zoom z = (156543.03 * cos(lat)) / 2^z
  // We want radius to be ~30% of map height (say 42px out of 140px)
  const targetPixels = 42;
  const metersPerPixelAtZoom0 = 156543.03 * Math.cos((lat * Math.PI) / 180);
  const z = Math.log2(metersPerPixelAtZoom0 * targetPixels / radiusMeters);
  return Math.min(Math.max(Math.round(z), 10), 18);
}

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
  const { resolvedTheme } = useTheme();
  const tileUrl = resolvedTheme === 'dark' ? TILES_DARK : TILES_LIGHT;
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

              {(phase === 'ready' || phase === 'submitting') && samplesRef.current.length > 0 && (() => {
                const avgLat = samplesRef.current.reduce((s, p) => s + p.latitude, 0) / samplesRef.current.length;
                const avgLng = samplesRef.current.reduce((s, p) => s + p.longitude, 0) / samplesRef.current.length;
                const acc = bestAccuracy ?? 30;
                const markerColor = isPrivate ? '#71717a' : '#006FEE';
                return (
                  <div className="w-full rounded-lg overflow-hidden" style={{ height: 140 }}>
                    <MapContainer
                      center={[avgLat, avgLng]}
                      zoom={zoomForAccuracy(acc, avgLat)}
                      style={{ height: '100%', width: '100%' }}
                      zoomControl={false}
                      attributionControl={false}
                      dragging={false}
                      scrollWheelZoom={false}
                    >
                      <TileLayer url={tileUrl} />
                      <Circle
                        center={[avgLat, avgLng]}
                        radius={acc}
                        pathOptions={{ color: markerColor, fillColor: markerColor, fillOpacity: 0.15, weight: 1 }}
                      />
                      <CircleMarker
                        center={[avgLat, avgLng]}
                        radius={6}
                        pathOptions={{ color: markerColor, fillColor: markerColor, fillOpacity: 0.9, weight: 2 }}
                      />
                    </MapContainer>
                  </div>
                );
              })()}

              {phase === 'ready' && (
                <div className="flex items-center gap-3">
                  <p className="text-primary text-sm whitespace-nowrap">
                    +/-{Math.round(bestAccuracy ?? 0)}m
                  </p>
                  <Select
                    aria-label="Visibility"
                    selectedKeys={[isPrivate ? 'private' : 'public']}
                    onSelectionChange={(keys) => {
                      const val = Array.from(keys)[0] as string;
                      setIsPrivate(val === 'private');
                    }}
                    size="sm"
                    variant="flat"
                    className="flex-1"
                    classNames={{ trigger: 'min-h-9' }}
                  >
                    <SelectItem key="public">Public</SelectItem>
                    <SelectItem key="private">Private</SelectItem>
                  </Select>
                </div>
              )}

              {phase === 'submitting' && (
                <div className="flex items-center gap-3">
                  <p className="text-primary text-sm whitespace-nowrap">
                    +/-{Math.round(bestAccuracy ?? 0)}m
                  </p>
                  <Select
                    aria-label="Visibility"
                    selectedKeys={[isPrivate ? 'private' : 'public']}
                    isDisabled
                    size="sm"
                    variant="flat"
                    className="flex-1"
                    classNames={{ trigger: 'min-h-9' }}
                  >
                    <SelectItem key="public">Public</SelectItem>
                    <SelectItem key="private">Private</SelectItem>
                  </Select>
                </div>
              )}

              {phase === 'success' && (
                <div className="flex flex-col gap-2 items-center">
                  <p className="text-primary text-lg font-semibold">Checked in!</p>
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
                  <Button color="primary" onPress={handleSubmit}>
                    Check In
                  </Button>
                </>
              )}

              {phase === 'submitting' && (
                <>
                  <Button variant="light" isDisabled>
                    Cancel
                  </Button>
                  <Button color="primary" isLoading>
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
