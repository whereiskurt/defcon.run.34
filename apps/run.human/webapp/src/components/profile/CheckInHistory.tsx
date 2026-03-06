'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTheme } from 'next-themes';
import { Card, CardBody, Chip, Pagination, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, useDisclosure } from '@heroui/react';
import { ChevronDown, ChevronRight, Trash2, Plus } from 'lucide-react';
import CheckInModal from '@/components/CheckInModal';
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
  checkinPreference?: string;
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

function formatDateTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * Compute relative age colors for a set of check-ins.
 * Newest on the page = bright #006FEE, oldest = dark #1a3a6e.
 * Private check-ins always return gray.
 */
function relativeAgeColors(checkIns: CheckInItem[]): Map<string, string> {
  const colors = new Map<string, string>();
  const timestamps = checkIns.filter(c => !c.isPrivate).map(c => c.timestamp);
  const newest = Math.max(...timestamps, 0);
  const oldest = Math.min(...timestamps, 0);
  const range = newest - oldest;

  for (const c of checkIns) {
    if (c.isPrivate) {
      colors.set(c.checkInId, '#71717a');
    } else {
      // t=0 for newest (bright), t=1 for oldest (dark). If all same time, all bright.
      const t = range > 0 ? (newest - c.timestamp) / range : 0;
      const r = Math.round(0 + t * 26);
      const g = Math.round(111 - t * 53);
      const b = Math.round(238 - t * 128);
      colors.set(c.checkInId, `rgb(${r},${g},${b})`);
    }
  }
  return colors;
}

/** Safely extract lat/lng as numbers with fallback */
function getCoords(checkin: CheckInItem): [number, number] {
  return [
    checkin.averageCoordinates.latitude ?? 0,
    checkin.averageCoordinates.longitude ?? 0,
  ];
}

function makeNumberedIcon(number: number, color: string) {
  if (typeof window === 'undefined') return undefined;
  const L = require('leaflet');
  return L.divIcon({
    html: `<div style="background:${color};width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:12px;border:2px solid white">${number}</div>`,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

const TILES_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILES_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

export default function CheckInHistory({ checkInCount, checkinPreference }: CheckInHistoryProps) {
  const { resolvedTheme } = useTheme();
  const tileUrl = resolvedTheme === 'dark' ? TILES_DARK : TILES_LIGHT;
  const [isOpen, setIsOpen] = useState(true);
  const [checkIns, setCheckIns] = useState<CheckInItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCache, setPageCache] = useState<Map<number, PageCache>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [localCount, setLocalCount] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; number: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
  const [isCheckInOpen, setIsCheckInOpen] = useState(false);
  const mapRef = useRef<any>(null);
  const markerRefs = useRef<Map<string, any>>(new Map());
  const autoSelectNewest = useRef(false);

  const effectiveCount = localCount ?? checkInCount;
  const totalPages = Math.ceil(effectiveCount / 5);
  const PAGE_SIZE = 5;
  const colorMap = useMemo(() => relativeAgeColors(checkIns), [checkIns]);

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
      autoSelectNewest.current = true;
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

    // After a new check-in, auto-select the newest (first item) to zoom into it
    if (autoSelectNewest.current && checkIns.length > 0) {
      autoSelectNewest.current = false;
      setSelectedId(checkIns[0].checkInId);
      return; // selectedId effect will handle zoom
    }

    const L = typeof window !== 'undefined' ? require('leaflet') : null;
    if (!L) return;

    const bounds = L.latLngBounds(
      checkIns.map((c) => getCoords(c))
    );
    mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [checkIns]);

  // Jump to selected marker at max zoom — instant, no animation
  useEffect(() => {
    if (!selectedId || !mapRef.current) return;
    const checkin = checkIns.find((c) => c.checkInId === selectedId);
    if (!checkin) return;

    // Reset all z-indexes first, then raise selected
    markerRefs.current.forEach((ref, id) => {
      ref.setZIndexOffset(id === selectedId ? 1000 : 0);
    });

    mapRef.current.setView(getCoords(checkin), 18, { animate: false });

    // Open popup after view settles
    const markerRef = markerRefs.current.get(selectedId);
    if (markerRef) {
      markerRef.openPopup();
    }

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

  const confirmDelete = (checkInId: string, number: number) => {
    setDeleteTarget({ id: checkInId, number });
    onDeleteOpen();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(apiUrl(`/api/checkins?checkinId=${encodeURIComponent(deleteTarget.id)}`), {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Delete failed');
      setLocalCount((prev) => Math.max(0, (prev ?? checkInCount) - 1));
      setPageCache(new Map());
      setSelectedId(null);
      onDeleteClose();
    } catch (err) {
      console.error('Error deleting check-in:', err);
    } finally {
      setDeleting(false);
    }
  };

  // Las Vegas center for empty state
  const LAS_VEGAS: [number, number] = [36.17, -115.14];

  return (
    <Card className="glass-card overflow-hidden">
      <CardBody className="px-5 py-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-2 text-left cursor-pointer hover:opacity-80 transition-opacity"
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
          <Button
            isIconOnly
            color="primary"
            variant="flat"
            size="lg"
            onPress={() => setIsCheckInOpen(true)}
          >
            <Plus className="h-6 w-6" />
          </Button>
        </div>

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
                  url={tileUrl}
                />
                {checkIns.map((checkin, index) => {
                  const number = getItemNumber(index);
                  const color = colorMap.get(checkin.checkInId) ?? '#006FEE';
                  const icon = makeNumberedIcon(number, color);

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
                            <div className="text-xs opacity-70">{formatDateTime(checkin.timestamp)}</div>
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
                    <div
                      key={checkin.checkInId}
                      id={`checkin-row-${checkin.checkInId}`}
                      onClick={() => setSelectedId(checkin.checkInId)}
                      className={`flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary/10' : 'hover:bg-default-100'
                      }`}
                    >
                      <span
                        className="font-mono text-sm font-bold min-w-[3ch] text-right"
                        style={{ color: colorMap.get(checkin.checkInId) ?? '#006FEE' }}
                      >
                        #{number}
                      </span>
                      <span className="flex flex-col leading-tight">
                        <span className="text-xs text-default-500">{formatRelativeTime(checkin.timestamp)}</span>
                        <span className="text-[10px] text-default-400">{formatDateTime(checkin.timestamp)}</span>
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
                      <button
                        onClick={(e) => { e.stopPropagation(); confirmDelete(checkin.checkInId, number); }}
                        className="p-1 rounded-md text-default-400 hover:text-danger hover:bg-danger/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
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

      {/* Delete confirmation modal */}
      <Modal isOpen={isDeleteOpen} onClose={onDeleteClose} backdrop="blur" size="sm">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            Delete Check-in
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-600">
              Are you sure you want to delete <span className="font-bold text-foreground">Check-in #{deleteTarget?.number}</span>? This action cannot be undone.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onDeleteClose} size="sm">
              Cancel
            </Button>
            <Button color="danger" onPress={handleDelete} isLoading={deleting} size="sm">
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Check-in modal */}
      <CheckInModal
        isOpen={isCheckInOpen}
        onClose={() => setIsCheckInOpen(false)}
        checkinPreference={checkinPreference}
      />
    </Card>
  );
}
