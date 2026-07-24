'use client';

import { useEffect, useMemo, useRef } from 'react';
import { computeBounds, centerTile, type LatLng } from '@/lib/polyline-geometry';

/**
 * PolylineRenderer — a client `<canvas>` route thumbnail (LDBR-09, Phase 52).
 *
 * A faithful port of DC33's `components/routes/PolylineRenderer.tsx`: one
 * OpenStreetMap tile behind a white-halo route with a green start dot and a red
 * end dot, plus the DC33 dark-mode canvas filter and the tile-error fallback
 * (still draw the route when the tile fails to load).
 *
 * DC34 delta: the input is already an array of `{ lat, lng }` OBJECTS (from
 * `Accomplishment.metadata.polyline`, produced in Phase 50) — so there is NO
 * Google-polyline decode. The bounds → zoom → center-tile math lives in the pure,
 * unit-tested `@/lib/polyline-geometry` seam; this component only draws.
 */
interface PolylineRendererProps {
  points: LatLng[];
  width?: number;
  height?: number;
  strokeColor?: string;
  strokeWidth?: number;
  padding?: number;
  showMapTile?: boolean;
  theme?: 'light' | 'dark';
}

export default function PolylineRenderer({
  points,
  width = 200,
  height = 120,
  strokeColor = '#3B82F6',
  strokeWidth = 2,
  padding = 10,
  showMapTile = true,
  theme = 'light',
}: PolylineRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Unified theme detection: ONLY use the passed theme prop for consistency.
  const isDarkMode = theme === 'dark';

  // DC34 has no decode step — the incoming polyline is already objects. Convert
  // once to the [lat, lng] pairs the draw loop expects. Memoized so the effect
  // only re-runs when the actual coordinates change.
  const pairs = useMemo<[number, number][]>(
    () => points.map(({ lat, lng }) => [lat, lng]),
    [points]
  );

  useEffect(() => {
    if (!canvasRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    // Clear canvas and add a subtle background so an empty canvas is visible.
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, 0, width, height);

    const renderPolylineOnly = () => {
      try {
        if (pairs.length < 1) {
          // Draw "No route data" text (DC33 empty-state).
          ctx.fillStyle = isDarkMode ? '#666' : '#999';
          ctx.font = '10px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('No route data', width / 2, height / 2);
          return;
        }

        // Single point (a check-in pin): synthesize ~±200m bounds around it so
        // the tile zoom math works, then draw one marker instead of a route.
        const singlePoint = pairs.length === 1;
        const bounds = singlePoint
          ? {
              minLat: pairs[0][0] - 0.002,
              maxLat: pairs[0][0] + 0.002,
              minLng: pairs[0][1] - 0.002,
              maxLng: pairs[0][1] + 0.002,
            }
          : computeBounds(points);
        if (!bounds) {
          return;
        }
        const { minLat, maxLat, minLng, maxLng } = bounds;

        // Draw the route using DC33's LINEAR lat/lng → canvas scaling (NOT
        // mercator-projected onto the tile — DC33 fidelity).
        const drawPolyline = () => {
          const latRange = maxLat - minLat || 0.001;
          const lngRange = maxLng - minLng || 0.001;

          const scaleX = (width - 2 * padding) / lngRange;
          const scaleY = (height - 2 * padding) / latRange;
          const scale = Math.min(scaleX, scaleY);

          // Center the route in the canvas.
          const offsetX = (width - lngRange * scale) / 2;
          const offsetY = (height - latRange * scale) / 2;

          const toCanvas = (lat: number, lng: number): [number, number] => {
            const x = (lng - minLng) * scale + offsetX;
            const y = height - ((lat - minLat) * scale + offsetY); // Flip Y axis
            return [x, y];
          };

          // Check-in pin: a single white-ringed green dot at the point, no
          // route stroke, no end marker.
          if (singlePoint) {
            const [px, py] = toCanvas(pairs[0][0], pairs[0][1]);
            const r = showMapTile ? 7 : 5;
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(px, py, r + 2, 0, 2 * Math.PI);
            ctx.fill();
            ctx.fillStyle = '#10B981';
            ctx.beginPath();
            ctx.arc(px, py, r, 0, 2 * Math.PI);
            ctx.fill();
            return;
          }

          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          // White halo under the stroke for contrast on map tiles.
          if (showMapTile) {
            ctx.strokeStyle = 'white';
            ctx.lineWidth = strokeWidth + 4;
            ctx.beginPath();
            const [startX0, startY0] = toCanvas(pairs[0][0], pairs[0][1]);
            ctx.moveTo(startX0, startY0);
            for (let i = 1; i < pairs.length; i++) {
              const [x, y] = toCanvas(pairs[i][0], pairs[i][1]);
              ctx.lineTo(x, y);
            }
            ctx.stroke();
          }

          // Main colored route line.
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = showMapTile ? strokeWidth + 1 : strokeWidth;
          ctx.beginPath();
          const [startX, startY] = toCanvas(pairs[0][0], pairs[0][1]);
          ctx.moveTo(startX, startY);
          for (let i = 1; i < pairs.length; i++) {
            const [x, y] = toCanvas(pairs[i][0], pairs[i][1]);
            ctx.lineTo(x, y);
          }
          ctx.stroke();

          const markerRadius = showMapTile ? 6 : 4;

          // Start marker: white-ringed green dot.
          const [firstX, firstY] = toCanvas(pairs[0][0], pairs[0][1]);
          ctx.fillStyle = 'white';
          ctx.beginPath();
          ctx.arc(firstX, firstY, markerRadius + 1, 0, 2 * Math.PI);
          ctx.fill();
          ctx.fillStyle = '#10B981';
          ctx.beginPath();
          ctx.arc(firstX, firstY, markerRadius, 0, 2 * Math.PI);
          ctx.fill();

          // End marker: white-ringed red dot.
          const lastPoint = pairs[pairs.length - 1];
          const [lastX, lastY] = toCanvas(lastPoint[0], lastPoint[1]);
          ctx.fillStyle = 'white';
          ctx.beginPath();
          ctx.arc(lastX, lastY, markerRadius + 1, 0, 2 * Math.PI);
          ctx.fill();
          ctx.fillStyle = '#EF4444';
          ctx.beginPath();
          ctx.arc(lastX, lastY, markerRadius, 0, 2 * Math.PI);
          ctx.fill();
        };

        // Load the single OSM tile as a background when enabled.
        if (showMapTile) {
          try {
            const { zoom, x, y } = centerTile(bounds);
            const tileUrl = `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;

            const tileImage = new Image();
            tileImage.crossOrigin = 'anonymous';

            tileImage.onload = () => {
              if (isDarkMode) {
                // Same dark-mode filter as the main map, for consistency.
                ctx.filter =
                  'invert(1) hue-rotate(180deg) brightness(1.2) contrast(0.9)';
                ctx.drawImage(tileImage, 0, 0, width, height);
                ctx.filter = 'none'; // Reset before drawing the route.
              } else {
                ctx.drawImage(tileImage, 0, 0, width, height);
              }

              // Semi-transparent wash so the polyline stays legible.
              ctx.fillStyle = isDarkMode
                ? 'rgba(0, 0, 0, 0.2)'
                : 'rgba(255, 255, 255, 0.2)';
              ctx.fillRect(0, 0, width, height);

              drawPolyline();
            };

            // Tile failed → still draw the route (DC33 fallback).
            tileImage.onerror = () => {
              drawPolyline();
            };

            tileImage.src = tileUrl;
          } catch (error) {
            console.error('Error loading map tile:', error);
            drawPolyline();
          }
        } else {
          drawPolyline();
        }
      } catch (error) {
        console.error('Error rendering polyline:', error);
      }
    };

    renderPolylineOnly();
  }, [
    pairs,
    points,
    width,
    height,
    strokeColor,
    strokeWidth,
    padding,
    showMapTile,
    isDarkMode,
  ]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={`rounded-lg border ${
        isDarkMode
          ? 'border-default-600 bg-default-900'
          : 'border-default-200 bg-default-50'
      }`}
      style={{ maxWidth: '100%', height: 'auto' }}
    />
  );
}
