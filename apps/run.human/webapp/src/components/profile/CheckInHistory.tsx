'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardBody, Chip, Pagination } from '@heroui/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { apiUrl } from '@/lib/api';
import dynamic from 'next/dynamic';
import type { CheckInItem } from '@/entities/checkin';
import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css';

// Dynamic imports for react-leaflet to avoid SSR issues
const MapContainer = dynamic(
  () => import('react-leaflet').then((m) => m.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import('react-leaflet').then((m) => m.TileLayer),
  { ssr: false }
);
const Marker = dynamic(
  () => import('react-leaflet').then((m) => m.Marker),
  { ssr: false }
);
const Circle = dynamic(
  () => import('react-leaflet').then((m) => m.Circle),
  { ssr: false }
);
const Popup = dynamic(
  () => import('react-leaflet').then((m) => m.Popup),
  { ssr: false }
);

// MapBoundsUpdater needs useMap which requires being inside MapContainer
// We'll use a different approach with the map ref

interface PageCache {
  data: CheckInItem[];
  cursor: string | null;
}

interface CheckInHistoryProps {
  checkInCount: number;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months !== 1 ? 's' : ''} ago`;
}

/** Safely extract lat/lng as numbers with fallback */
function getCoords(checkin: CheckInItem): [number, number] {
  return [
    checkin.averageCoordinates.latitude ?? 0,
    checkin.averageCoordinates.longitude ?? 0,
  ];
}

function makeNumberedIcon(number: number, isPrivate: boolean) {
  if (typeof window === 'undefined') return undefined;
  const L = require('leaflet');
  const color = isPrivate ? '#71717a' : '#006FEE';
  return L.divIcon({
    html: `<div style="background:${color};width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:12px;border:2px solid white">${number}</div>`,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

export default function CheckInHistory({ checkInCount }: CheckInHistoryProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [checkIns, setCheckIns] = useState<CheckInItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCache, setPageCache] = useState<Map<number, PageCache>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [localCount, setLocalCount] = useState<number | null>(null);
  const mapRef = useRef<any>(null);
  const markerRefs = useRef<Map<string, any>>(new Map());

  const effectiveCount = localCount ?? checkInCount;
  const totalPages = Math.ceil(effectiveCount / 5);
  const PAGE_SIZE = 5;

  useEffect(() => {
    setMounted(true);
    require('leaflet-defaulticon-compatibility');
  }, []);

  // Listen for new check-ins and refresh
  useEffect(() => {
    const handleNewCheckIn = () => {
      setLocalCount((prev) => (prev ?? checkInCount) + 1);
      setPageCache(new Map());
      setCurrentPage(1);
      setSelectedId(null);
    };
    window.addEventListener('checkin-created', handleNewCheckIn);
    return () => window.removeEventListener('checkin-created', handleNewCheckIn);
  }, [checkInCount]);

  const fetchPage = useCallback(async (page: number) => {
    // Check cache first
    const cached = pageCache.get(page);
    if (cached) {
      setCheckIns(cached.data);
      return;
    }

    // For page > 1, we need the cursor from the previous page
    if (page > 1) {
      const prevCached = pageCache.get(page - 1);
      if (!prevCached || prevCached.cursor === null) {
        // Can't fetch this page without previous cursor
        return;
      }
    }

    setLoading(true);
    try {
      let url = apiUrl(`/api/checkins?limit=${PAGE_SIZE}`);
      if (page > 1) {
        const prevCached = pageCache.get(page - 1);
        if (prevCached?.cursor) {
          url += `&cursor=${encodeURIComponent(prevCached.cursor)}`;
        }
      }

      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(`GET ${url} → ${response.status}`, body);
        throw new Error(`Failed to fetch check-ins: ${response.status}`);
      }
      const result = await response.json();

      const newCache = new Map(pageCache);
      newCache.set(page, { data: result.data, cursor: result.cursor });
      setPageCache(newCache);
      setCheckIns(result.data);
    } catch (err) {
      console.error('Error fetching check-ins:', err);
    } finally {
      setLoading(false);
    }
  }, [pageCache]);

  // Fetch first page on mount or when cache is cleared (new check-in)
  useEffect(() => {
    if (effectiveCount > 0 && mounted && pageCache.size === 0) {
      fetchPage(1);
    }
  }, [effectiveCount, mounted, pageCache.size]);

  // Fit map bounds when check-ins change
  useEffect(() => {
    if (!mapRef.current || checkIns.length === 0) return;
    const L = typeof window !== 'undefined' ? require('leaflet') : null;
    if (!L) return;

    const bounds = L.latLngBounds(
      checkIns.map((c) => getCoords(c))
    );
    mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [checkIns]);

  // Fly to selected marker at max zoom so overlapping points separate
  useEffect(() => {
    if (!selectedId || !mapRef.current) return;
    const checkin = checkIns.find((c) => c.checkInId === selectedId);
    if (!checkin) return;

    mapRef.current.flyTo(getCoords(checkin), 18, { duration: 0.5 });

    // Raise selected marker above others and open popup
    const markerRef = markerRefs.current.get(selectedId);
    if (markerRef) {
      markerRef.setZIndexOffset(1000);
      markerRef.openPopup();
    }
    // Reset z-index on other markers
    markerRefs.current.forEach((ref, id) => {
      if (id !== selectedId) ref.setZIndexOffset(0);
    });

    // Scroll list row into view
    document.getElementById(`checkin-row-${selectedId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }, [selectedId, checkIns]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    setSelectedId(null);
    fetchPage(page);
  };

  const getItemNumber = (index: number): number => {
    return effectiveCount - ((currentPage - 1) * PAGE_SIZE) - index;
  };

  const handleMarkerClick = (checkInId: string) => {
    setSelectedId(checkInId);
  };

  // Las Vegas center for empty state
  const LAS_VEGAS: [number, number] = [36.17, -115.14];

  return (
    <Card className="glass-card overflow-hidden">
      <CardBody className="px-5 py-3">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 w-full text-left cursor-pointer hover:opacity-80 transition-opacity"
        >
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-default-400" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-default-400" />
          )}
          <span className="font-museo text-base font-bold text-foreground">
            Check-ins ({effectiveCount})
          </span>
        </button>

        {isOpen && mounted && (
          <div className="space-y-3 mt-3">
            {/* Map */}
            <div className="relative rounded-lg overflow-hidden" style={{ height: 350 }}>
              <MapContainer
                center={checkIns.length > 0 ? getCoords(checkIns[0]) : LAS_VEGAS}
                zoom={checkIns.length > 0 ? 13 : 12}
                style={{ height: '100%', width: '100%' }}
                ref={mapRef}
              >
                <TileLayer
                  attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                />
                {checkIns.map((checkin, index) => {
                  const number = getItemNumber(index);
                  const color = checkin.isPrivate ? '#71717a' : '#006FEE';
                  const icon = makeNumberedIcon(number, checkin.isPrivate ?? false);

                  return (
                    <span key={checkin.checkInId}>
                      <Marker
                        position={getCoords(checkin)}
                        icon={icon}
                        ref={(ref: any) => {
                          if (ref) markerRefs.current.set(checkin.checkInId, ref);
                        }}
                        eventHandlers={{
                          click: () => handleMarkerClick(checkin.checkInId),
                        }}
                      >
                        <Popup>
                          <div className="text-sm space-y-1">
                            <div className="font-bold">Check-in #{number}</div>
                            <div>{formatRelativeTime(checkin.timestamp)}</div>
                            <div>Accuracy: +/-{Math.round(checkin.bestAccuracy)}m</div>
                            <div>{checkin.isPrivate ? 'Private' : 'Public'}</div>
                          </div>
                        </Popup>
                      </Marker>
                      <Circle
                        center={getCoords(checkin)}
                        radius={checkin.bestAccuracy}
                        pathOptions={{
                          color,
                          fillColor: color,
                          fillOpacity: 0.15,
                          weight: 1,
                        }}
                      />
                    </span>
                  );
                })}
              </MapContainer>

              {/* Empty state overlay */}
              {effectiveCount === 0 && (
                <div className="absolute inset-0 flex items-center justify-center z-[1000] pointer-events-none">
                  <div className="bg-black/70 text-white text-sm px-4 py-3 rounded-lg text-center max-w-[280px]">
                    No check-ins yet -- use GPS Check-in from the menu to get started
                  </div>
                </div>
              )}

              {/* Loading overlay */}
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center z-[1000] bg-black/30">
                  <div className="text-white text-sm">Loading...</div>
                </div>
              )}
            </div>

            {/* Check-in list */}
            {effectiveCount > 0 && (
              <div className="space-y-1">
                {checkIns.map((checkin, index) => {
                  const number = getItemNumber(index);
                  const isSelected = selectedId === checkin.checkInId;

                  return (
                    <button
                      key={checkin.checkInId}
                      id={`checkin-row-${checkin.checkInId}`}
                      onClick={() => setSelectedId(checkin.checkInId)}
                      className={`flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary/10' : 'hover:bg-default-100'
                      }`}
                    >
                      <span className="font-mono text-sm font-bold text-foreground min-w-[3ch] text-right">
                        #{number}
                      </span>
                      <span className="text-xs text-default-500">
                        {formatRelativeTime(checkin.timestamp)}
                      </span>
                      <span className="text-xs text-default-400">
                        +/-{Math.round(checkin.bestAccuracy)}m
                      </span>
                      <Chip
                        size="sm"
                        variant="flat"
                        color={checkin.isPrivate ? 'default' : 'primary'}
                        classNames={{ base: 'ml-auto text-xs' }}
                      >
                        {checkin.isPrivate ? 'Private' : 'Public'}
                      </Chip>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center pt-1">
                <Pagination
                  total={totalPages}
                  page={currentPage}
                  onChange={handlePageChange}
                  showControls
                  size="sm"
                />
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
