import { auth } from "@/config/auth";
import { cls, apiBase } from "@/components/admin/qr-ui";
import { CtfCardArt } from "@/components/ctf/CtfCardArt";
import { listCtf } from "@/lib/qr-admin";
import { CtfSolve } from "@/entities/ctf";
import { gateAdminPage } from "../../admin/qr/gate";

/**
 * /ctf/cards — the collectible "CTF Cards" board (v-next). One tile per CTF
 * challenge: a solved challenge reveals its authored card art; an unsolved one
 * shows a uniform grayed "?" mystery tile that leaks nothing (no name, no art,
 * no hint). Art is authored per challenge via CtfForm's "Card image" slug and
 * lives as a static asset under public/ctf-cards/<slug>.(webp|svg).
 *
 * Ships DARK behind the admin gate first (mirrors the v2.2 leaderboard launch):
 * gateAdminPage → 404 on denial (non-disclosure). Because the board renders
 * exactly what a player would see for THIS viewer's solves, an admin previews
 * the real reveal by solving challenges. Launch flip = relax the gate to
 * signed-in players (see the spec's open decisions).
 *
 * Unlock join keys on session.user.id (= RunUser.userId = CtfSolve.user), NEVER
 * the OIDC sub — the CTF identity invariant. force-dynamic: always a live read.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fixed board size — pad with locked "coming soon" slots so it looks full. */
const SLOT_COUNT = 20;

export default async function CtfCardsPage() {
  const { email } = await gateAdminPage();
  const session = await auth();
  const viewerId = session?.user?.id ?? "";
  const base = apiBase();

  // Enabled challenges + the viewer's own solves, concurrently.
  const [allChallenges, solves] = await Promise.all([
    listCtf(),
    viewerId
      ? CtfSolve.query.byUser({ user: viewerId }).go({ pages: "all" })
      : Promise.resolve({ data: [] as Array<{ challenge: string }> }),
  ]);

  const solved = new Map(
    (solves.data as Array<{ challenge: string; ordinal?: number; points?: number; firstBlood?: boolean }>).map(
      (s) => [s.challenge, s]
    )
  );

  const challenges = allChallenges
    .filter((c) => c.enabled !== false)
    .sort((a, b) => a.challenge.localeCompare(b.challenge));

  // Build tiles: a real challenge is unlocked iff the viewer has a solve row.
  // Locked real challenges and pure padding slots render identically (uniform
  // mystery tile) so the board leaks nothing about what is still hidden.
  type Tile =
    | { kind: "unlocked"; challenge: string; cardImage?: string; points?: number; ordinal?: number; firstBlood?: boolean }
    | { kind: "locked" };

  const tiles: Tile[] = challenges.map((c) => {
    const hit = solved.get(c.challenge);
    return hit
      ? {
          kind: "unlocked" as const,
          challenge: c.challenge,
          cardImage: (c as { cardImage?: string }).cardImage,
          points: hit.points,
          ordinal: hit.ordinal,
          firstBlood: hit.firstBlood,
        }
      : { kind: "locked" as const };
  });
  while (tiles.length < SLOT_COUNT) tiles.push({ kind: "locked" });

  const unlockedCount = tiles.filter((t) => t.kind === "unlocked").length;

  return (
    <div className={cls.root}>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className={cls.h1}>
            defcon<span className="teal-dot">.</span>run 34 · CTF Cards
          </h1>
          <p className={`${cls.sub} mt-1`}>
            {unlockedCount} / {tiles.length} discovered
            {email ? ` · ${email}` : ""}. Solve a challenge to reveal its card.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {tiles.map((t, i) =>
          t.kind === "unlocked" ? (
            <div
              key={`c-${t.challenge}`}
              className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-divider bg-content1 shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md"
            >
              <CtfCardArt
                base={base}
                slug={t.cardImage ?? "_solved"}
                alt={`${t.challenge} card`}
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate font-museo text-sm font-bold text-white">
                    {t.challenge}
                  </span>
                  {t.firstBlood ? <span title="First blood">🩸</span> : null}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-white/80">
                  {t.points !== undefined ? <span>{t.points} pts</span> : null}
                  {t.ordinal !== undefined ? <span>· solve #{t.ordinal}</span> : null}
                </div>
              </div>
            </div>
          ) : (
            <div
              key={`lock-${i}`}
              className="relative flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-divider bg-default-100/60 text-default-400"
              aria-label="Undiscovered challenge"
            >
              <span className="text-4xl font-black opacity-40 select-none">?</span>
              <span className="text-[11px] uppercase tracking-wide">Undiscovered</span>
            </div>
          )
        )}
      </div>

      <p className={cls.sub}>
        Card art lives in <code>public/ctf-cards/&lt;slug&gt;.webp</code> (or{" "}
        <code>.svg</code>) and is attached per challenge via the{" "}
        <strong>Card image</strong> field in the CTF admin form.
      </p>
    </div>
  );
}
