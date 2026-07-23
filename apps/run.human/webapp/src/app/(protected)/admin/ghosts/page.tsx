import Link from "next/link";

import GhostOtpPanel from "@/components/admin/GhostOtpPanel";
import GhostSheetButton from "@/components/admin/GhostSheetButton";
import { cls } from "@/components/admin/qr-ui";
import { ghostDossier } from "@/lib/ghost-dossiers";
import {
  ghostCtfLinks,
  loadMeshGhosts,
  type GhostCtfLink,
  type MeshGhost,
} from "@/lib/mesh-ghosts";
import { listCtf } from "@/lib/qr-admin";
import { gateAdminPage } from "../qr/gate";

/**
 * /admin/ghosts — read-only meshtk ghost roster (Phase 67). One card per
 * `ghost.*` fleet entry from the committed meshtk.dc34.yaml snapshot: dossier
 * identity, node/behaviour config, chatbot response matrix, covert flag code,
 * CTF row linkage (with derived/committed sync badges), and a reveal-on-demand
 * panel for the DERIVED TOTP seed the deployed bot validates (meshtk#10).
 *
 * Gated identically to /admin/qr (gateAdminPage → 404 on denial). The page
 * payload contains persona prompts and flag codes (admin-gated by design) but
 * NEVER an OTP seed — derived seeds only travel through the separately-gated
 * `ghost_otp_reveal` action, and the committed YAML values it echoes are decoys.
 *
 * All rendered strings flow through React text nodes (escaped by default).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYNC_BADGE: Record<
  GhostCtfLink["secretState"],
  { label: string; className: string; hint: string }
> = {
  derived: {
    label: "IN SYNC",
    className: "text-success border-success/40",
    hint: "The Ctf row's OTP secret equals the derived seed — chain works against a derivation-enabled bot.",
  },
  committed: {
    label: "STALE",
    className: "text-warning border-warning/40",
    hint: "The Ctf row still holds the committed YAML decoy — update it to the derived seed once the fleet redeploys with derivation (meshtk#10).",
  },
  other: {
    label: "ROTATED",
    className: "text-default-400 border-divider",
    hint: "The Ctf row's OTP secret matches neither the committed nor the derived value.",
  },
  none: {
    label: "static",
    className: "text-default-400 border-divider",
    hint: "No OTP secret on this row (e.g. the static half of a chain).",
  },
};

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-divider bg-content2 px-1.5 py-0.5 font-mono text-[11px] text-default-600">
      {children}
    </span>
  );
}

function GhostCard({ ghost, links }: { ghost: MeshGhost; links: GhostCtfLink[] }) {
  const dossier = ghostDossier(ghost.slug);
  return (
    <article className={`${cls.cardPad} flex flex-col gap-3`}>
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className={cls.h2}>{dossier?.name ?? ghost.slug}</h2>
        {dossier?.alias && (
          <span className="text-sm text-default-500">“{dossier.alias}”</span>
        )}
        <code className="ml-auto font-mono text-[11px] text-default-400">{ghost.id}</code>
      </header>

      {dossier && (
        <p className={cls.sub}>
          {dossier.blurb}{" "}
          {dossier.link && (
            <a
              href={dossier.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              learn more ↗
            </a>
          )}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {ghost.behaviours.map((b) => (
          <Chip key={b}>{b}</Chip>
        ))}
        {ghost.movement?.type && (
          <Chip>
            {ghost.movement.type}
            {ghost.movement.travel ? `:${ghost.movement.travel}` : ""}
          </Chip>
        )}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        {ghost.longNameTmpl && (
          <>
            <dt className="font-mono uppercase text-default-400">names</dt>
            <dd className="font-mono text-default-600">
              {ghost.longNameTmpl}
              {ghost.shortNameTmpl ? ` · ${ghost.shortNameTmpl}` : ""}
            </dd>
          </>
        )}
        {ghost.movement?.gpxFile && (
          <>
            <dt className="font-mono uppercase text-default-400">route</dt>
            <dd className="font-mono text-default-600">{ghost.movement.gpxFile}</dd>
          </>
        )}
        {ghost.flagCode && (
          <>
            <dt className="font-mono uppercase text-default-400">flag code</dt>
            <dd>
              <code className="font-mono text-default-600">{ghost.flagCode}</code>
            </dd>
          </>
        )}
      </dl>

      {ghost.chatbot.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {ghost.chatbot.map((r) => (
            <Chip key={r.type}>
              {r.type}
              {r.requiresOtp ? " 🔒" : ""}
            </Chip>
          ))}
        </div>
      )}

      <section className="flex flex-col gap-1">
        <span className={cls.label + " mb-0"}>CTF rows</span>
        {links.length === 0 ? (
          <p className="text-[12px] text-default-400">No matching Ctf rows.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {links.map((l) => {
              const badge = SYNC_BADGE[l.secretState];
              return (
                <li key={l.challenge} className="flex items-center gap-2 text-[12px]">
                  <code className="font-mono">{l.challenge}</code>
                  <span
                    title={badge.hint}
                    className={`inline-flex cursor-help items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                  {!l.enabled && (
                    <span className="text-[11px] text-default-400">disabled</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="border-t border-divider pt-3">
        {ghost.hasOtp ? (
          <GhostOtpPanel ghostId={ghost.id} ghostName={dossier?.name ?? ghost.slug} />
        ) : (
          <p className="text-[12px] text-default-400">No OTP on this ghost.</p>
        )}
      </section>

      {ghost.systemPrompt && (
        <details className="text-[12px] text-default-500">
          <summary className="cursor-pointer select-none font-mono text-[11px] uppercase tracking-wide text-default-400">
            persona prompt
          </summary>
          <p className="mt-1 whitespace-pre-wrap break-words">{ghost.systemPrompt}</p>
        </details>
      )}
    </article>
  );
}

export default async function AdminGhostsPage() {
  await gateAdminPage();

  const ghosts = loadMeshGhosts();
  const ctfRows = await listCtf();
  const serverSecret = process.env.MESHTK_GHOST_KEY_SECRET;

  const withOtp = ghosts.filter((g) => g.hasOtp).length;

  return (
    <div className={cls.root + " max-w-6xl mx-auto px-4"}>
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className={cls.h1}>👻 Ghost roster</h1>
        <span className={cls.sub}>
          {ghosts.length} ghosts · {withOtp} with OTP · read-only view of
          meshtk.dc34.yaml{serverSecret ? "" : " · derivation secret NOT configured"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <GhostSheetButton
            otpGhosts={ghosts
              .filter((g) => g.hasOtp)
              .map((g) => ({
                ghostId: g.id,
                name: ghostDossier(g.slug)?.name ?? g.slug,
              }))}
          />
          <Link href="/admin" className={cls.btn}>
            ← Admin
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {ghosts.map((g) => (
          <GhostCard
            key={g.id}
            ghost={g}
            links={ghostCtfLinks(g, ctfRows, serverSecret)}
          />
        ))}
      </div>
    </div>
  );
}
