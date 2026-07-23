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
  Input,
} from '@heroui/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { apiUrl } from '@/lib/api';
import PinPicker, { type PinOption } from '@/components/profile/PinPicker';
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

/** Services allowed to type coordinates instead of using browser GPS. */
const MANUAL_COORD_SERVICES = ['admin', 'runadmin', 'gpxadmin'];

/** Parse "lat, lng" (comma or whitespace separated) into coordinates, or null. */
function parseLatLng(input: string): { lat: number; lng: number } | null {
  const parts = input.trim().split(/[,\s]+/);
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Display accuracy (m) for a manually typed coordinate — tight, honest circle. */
const MANUAL_ACCURACY_M = 5;

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
  const { data: session } = useSession();
  const services: string[] = (session?.user as { services?: string[] } | undefined)?.services ?? [];
  const canManualCoords = MANUAL_COORD_SERVICES.some((s) => services.includes(s));
  const [phase, setPhase] = useState<Phase>('collecting');
  const [samples, setSamples] = useState<GpsSample[]>([]);
  const [sampleCount, setSampleCount] = useState(0);
  const [bestAccuracy, setBestAccuracy] = useState<number | null>(null);
  const [isPrivate, setIsPrivate] = useState(checkinPreference === 'private');
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Pin personalization: profile default pre-selected, swappable per check-in.
  const [pinIcons, setPinIcons] = useState<PinOption[]>([]);
  const [pinIcon, setPinIcon] = useState('');
  const [pinColor, setPinColor] = useState('');
  const [showPinPicker, setShowPinPicker] = useState(false);
  // Admin-only manual coordinates: overrides the GPS fix for both the map
  // preview and the submitted check-in. Non-admin sessions never see the
  // input, and the parse is gated on canManualCoords everywhere.
  const [manualCoords, setManualCoords] = useState('');
  const [showManualCoords, setShowManualCoords] = useState(false);
  const manual = canManualCoords ? parseLatLng(manualCoords) : null;

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
    setManualCoords('');
    setShowManualCoords(false);
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
      setShowPinPicker(false);
      // Refresh the allowed pins + profile default each open (cheap, auth'd).
      fetch(apiUrl('/api/checkins/pin-options'))
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data || !isOpenRef.current) return;
          setPinIcons(data.icons);
          setPinIcon(data.pinIcon);
          setPinColor(data.pinColor);
        })
        .catch(() => {});
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
      // Manual override (admins only): one synthetic sample at the typed
      // coordinates. The server accepts any valid non-empty sample list; the
      // distinct source labels these check-ins in the data.
      const submitSamples = manual
        ? [{ latitude: manual.lat, longitude: manual.lng, accuracy: MANUAL_ACCURACY_M, timestamp: Date.now() }]
        : samplesRef.current;
      const res = await fetch(apiUrl('/api/checkins'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          samples: submitSamples,
          source: manual ? 'Admin Manual' : 'Web GPS',
          isPrivate,
          pinIcon: pinIcon || undefined,
          pinColor: pinColor || undefined,
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

              {(((phase === 'ready' || phase === 'submitting') && (samplesRef.current.length > 0 || manual)) ||
                (phase === 'error' && manual)) && (() => {
                // Manual coords (admin) override the GPS average for the
                // preview; keying the map by position forces a re-center as
                // the admin types.
                const hasSamples = samplesRef.current.length > 0;
                const avgLat = hasSamples ? samplesRef.current.reduce((s, p) => s + p.latitude, 0) / samplesRef.current.length : 0;
                const avgLng = hasSamples ? samplesRef.current.reduce((s, p) => s + p.longitude, 0) / samplesRef.current.length : 0;
                const lat = manual ? manual.lat : avgLat;
                const lng = manual ? manual.lng : avgLng;
                const acc = manual ? MANUAL_ACCURACY_M : bestAccuracy ?? 30;
                const markerColor = isPrivate ? '#71717a' : '#006FEE';
                return (
                  <div className="w-full rounded-lg overflow-hidden" style={{ height: 140 }}>
                    <MapContainer
                      key={`${lat.toFixed(5)},${lng.toFixed(5)}`}
                      center={[lat, lng]}
                      zoom={zoomForAccuracy(acc, lat)}
                      style={{ height: '100%', width: '100%' }}
                      zoomControl={false}
                      attributionControl={false}
                      dragging={false}
                      scrollWheelZoom={false}
                    >
                      <TileLayer url={tileUrl} />
                      <Circle
                        center={[lat, lng]}
                        radius={acc}
                        pathOptions={{ color: markerColor, fillColor: markerColor, fillOpacity: 0.15, weight: 1 }}
                      />
                      <CircleMarker
                        center={[lat, lng]}
                        radius={6}
                        pathOptions={{ color: markerColor, fillColor: markerColor, fillOpacity: 0.9, weight: 2 }}
                      />
                    </MapContainer>
                  </div>
                );
              })()}

              {phase === 'ready' && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <p className="text-primary text-sm whitespace-nowrap">
                      {manual ? 'manual' : `+/-${Math.round(bestAccuracy ?? 0)}m`}
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
                  {/* Pin personalization - only meaningful for public check-ins */}
                  {!isPrivate && pinIcons.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => setShowPinPicker((v) => !v)}
                        className="text-xs text-default-400 self-start hover:text-default-600"
                      >
                        {showPinPicker ? '▾ Map pin' : '▸ Map pin'}{' '}
                        <span className="text-default-500">
                          ({pinIcons.find((i) => i.id === pinIcon)?.label ?? 'default'})
                        </span>
                      </button>
                      {showPinPicker && (
                        <PinPicker
                          compact
                          icons={pinIcons}
                          icon={pinIcon}
                          color={pinColor}
                          onChange={(pin) => {
                            setPinIcon(pin.icon);
                            setPinColor(pin.color);
                          }}
                        />
                      )}
                    </div>
                  )}
                  {canManualCoords && (
                    <div className="flex flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowManualCoords((v) => !v)}
                        className="text-xs text-default-400 self-start hover:text-default-600"
                      >
                        {showManualCoords ? '▾' : '▸'} Custom coordinates{' '}
                        <span className="text-default-500">(admin)</span>
                      </button>
                      {showManualCoords && (
                        <>
                          <Input
                            size="sm"
                            aria-label="Custom coordinates"
                            placeholder="36.17000, -115.14000"
                            value={manualCoords}
                            onValueChange={setManualCoords}
                            classNames={{ input: 'font-mono text-xs' }}
                          />
                          {manualCoords.trim() !== '' && !manual && (
                            <span className="text-danger text-xs">Enter as &quot;lat, lng&quot;</span>
                          )}
                          {manual && (
                            <span className="text-xs text-default-400">
                              Overriding GPS: {manual.lat.toFixed(5)}, {manual.lng.toFixed(5)}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  )}
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
                  {canManualCoords && (
                    <>
                      <Input
                        size="sm"
                        aria-label="Custom coordinates"
                        label="Custom coordinates (admin)"
                        labelPlacement="outside"
                        placeholder="36.17000, -115.14000"
                        value={manualCoords}
                        onValueChange={setManualCoords}
                        classNames={{ input: 'font-mono text-xs', label: 'text-xs text-default-400' }}
                      />
                      {manualCoords.trim() !== '' && !manual && (
                        <span className="text-danger text-xs">Enter as &quot;lat, lng&quot;</span>
                      )}
                    </>
                  )}
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
                  <Button variant="flat" onPress={handleRetry}>
                    Retry
                  </Button>
                  {manual && (
                    <Button color="primary" onPress={handleSubmit}>
                      Check In
                    </Button>
                  )}
                </>
              )}
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
