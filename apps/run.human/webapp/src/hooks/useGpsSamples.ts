'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  type GpsSample,
  toGpsSample,
  bestAccuracyOf,
  SAMPLE_TARGET,
  SAMPLE_INTERVAL_MS,
  GEO_OPTIONS,
} from '@/lib/gps-samples';

export type GpsPhase = 'collecting' | 'ready' | 'error';

export interface UseGpsSamplesOptions {
  /** The fix landed. Fired from the geolocation callback, not an effect. */
  onReady?: (samples: GpsSample[]) => void;
  /** Geolocation is unavailable or was denied. */
  onError?: () => void;
}

/**
 * Collects SAMPLE_TARGET GPS fixes while `isActive`, then reports 'ready'.
 * Extracted from CheckInModal so the full and quick check-in modals share one
 * sampling implementation -- a GPS bug now has a single place to be fixed.
 *
 * Outcomes are pushed to onReady/onError rather than left for the caller to
 * watch with an effect: reacting to `phase` from a consumer effect means a
 * cascading render on every fix (react-hooks/set-state-in-effect).
 *
 * Every async callback is guarded by activeRef so a closed modal never writes
 * state, and all pending timers are cleared on deactivate and on unmount.
 */
export function useGpsSamples(isActive: boolean, options: UseGpsSamplesOptions = {}) {
  // Held in a ref so a caller passing inline closures does not restart sampling.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [phase, setPhase] = useState<GpsPhase>('collecting');
  const [samples, setSamples] = useState<GpsSample[]>([]);
  const [sampleCount, setSampleCount] = useState(0);
  const [bestAccuracy, setBestAccuracy] = useState<number | null>(null);

  const activeRef = useRef(false);
  const samplesRef = useRef<GpsSample[]>([]);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimeouts = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  }, []);

  const collect = useCallback(() => {
    if (!navigator.geolocation) {
      setPhase('error');
      optionsRef.current.onError?.();
      return;
    }

    let collected = 0;

    const takeSample = () => {
      if (!activeRef.current) return;

      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!activeRef.current) return;

          samplesRef.current = [...samplesRef.current, toGpsSample(position, Date.now())];
          collected++;
          setSamples([...samplesRef.current]);
          setSampleCount(collected);

          if (collected >= SAMPLE_TARGET) {
            setBestAccuracy(bestAccuracyOf(samplesRef.current));
            setPhase('ready');
            optionsRef.current.onReady?.(samplesRef.current);
          } else {
            timeoutsRef.current.push(setTimeout(takeSample, SAMPLE_INTERVAL_MS));
          }
        },
        () => {
          if (!activeRef.current) return;
          setPhase('error');
          optionsRef.current.onError?.();
        },
        GEO_OPTIONS,
      );
    };

    takeSample();
  }, []);

  const reset = useCallback(() => {
    setPhase('collecting');
    setSamples([]);
    setSampleCount(0);
    setBestAccuracy(null);
    samplesRef.current = [];
  }, []);

  /** Throw away what we have and sample again -- backs the retry buttons. */
  const restart = useCallback(() => {
    clearTimeouts();
    reset();
    timeoutsRef.current.push(setTimeout(() => collect(), 100));
  }, [clearTimeouts, reset, collect]);

  useEffect(() => {
    if (isActive) {
      activeRef.current = true;
      reset();
      timeoutsRef.current.push(setTimeout(() => collect(), 100));
    } else {
      activeRef.current = false;
      clearTimeouts();
    }

    return () => {
      clearTimeouts();
    };
  }, [isActive, reset, collect, clearTimeouts]);

  return { phase, samples, samplesRef, sampleCount, bestAccuracy, restart };
}
