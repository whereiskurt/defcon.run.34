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
import { Activity, Search, X } from 'lucide-react';
import PolylineRenderer from './PolylineRenderer';
import { deriveCountChips, runnerClassEmoji } from '@/lib/leaderboard-ui';
import type { CtfLine, SocialDayLine } from '@/lib/leaderboard-drill';

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

/** One accomplishment — the exact shape from GET /api/leaderboard/[userId]/accomplishments. */
type Accomplishment = {
  type: string;
  source: 'checkin' | 'gpx' | 'strava';
  name: string;
  description?: string;
  completedAt: number;
  year: number;
  metadata?: {
    polyline?: { lat: number; lng: number }[];
    distance?: number;
    elevation?: number;
    stravaActivityId?: string;
    gpxFileId?: string;
    checkInId?: string;
    [k: string]: unknown;
  };
};

/** `social` shape from the drill response — a runner's social-scan rollup + jack-egg. */
type SocialSummary = {
  days: SocialDayLine[];
  egg: { points: number; at?: string } | null;
};

/** The full per-user drill payload (Task 5): runs + social + CTF. */
type Drill = {
  accomplishments: Accomplishment[];
  social: SocialSummary;
  ctf: CtfLine[];
};

const EMPTY_SOCIAL: SocialSummary = { days: [], egg: null };

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

/** Drill section header: bold label + hairline rule + optional totals chip. */
function SectionHeading({ label, chip }: { label: string; chip?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <h5 className="text-xs font-semibold uppercase tracking-widest text-default-600">
        {label}
      </h5>
      <div className="h-px flex-1 bg-default-300" aria-hidden="true" />
      {chip}
    </div>
  );
}

/** Icon-square tints per card tone. */
const TONE_BG: Record<'warning' | 'secondary' | 'success', string> = {
  warning: 'bg-warning-400/15',
  secondary: 'bg-secondary-400/15',
  success: 'bg-success-400/15',
};

/** One token card: type icon square, name (+badges), date/time meta under it,
 *  points pill right; optional full-width thumb (run map) below the header. */
function TokenCard({
  icon,
  tone,
  name,
  meta,
  points,
  covert,
  badge,
  thumb,
}: {
  icon: string;
  tone: 'warning' | 'secondary' | 'success';
  name: string;
  meta?: string;
  points: number;
  covert?: boolean;
  badge?: React.ReactNode;
  thumb?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-default-100/60 border border-default-200/60 px-3 py-2">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[15px] ${TONE_BG[tone]}`}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="truncate">{name}</span>
            {badge}
            {covert && (
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-warning-500/60 text-warning-600 dark:text-warning-400">
                covert
              </span>
            )}
          </div>
          {meta && <div className="text-xs text-default-500">{meta}</div>}
        </div>
        <Chip color={tone} variant="flat" size="sm" className="shrink-0">
          +{points} 🥕
        </Chip>
      </div>
      {thumb && <div className="mt-2 pl-11">{thumb}</div>}
    </div>
  );
}

/** epoch-ms → `YYYY-MM-DD HH:MM` (DC33 formatDate, minus seconds). */
function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Semantic color for a run source badge. */
const SOURCE_STYLE: Record<string, string> = {
  strava: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
  gpx: 'bg-primary/10 text-primary',
  checkin: 'bg-success/10 text-success',
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
        const data: {
          accomplishments?: Accomplishment[];
          social?: SocialSummary;
          ctf?: CtfLine[];
        } = await res.json();
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
            const runs = drill?.accomplishments;
            const social = drill?.social ?? EMPTY_SOCIAL;
            const ctf = drill?.ctf ?? [];
            const hasRuns = !!runs && runs.length > 0;
            const hasSocial = social.days.length > 0 || !!social.egg;
            const hasCtf = ctf.length > 0;

            // Section totals (each entry carries its own full date+time).
            const ctfTotal = ctf.reduce((s, c) => s + c.points, 0);
            const socialPts =
              social.days.reduce((s, d) => s + d.points, 0) + (social.egg?.points ?? 0);
            const socialScans = social.days.reduce((s, d) => s + d.count, 0);
            const runsPts = (runs ?? []).reduce(
              (s, r) =>
                s + (typeof r.metadata?.points === 'number' ? r.metadata.points : 1),
              0
            );

            return (
              <AccordionItem
                key={row.userId}
                className={
                  // Full-bleed own-row with a complete green perimeter: the
                  // border hugs the group edge (rows are flush, group px-0) and
                  // the group's rounded overflow clips the corners cleanly.
                  isCurrentUser ? 'border border-green-500/50' : ''
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
                  <div className="flex items-center justify-between w-full py-0.5 px-1 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
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
                        } break-all text-base`}
                      >
                        {displayName}
                      </span>
                    </div>
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
                    <>
                      {hasRuns && (
                        <div className="space-y-1.5">
                          <SectionHeading
                            label="Runs"
                            chip={
                              <Chip color="success" variant="flat" size="sm" className="shrink-0">
                                +{runsPts} 🥕 · {runs!.length === 1 ? '1 run' : `${runs!.length} runs`}
                              </Chip>
                            }
                          />
                          {[...runs!]
                            .sort((a, b) => b.completedAt - a.completedAt)
                            .map((run, idx) => {
                              const polyline = run.metadata?.polyline;
                              // >= 1: a single point is a public check-in pin
                              // (PolylineRenderer draws a dot-on-tile for it).
                              const hasPolyline = Array.isArray(polyline) && polyline.length >= 1;
                              return (
                                <TokenCard
                                  key={idx}
                                  icon={run.source === 'checkin' ? '📍' : '🏃'}
                                  tone="success"
                                  name={run.name}
                                  meta={formatDate(run.completedAt)}
                                  points={
                                    typeof run.metadata?.points === 'number'
                                      ? run.metadata.points
                                      : 1
                                  }
                                  badge={
                                    <span
                                      className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${
                                        SOURCE_STYLE[run.source] ?? 'bg-default-100 text-default-600'
                                      }`}
                                    >
                                      {run.source === 'strava' && <Activity className="h-3 w-3" />}
                                      {run.source.toUpperCase()}
                                    </span>
                                  }
                                  thumb={
                                    hasPolyline ? (
                                      <PolylineRenderer
                                        points={polyline!}
                                        theme={theme}
                                        width={200}
                                        height={120}
                                      />
                                    ) : undefined
                                  }
                                />
                              );
                            })}
                        </div>
                      )}

                      {hasSocial && (
                        <div className="space-y-1.5">
                          <SectionHeading
                            label="Social"
                            chip={
                              <Chip color="secondary" variant="flat" size="sm" className="shrink-0">
                                +{socialPts} 🥕 · {socialScans === 1 ? '1 scan' : `${socialScans} scans`}
                              </Chip>
                            }
                          />
                          {social.days.map((d) => (
                            <TokenCard
                              key={d.day}
                              icon="📇"
                              tone="secondary"
                              name={`Social scans ×${d.count}`}
                              meta={d.day}
                              points={d.points}
                            />
                          ))}
                          {social.egg && (
                            <TokenCard
                              icon="🔌"
                              tone="secondary"
                              name="DC Jack egg"
                              meta={
                                social.egg.at
                                  ? formatDate(Date.parse(social.egg.at))
                                  : undefined
                              }
                              points={social.egg.points}
                            />
                          )}
                        </div>
                      )}

                      {hasCtf && (
                        <div className="space-y-1.5">
                          <SectionHeading
                            label="CTF"
                            chip={
                              <Chip color="warning" variant="flat" size="sm" className="shrink-0">
                                +{ctfTotal} 🥕 · {ctf.length === 1 ? '1 solve' : `${ctf.length} solves`}
                              </Chip>
                            }
                          />
                          {ctf.map((c, idx) => (
                            <TokenCard
                              key={`${c.challenge}-${idx}`}
                              icon="🚩"
                              tone="warning"
                              name={c.name}
                              meta={c.at ? formatDate(Date.parse(c.at)) : undefined}
                              points={c.points}
                              covert={c.channel === 'covert'}
                            />
                          ))}
                        </div>
                      )}

                      {!hasRuns && !hasSocial && !hasCtf && (
                        <p className="text-default-500 text-sm p-2">No runs yet.</p>
                      )}
                    </>
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
