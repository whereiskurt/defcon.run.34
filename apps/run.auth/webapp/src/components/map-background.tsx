'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Slider,
} from '@heroui/react';
import { Settings2 } from 'lucide-react';

const ZOOM_LEVELS = [
  { value: 9, label: 'Far' },
  { value: 10, label: 'City' },
  { value: 11, label: 'Streets' },
  { value: 12, label: 'Close' },
] as const;

const STORAGE_KEY = 'dcr-bg-prefs';

type BgPrefs = {
  zoom: number;
  opacity: number;
  parallax: boolean;
};

const DEFAULT_PREFS: BgPrefs = {
  zoom: 11,
  opacity: 15,
  parallax: true,
};

function loadPrefs(): BgPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULT_PREFS, ...JSON.parse(stored) };
  } catch {}
  return DEFAULT_PREFS;
}

function savePrefs(prefs: BgPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}

export function MapBackground() {
  const [prefs, setPrefs] = useState<BgPrefs>(DEFAULT_PREFS);
  const [mounted, setMounted] = useState(false);
  const bgRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    setPrefs(loadPrefs());
    setMounted(true);
  }, []);

  const updatePrefs = useCallback((updates: Partial<BgPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...updates };
      savePrefs(next);
      return next;
    });
  }, []);

  // Parallax mouse follow
  useEffect(() => {
    if (!mounted || !prefs.parallax) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (!bgRef.current) return;
        // Map mouse position to -15..15px offset
        const x = ((e.clientX / window.innerWidth) - 0.5) * 30;
        const y = ((e.clientY / window.innerHeight) - 0.5) * 30;
        bgRef.current.style.transform = `translate(${x}px, ${y}px) scale(1.08)`;
      });
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [mounted, prefs.parallax]);

  if (!mounted) return null;

  return (
    <>
      {/* Map background layer */}
      <div
        ref={bgRef}
        className="map-bg-layer fixed inset-0 z-0 pointer-events-none transition-transform duration-300 ease-out"
        style={{
          backgroundImage: `url(/bg/vegas-z${prefs.zoom}.png)`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          opacity: prefs.opacity / 100,
          filter: 'brightness(1.8) contrast(1.2)',
          transform: 'scale(1.08)',
          willChange: 'transform',
        }}
      />

      {/* Light mode: invert the dark map to light tones */}
      <style>{`
        html.light .map-bg-layer {
          filter: invert(1) brightness(1.4) contrast(0.6);
        }
      `}</style>

      {/* Settings gear - bottom right */}
      <div className="fixed bottom-4 right-4 z-50">
        <Popover placement="top-end" backdrop="blur">
          <PopoverTrigger>
            <Button
              isIconOnly
              size="sm"
              variant="flat"
              className="bg-background/40 backdrop-blur-sm border border-divider/50 text-default-400 hover:text-foreground min-w-8 w-8 h-8"
              aria-label="Background settings"
            >
              <Settings2 className="w-3.5 h-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-4 space-y-4">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-default-400 block mb-2">
                Map Zoom
              </span>
              <div className="flex gap-1.5">
                {ZOOM_LEVELS.map(({ value, label }) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={prefs.zoom === value ? 'solid' : 'flat'}
                    color={prefs.zoom === value ? 'primary' : 'default'}
                    className="flex-1 text-xs min-w-0"
                    onPress={() => updatePrefs({ zoom: value })}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-default-400 block mb-2">
                Opacity ({prefs.opacity}%)
              </span>
              <Slider
                size="sm"
                step={1}
                minValue={0}
                maxValue={40}
                value={prefs.opacity}
                onChange={(v) => updatePrefs({ opacity: v as number })}
                classNames={{
                  track: "h-1",
                  filler: "bg-primary",
                }}
                aria-label="Background opacity"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-default-400">
                Parallax
              </span>
              <Button
                size="sm"
                variant={prefs.parallax ? 'solid' : 'flat'}
                color={prefs.parallax ? 'primary' : 'default'}
                className="text-xs"
                onPress={() => updatePrefs({ parallax: !prefs.parallax })}
              >
                {prefs.parallax ? 'On' : 'Off'}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}
