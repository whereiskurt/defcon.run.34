'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import {
  Button,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
} from '@heroui/react';
import RunnerDrill, { EMPTY_SOCIAL, type Drill } from './RunnerDrill';
import { deriveCountChips, runnerClassEmoji } from '@/lib/leaderboard-ui';
import { apiUrl } from '@/lib/api';

/**
 * YourStandingModal — the profile's "Leaderboard" button.
 *
 * Shows the runner THEIR OWN row (global rank, score, count chips) and their
 * own Runs / Social / CTF breakdown, using the same `RunnerDrill` markup the
 * admin board renders so the two can never drift.
 *
 * It talks ONLY to `GET /api/leaderboard/me`, which takes no userId and is
 * gated by `LEADERBOARD_SELF_ENABLED || admin` — so this component can never
 * surface another runner, and pre-launch a non-admin never sees the button
 * that opens it.
 *
 * A 404 here means "not available yet" (the gate), not an error worth alarming
 * about — the copy says so plainly rather than leaking a status code.
 */

/** The `row` half of the /me payload — one runner's leaderboard line. */
type StandingRow = {
  globalRank: number;
  userId: string;
  displayName?: string;
  mqttUsertype?: 'rabbit' | 'admin' | 'wildhare' | 'og';
  globalScore: number;
  activityCounts: { checkin: number; gpx: number; strava?: number };
  ctfSolves: number;
  socialScore?: number;
};

type MeResponse = Partial<Drill> & { row: StandingRow | null; total?: number };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** Fallback name while the row is loading / when the runner has no row yet. */
  displayName: string;
};

export default function YourStandingModal({ isOpen, onClose, displayName }: Props) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MeResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/leaderboard/me'), { cache: 'no-store' });
      if (res.status === 404) {
        // The gate, not a failure — say so in plain language.
        setError('The leaderboard is not open yet.');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
    } catch {
      setError('Could not load your standing.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on open (and refetch on reopen — a run may have landed since).
  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  const row = data?.row ?? null;
  const chips = row ? deriveCountChips(row) : [];
  const emoji = row ? runnerClassEmoji(row.mqttUsertype) : '';
  const drill: Drill = {
    accomplishments: data?.accomplishments ?? [],
    social: data?.social ?? EMPTY_SOCIAL,
    ctf: data?.ctf ?? [],
  };

  return (
    <Modal
      size="3xl"
      placement="center"
      scrollBehavior="inside"
      isOpen={isOpen}
      backdrop="blur"
      onClose={onClose}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-0.5">
          <span className="font-museo text-xl font-bold">🥕 Your standing</span>
          <span className="text-xs font-normal text-default-500">
            Where you sit on the board right now
          </span>
        </ModalHeader>

        <ModalBody className="gap-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10">
              <Spinner size="sm" />
              <span className="text-sm text-default-500">Loading your standing…</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-sm text-default-500">{error}</p>
              <Button size="sm" variant="flat" onPress={load}>
                Try again
              </Button>
            </div>
          ) : row ? (
            <>
              {/* The runner's own row — same anatomy as a board row, minus the
                  accordion (there is only ever one row here). */}
              <div className="flex items-center flex-wrap gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2.5">
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
                <span className="break-all text-base font-medium min-w-0">
                  {row.displayName ?? displayName}
                  {emoji ? ` ${emoji}` : ''}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  {chips.map((chip) => (
                    <Chip key={chip.key} color={chip.color} variant="flat" size="sm">
                      {chip.count}
                    </Chip>
                  ))}
                </div>
                {typeof data?.total === 'number' && (
                  <span className="ml-auto text-xs text-default-500 shrink-0">
                    of {data.total} runners
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <RunnerDrill
                  drill={drill}
                  theme={theme}
                  emptyLabel="Nothing scored yet — add a run or scan a runner."
                />
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="text-sm text-default-500">
                No standing yet — add a run or scan a runner to get on the board.
              </p>
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          <Button color="primary" variant="flat" onPress={onClose}>
            Done
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
