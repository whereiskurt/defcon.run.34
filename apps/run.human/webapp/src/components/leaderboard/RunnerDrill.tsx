'use client';

import { Chip } from '@heroui/react';
import { streakPoints } from '@/lib/con-days';
import { conDayCount, sectionTotal } from '@/lib/leaderboard-drill';
import { Activity } from 'lucide-react';
import PolylineRenderer from './PolylineRenderer';
import type { CtfLine, SocialDayLine } from '@/lib/leaderboard-drill';

/**
 * RunnerDrill — one runner's Runs / Social / CTF breakdown.
 *
 * Lifted out of `LeaderboardTable` so the SAME markup serves both drill
 * surfaces and they cannot drift apart:
 *   - the admin board's expanded accordion row, and
 *   - the profile's self-scoped "Your standing" modal.
 *
 * Presentation only — the caller owns fetching, gating, and empty/loading
 * states. Behaviour here is unchanged by the extraction.
 */

/** One accomplishment as the drill APIs return it. */
export type Accomplishment = {
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

/** A runner's social-scan rollup + jack-egg. */
export type SocialSummary = {
  days: SocialDayLine[];
  egg: { points: number; at?: string } | null;
};

export const EMPTY_SOCIAL: SocialSummary = { days: [], egg: null };

/** One group check-in bonus. `counted: false` = dropped by the per-day cap. */
export type ClusterLine = {
  startAt: number;
  day: string;
  size: number;
  points: number;
  counted: boolean;
};

/** The full per-runner drill payload. */
export type Drill = {
  accomplishments: Accomplishment[];
  social: SocialSummary;
  ctf: CtfLine[];
  /** Absent on payloads cached before the cluster feature shipped. */
  cluster?: ClusterLine[];
};

/** epoch-ms → `YYYY-MM-DD HH:MM` (DC33 formatDate, minus seconds). */
export function formatDate(timestamp: number): string {
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

/** Icon-square tints per card tone. */
const TONE_BG: Record<'warning' | 'secondary' | 'success', string> = {
  warning: 'bg-warning-400/15',
  secondary: 'bg-secondary-400/15',
  success: 'bg-success-400/15',
};

/** Left-rail class per card tone (sketch 007 "tone rail" — see globals.css).
 *  The rail colour-codes a card's section so its TYPE is scannable before the
 *  name is read: runs green, social violet, CTF amber. */
const TONE_RAIL: Record<'warning' | 'secondary' | 'success', string> = {
  warning: 'rail-warning',
  secondary: 'rail-secondary',
  success: 'rail-success',
};

/** Drill section header: bold label + hairline rule + optional totals chip. */
export function SectionHeading({ label, chip }: { label: string; chip?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <h5 className="text-xs font-semibold uppercase tracking-widest text-default-600">
        {label}
      </h5>
      {chip}
      <div className="h-px flex-1 bg-default-300" aria-hidden="true" />
    </div>
  );
}

/** One token card: type icon square, name (+badges), date/time meta under it,
 *  points pill right; optional full-width thumb (run map) below the header. */
export function TokenCard({
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
    <div className={`drill-card ${TONE_RAIL[tone]} rounded-lg px-3 py-2`}>
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

/** Points a run contributes — `metadata.points` when present, else 1. */
/**
 * A run's own point value. Almost always 0: accomplishments carry NO points —
 * they only light con-days for the run streak (see lib/bib-pickup.ts).
 *
 * This used to fall back to 1, which INVENTED a carrot per run: a runner with
 * four runs saw "+4 🥕" for points that exist nowhere in their score. The
 * fallback is 0 now; the section chip and streak line carry the real value.
 */
const runPoints = (r: Accomplishment) =>
  typeof r.metadata?.points === 'number' ? r.metadata.points : 0;

/**
 * The streak line under a section heading.
 *
 * WHY IT EXISTS: the per-entry chips in every section are COSMETIC. Runs and
 * social scans carry no points at all (accomplishments only light con-days;
 * `social-scan` events are written with `points: 0`), so a runner with a full
 * streak sees a column of "+0 🥕" and concludes the board is broken — which is
 * exactly how this got reported. The real value of those two tracks arrives as
 * a streak bonus, and this is the only place that says so.
 */
function StreakLine({ days, kind }: { days: number; kind: 'run' | 'social' | 'CTF' }) {
  if (days === 0) return null;
  const pts = streakPoints(days);
  return (
    <p className="text-[11px] text-default-500 pl-0.5">
      🔥 {days} con {days === 1 ? 'day' : 'days'} of {kind} activity
      {pts > 0 ? (
        <>
          {' '}
          → <span className="text-success font-medium">+{pts} 🥕</span> streak bonus
        </>
      ) : null}
      {days < 4 ? (
        <span className="text-default-400"> · {4 - days} more for the max 500</span>
      ) : null}
    </p>
  );
}

/**
 * The three drill sections (Runs / Social / CTF) for one runner. Each section
 * renders only when it has content; when all three are empty the caller's
 * `emptyLabel` shows instead.
 */
export default function RunnerDrill({
  drill,
  theme,
  emptyLabel = 'No runs yet.',
}: {
  drill: Drill;
  theme: 'light' | 'dark';
  emptyLabel?: string;
}) {
  const runs = drill.accomplishments ?? [];
  const social = drill.social ?? EMPTY_SOCIAL;
  const ctf = drill.ctf ?? [];
  const cluster = drill.cluster ?? [];

  const hasRuns = runs.length > 0;
  const hasSocial = social.days.length > 0 || !!social.egg;
  const hasCtf = ctf.length > 0;
  const hasCluster = cluster.length > 0;

  // Only COUNTED awards contribute — capped-out ones still render, greyed, so
  // the total is explainable rather than mysteriously short.
  const clusterTotal = cluster.reduce((s, c) => s + (c.counted ? c.points : 0), 0);

  // Section totals (each entry carries its own full date+time).
  const ctfTotal = ctf.reduce((s, c) => s + c.points, 0);
  const socialPts =
    social.days.reduce((s, d) => s + d.points, 0) + (social.egg?.points ?? 0);
  const socialScans = social.days.reduce((s, d) => s + d.count, 0);
  const runsPts = runs.reduce((s, r) => s + runPoints(r), 0);

  // Distinct con days per track — the input to the streak bonus. Derived from
  // the SAME entries rendered below, so the line can never disagree with what
  // the runner is looking at.
  const runConDays = conDayCount(runs.map((r) => r.completedAt));
  const socialConDays = conDayCount(social.days.map((d) => d.day));
  const ctfConDays = conDayCount(ctf.map((c) => c.at));

  // What each section ACTUALLY contributes to the runner's score = its own
  // entry points PLUS that track's streak bonus. Runs and social entries are
  // worth 0 each, so before this their chips read "+0"/"+4" next to a "+500
  // streak bonus" line and contradicted it on sight. These three now sum to the
  // score minus the cluster bonus, instead of to a number that appears nowhere.
  const runsTotal = sectionTotal(runsPts, runConDays);
  const socialTotal = sectionTotal(socialPts, socialConDays);
  const ctfSectionTotal = sectionTotal(ctfTotal, ctfConDays);

  // `hasCluster` belongs in this guard: a cluster-only drill DOES render a
  // section below, so leaving it out would claim "No runs yet." above visible
  // content. Every section that can render must be able to veto the empty state.
  if (!hasRuns && !hasSocial && !hasCtf && !hasCluster) {
    return <p className="text-default-500 text-sm p-2">{emptyLabel}</p>;
  }

  return (
    <>
      {hasRuns && (
        <div className="space-y-1.5">
          <SectionHeading
            label="Runs"
            chip={
              <Chip color="success" variant="flat" size="sm" className="shrink-0">
                +{runsTotal} 🥕 · {runs.length === 1 ? '1 run' : `${runs.length} runs`}
              </Chip>
            }
          />
          <StreakLine days={runConDays} kind="run" />
          {/* Fill wide screens: cards flow into columns; single column on
              mobile (UAT: don't waste horizontal space). */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 items-start">
            {[...runs]
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
                    points={runPoints(run)}
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
        </div>
      )}

      {hasSocial && (
        <div className="space-y-1.5">
          <SectionHeading
            label="Social"
            chip={
              <Chip color="secondary" variant="flat" size="sm" className="shrink-0">
                +{socialTotal} 🥕 · {socialScans === 1 ? '1 scan' : `${socialScans} scans`}
              </Chip>
            }
          />
          <StreakLine days={socialConDays} kind="social" />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5 items-start">
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
                meta={social.egg.at ? formatDate(Date.parse(social.egg.at)) : undefined}
                points={social.egg.points}
              />
            )}
          </div>
        </div>
      )}

      {hasCluster && (
        <div className="space-y-1.5">
          <SectionHeading
            label="Group check-ins"
            chip={
              <Chip color="secondary" variant="flat" size="sm" className="shrink-0">
                +{clusterTotal} 🥕 ·{' '}
                {cluster.length === 1 ? '1 group' : `${cluster.length} groups`}
              </Chip>
            }
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5 items-start">
            {cluster.map((c) => (
              <div key={c.startAt} className={c.counted ? undefined : 'opacity-50'}>
                <TokenCard
                  icon="👥"
                  tone="secondary"
                  name={`Group check-in ×${c.size}`}
                  meta={
                    c.counted
                      ? formatDate(c.startAt)
                      : `${formatDate(c.startAt)} · over daily cap`
                  }
                  points={c.counted ? c.points : 0}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {hasCtf && (
        <div className="space-y-1.5">
          <SectionHeading
            label="CTF"
            chip={
              <Chip color="warning" variant="flat" size="sm" className="shrink-0">
                +{ctfSectionTotal} 🥕 · {ctf.length === 1 ? '1 solve' : `${ctf.length} solves`}
              </Chip>
            }
          />
          <StreakLine days={ctfConDays} kind="CTF" />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5 items-start">
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
        </div>
      )}
    </>
  );
}
