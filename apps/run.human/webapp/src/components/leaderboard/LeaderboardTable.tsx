'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import {
  Accordion,
  AccordionItem,
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Input,
  Pagination,
  Spinner,
} from '@heroui/react';
import { Search, X } from 'lucide-react';
import RunnerDrill, { EMPTY_SOCIAL, type Drill } from './RunnerDrill';
import { deriveCountChips, runnerClassEmoji } from '@/lib/leaderboard-ui';

/**
 * LeaderboardTable — the interactive heart of the (hidden) admin board (LDBR-10,
 * Phase 52). A faithful port of DC33's `LeaderboardTable`, adapted to the
 * Phase-51 API AS SHIPPED (no backend change here).
 *
 * A HeroUI `Accordion selectionMode="multiple" variant="bordered" isCompact`
 * where each row is a runner (rank / `globalScore` 🥕 / displayName + class emoji
 * / count chips). The current admin's OWN row is highlighted (DC33 green). A
 * keyword search + fast-filter chips narrow the page; pagination pages the full
 * set (default 25). Expanding a row lazy-fetches that runner's accomplishments
 * and renders each run with a `PolylineRenderer` thumbnail from
 * `metadata.polyline` (plan 01).
 *
 * ── basePath landmine ───────────────────────────────────────────────────────
 * EVERY fetch is `${apiBase}/api/leaderboard...`. `apiBase` is the region prefix
 * the server page passes in (`/use1` in prod, '' in dev). A bare `/api/...`
 * 404s in prod because Next.js `basePath` strips the region segment — mirror
 * AdminConsole's apiBase pattern exactly.
 */

/** One leaderboard row — the exact `LeaderboardRow` DTO from GET /api/leaderboard. */
type LeaderboardRow = {
  globalRank: number;
  userId: string;
  displayName?: string;
  mqttUsertype?: 'rabbit' | 'admin' | 'wildhare' | 'og';
  globalScore: number;
  activityCounts: { checkin: number; gpx: number };
  ctfSolves: number;
};

/* Accomplishment / SocialSummary / Drill / EMPTY_SOCIAL now live in
   ./RunnerDrill, shared with the profile's "Your standing" modal. */

type LeaderboardTableProps = {
  /** The current admin's session.user.id — used to highlight their own row. */
  currentUserId: string;
  /** Region prefix from the server page (prod '/use1', dev ''). */
  apiBase: string;
};

const PAGE_SIZE = 25;

/** DC33 accordion item classes (parity). */
const itemClasses = {
  base: 'p-0',
  title: 'p-0 text-current',
  subtitle: 'p-0',
  indicator: 'text-2xl',
  // px moved into the rows (trigger/content) because the group is px-0 so
  // full-bleed row fills can reach the group border.
  trigger: 'px-3',
  content: 'text-lg px-1',
};

export default function LeaderboardTable({ currentUserId, apiBase }: LeaderboardTableProps) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light';

  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [filter, setFilter] = useState('');
  // "Named only" — hide runners still on the default rabbit_ name. ON by default.
  const [namedOnly, setNamedOnly] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [drills, setDrills] = useState<Record<string, Drill>>({});
  const [loadingAccomplishments, setLoadingAccomplishments] = useState<Set<string>>(new Set());

  // ── Board fetch: on mount + whenever page/filter changes (basePath-prefixed) ──
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(PAGE_SIZE),
          ...(filter ? { filter } : {}),
          ...(namedOnly ? { named: '1' } : {}),
        });
        const res = await fetch(`${apiBase}/api/leaderboard?${params}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data: { rows: LeaderboardRow[]; total: number; page: number; limit: number } =
          await res.json();
        if (cancelled) return;
        setRows(data.rows ?? []);
        setTotal(data.total ?? 0);
        setLimit(data.limit ?? PAGE_SIZE);
      } catch {
        if (!cancelled) setError('Failed to load leaderboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [apiBase, page, filter, namedOnly]);

  // ── Lazy per-runner accomplishments fetch (cache once by userId) ─────────────
  const fetchUserAccomplishments = useCallback(
    async (userId: string) => {
      if (drills[userId]) return;
      setLoadingAccomplishments((prev) => new Set(prev).add(userId));
      try {
        const res = await fetch(`${apiBase}/api/leaderboard/${userId}/accomplishments`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(String(res.status));
        // Back-compat: older/partial cached responses may omit `social`/`ctf` —
        // treat missing sections as empty rather than throwing.
        const data: Partial<Drill> = await res.json();
        setDrills((prev) => ({
          ...prev,
          [userId]: {
            accomplishments: data.accomplishments ?? [],
            social: data.social ?? EMPTY_SOCIAL,
            ctf: data.ctf ?? [],
          },
        }));
      } catch {
        setDrills((prev) => ({
          ...prev,
          [userId]: { accomplishments: [], social: EMPTY_SOCIAL, ctf: [] },
        }));
      } finally {
        setLoadingAccomplishments((prev) => {
          const next = new Set(prev);
          next.delete(userId);
          return next;
        });
      }
    },
    [apiBase, drills]
  );

  const runSearch = () => {
    setFilter(searchInput.trim());
    setPage(1);
  };
  const clearSearch = () => {
    setSearchInput('');
    setFilter('');
    setPage(1);
  };
  const fastFilter = (value: string) => {
    setSearchInput(value);
    setFilter(value);
    setPage(1);
  };

  // The current admin's own displayName, if their row is on the loaded page.
  const currentUserName = useMemo(
    () => rows.find((r) => r.userId === currentUserId)?.displayName ?? '',
    [rows, currentUserId]
  );

  const totalPages = Math.max(1, Math.ceil(total / (limit || PAGE_SIZE)));

  return (
    <div className="w-full space-y-2">
      {/* ── Search + fast-filter chips ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="py-2">
          <div className="flex flex-col gap-2 w-full">
            <div className="flex gap-2 items-center">
              <Input
                placeholder="Keyword Search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                startContent={<Search className="h-4 w-4" />}
                endContent={
                  (searchInput.length > 0 || filter.length > 0) && (
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      onClick={clearSearch}
                      className="min-w-6 w-6 h-6"
                      title="Clear search"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )
                }
                className="flex-1"
                variant="bordered"
              />
              <Button
                size="md"
                variant="solid"
                color="primary"
                onClick={runSearch}
                className="px-4 shrink-0"
                isDisabled={searchInput.trim().length === 0}
              >
                Search
              </Button>
            </div>
            <div className="flex justify-start gap-2 flex-wrap">
              <Chip
                size="sm"
                variant={namedOnly ? 'solid' : 'bordered'}
                color="primary"
                className="cursor-pointer"
                onClick={() => {
                  setNamedOnly((v) => !v);
                  setPage(1);
                }}
                title={
                  namedOnly
                    ? 'Showing only runners who set a name - click to include default rabbit_ names'
                    : 'Showing everyone - click to hide default rabbit_ names'
                }
              >
                🏷️ Named{namedOnly ? ' ✓' : ''}
              </Chip>
              {currentUserName && (
                <Chip
                  size="sm"
                  variant="flat"
                  color="success"
                  className="cursor-pointer"
                  onClick={() => fastFilter(currentUserName)}
                >
                  {currentUserName} (you!)
                </Chip>
              )}
              <Chip
                size="sm"
                variant="flat"
                color="warning"
                className="cursor-pointer"
                onClick={() => fastFilter('wildhare')}
              >
                ⭐️ Wild Hares
              </Chip>
              <Chip
                size="sm"
                variant="flat"
                color="secondary"
                className="cursor-pointer"
                onClick={() => fastFilter('og')}
              >
                🤠 OG
              </Chip>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* ── The board ───────────────────────────────────────────────────────── */}
      {loading ? (
        <Card>
          <CardBody className="flex flex-row items-center justify-center gap-2 py-8">
            <Spinner size="sm" />
            <span className="text-sm text-default-500">Loading leaderboard…</span>
          </CardBody>
        </Card>
      ) : error ? (
        <Card>
          <CardBody>
            <p className="text-danger text-center p-4">{error}</p>
          </CardBody>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-default-500 text-center p-4">No runners match this search.</p>
          </CardBody>
        </Card>
      ) : (
        <Accordion
          selectionMode="multiple"
          variant="bordered"
          isCompact
          itemClasses={itemClasses}
          // px-0 kills the bordered variant's px-4 channel so rows run flush to
          // the group border; overflow-hidden clips full-bleed row fills to the
          // group's rounded corners (UAT: own-row green spans the whole card).
          className="gap-0 px-0 overflow-hidden"
          onSelectionChange={(keys) => {
            Array.from(keys).forEach((key) => fetchUserAccomplishments(String(key)));
          }}
        >
          {rows.map((row) => {
            const isCurrentUser = row.userId === currentUserId;
            const displayName = `${row.displayName ?? '—'}${
              runnerClassEmoji(row.mqttUsertype) ? ` ${runnerClassEmoji(row.mqttUsertype)}` : ''
            }`;
            const chips = deriveCountChips(row);
            const drill = drills[row.userId];

            return (
              <AccordionItem
                key={row.userId}
                className={
                  // Full-bleed own-row with a complete green perimeter; every
                  // other row gets an explicit bottom hairline so runners stay
                  // visibly separated in BOTH themes (UAT: "no separators").
                  isCurrentUser
                    ? 'border border-green-500/50'
                    : 'border-b border-default-200 last:border-b-0'
                }
                classNames={
                  // Own-row highlight tints the HEADER ROW ONLY - the expanded
                  // drill content stays on the default surface so its muted
                  // greys/rails/thumbnails keep their contrast (UAT 2026-07-24).
                  // Tint the full-width `heading` slot (not the inset trigger)
                  // so the fill meets the item border with no dark gap.
                  isCurrentUser
                    ? { heading: 'bg-green-400/20 dark:bg-green-500/30' }
                    : undefined
                }
                textValue={`${displayName} accomplishments`}
                title={
                  <div className="flex items-center flex-wrap w-full py-0.5 px-1 gap-2">
                    <span className="text-lg font-bold text-default-500 shrink-0">
                      #{row.globalRank}
                    </span>
                    {row.globalScore > 0 && (
                      <Chip
                        className="bg-foreground text-background border-foreground shrink-0"
                        variant="bordered"
                        size="sm"
                      >
                        {row.globalScore} 🥕
                      </Chip>
                    )}
                    <span
                      className={`${
                        isCurrentUser ? 'text-green-800 dark:text-green-200 font-medium' : ''
                      } break-all text-base min-w-0`}
                    >
                      {displayName}
                    </span>
                    {/* Count chips sit WITH the name, not pushed to the far
                        edge (UAT: dead gap on desktop). */}
                    <div className="flex items-center gap-1 shrink-0">
                      {chips.map((chip) => (
                        <Chip key={chip.key} color={chip.color} variant="flat" size="sm">
                          {chip.count}
                        </Chip>
                      ))}
                    </div>
                  </div>
                }
              >
                <div className="space-y-2 px-2 pb-2">
                  {loadingAccomplishments.has(row.userId) ? (
                    <div className="flex items-center justify-center p-2 gap-2">
                      <Spinner size="sm" />
                      <span className="text-sm text-default-500">Loading runs…</span>
                    </div>
                  ) : drill ? (
                    <RunnerDrill drill={drill} theme={theme} />
                  ) : (
                    <p className="text-default-500 text-sm p-2">Expand to load runs…</p>
                  )}
                </div>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {/* ── Pagination ──────────────────────────────────────────────────────── */}
      {!loading && !error && totalPages > 1 && (
        <div className="flex justify-center mt-2">
          <Pagination
            total={totalPages}
            page={page}
            onChange={setPage}
            showControls
            showShadow
            color="primary"
          />
        </div>
      )}
    </div>
  );
}
