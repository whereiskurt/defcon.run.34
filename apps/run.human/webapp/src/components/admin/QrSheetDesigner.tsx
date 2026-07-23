"use client";

/**
 * QR sheet designer (dc33 QRSheet port, restyled + QR styling). Fully
 * client-side: styled QRs via qr-code-styling, PDF via pdf-lib, download via
 * object URL. No API calls, no persistence — the URL param is the only input.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cls, QR_ORIGIN } from "@/components/admin/qr-ui";
import {
  AVERY_INFO,
  GRID_PRESETS,
  parseTemplate,
  type SheetLayout,
} from "@/components/admin/qr-sheet/templates";
import {
  BUNDLED_LOGOS,
  DC34_PALETTE,
  DC34_PRESETS,
  contrastWarning,
  type ModuleShape,
  type EyeShape,
  type QrStyle,
} from "@/components/admin/qr-sheet/styles";
import {
  EC_INFO,
  effectiveEcLevel,
  renderQrPng,
  type EcChoice,
} from "@/components/admin/qr-sheet/render";
import { buildSheetPdf, sheetFilename } from "@/components/admin/qr-sheet/pdf";

const MODULE_SHAPES: ModuleShape[] = ["square", "dots", "rounded", "classy"];
const EYE_SHAPES: EyeShape[] = ["square", "rounded", "dot"];

/** DC34 swatch row + native picker for one color field. */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div>
      <label className={cls.label}>{label}</label>
      <div className="flex items-center gap-1.5 flex-wrap">
        {DC34_PALETTE.map((c) => (
          <button
            key={c.hex}
            type="button"
            title={c.name}
            aria-label={`${label}: ${c.name}`}
            onClick={() => onChange(c.hex)}
            className={`w-7 h-7 rounded-md border ${
              value.toLowerCase() === c.hex
                ? "border-primary ring-1 ring-primary"
                : "border-divider"
            }`}
            style={{ backgroundColor: c.hex }}
          />
        ))}
        <input
          type="color"
          title="Custom color"
          className="w-9 h-7 rounded-md border border-divider bg-content1 cursor-pointer"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

export default function QrSheetDesigner({ initialUrl }: { initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl || `${QR_ORIGIN}/`);
  const [template, setTemplate] = useState("7x9");
  const [style, setStyle] = useState<QrStyle>(DC34_PRESETS[0].style);
  const [presetId, setPresetId] = useState<string>(DC34_PRESETS[0].id);
  const [proofPages, setProofPages] = useState(true);
  const [ecChoice, setEcChoice] = useState<EcChoice>("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const layout: SheetLayout | null = useMemo(
    () => parseTemplate(template),
    [template]
  );
  const urlOk = /^https?:\/\/\S+$/.test(url.trim());
  const contrast = contrastWarning(style);

  // Logo knockout eats ~6% of modules — below Q it stops being recoverable.
  const hasLogo = Boolean(style.logo);
  const ecDisabled = (lvl: string) => hasLogo && (lvl === "L" || lvl === "M");
  const effectiveEc = useMemo(() => {
    if (!urlOk) return null;
    try {
      return effectiveEcLevel(url.trim(), hasLogo, ecChoice);
    } catch {
      return null;
    }
  }, [url, urlOk, hasLogo, ecChoice]);
  const effectiveEcPct = EC_INFO.find((e) => e.level === effectiveEc)?.pct;

  const patchStyle = (patch: Partial<QrStyle> & { logo?: string }) => {
    setPresetId("");
    setStyle((s) => {
      const next = { ...s, ...patch };
      if ("logo" in patch && patch.logo === undefined) delete next.logo;
      return next;
    });
  };

  const applyPreset = (id: string) => {
    const p = DC34_PRESETS.find((p) => p.id === id);
    if (!p) return;
    setPresetId(id);
    setStyle({ ...p.style });
  };

  // Turning a logo on while L/M is forced would print an unrecoverable code —
  // snap back to auto (the chips also disable L/M while a logo is set).
  useEffect(() => {
    if (hasLogo && (ecChoice === "L" || ecChoice === "M")) setEcChoice("auto");
  }, [hasLogo, ecChoice]);

  const onLogoUpload = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => patchStyle({ logo: String(reader.result) });
    reader.onerror = () => setWarning("Could not read that image file.");
    reader.readAsDataURL(file);
  };

  // ── Live preview (debounced) ──────────────────────────────────────────────
  const previewUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!urlOk) return;
    const t = setTimeout(async () => {
      const show = (png: ArrayBuffer) => {
        const objUrl = URL.createObjectURL(
          new Blob([png], { type: "image/png" })
        );
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = objUrl;
        setPreviewSrc(objUrl);
        setError(null);
      };
      try {
        setWarning(contrast);
        show(await renderQrPng(url.trim(), style, 240, ecChoice));
      } catch (e) {
        // Retry once without the logo — a broken image must not brick preview.
        if (style.logo) {
          try {
            show(
              await renderQrPng(
                url.trim(),
                { ...style, logo: undefined },
                240,
                ecChoice
              )
            );
            setWarning("Logo image failed to load - previewing without it.");
            return;
          } catch {
            /* fall through to the underlying error */
          }
        }
        setError(e instanceof Error ? e.message : "Failed to render QR.");
      }
    }, 300);
    return () => clearTimeout(t);
  }, [url, urlOk, style, contrast, ecChoice]);

  // ── Download ──────────────────────────────────────────────────────────────
  const download = useCallback(async () => {
    if (!urlOk || !layout) return;
    setBusy(true);
    setError(null);
    try {
      const effective = { ...style };
      let logoWarned = false;
      // Proof pages pass an explicit level (redundancy comparison); everywhere
      // else the user's auto/override choice applies.
      const renderPng = async (
        u: string,
        px: number,
        lvl?: "L" | "M" | "Q" | "H"
      ): Promise<ArrayBuffer> => {
        const ec: EcChoice = lvl ?? ecChoice;
        try {
          return await renderQrPng(u, effective, px, ec);
        } catch (e) {
          if (effective.logo) {
            // drop the logo for the whole sheet and warn once
            delete effective.logo;
            if (!logoWarned) {
              setWarning("Logo image failed to load - sheet generated without it.");
              logoWarned = true;
            }
            return renderQrPng(u, effective, px, ec);
          }
          throw e;
        }
      };
      const bytes = await buildSheetPdf({
        url: url.trim(),
        layout,
        includeProofPages: proofPages,
        renderPng,
      });
      const blob = new Blob([bytes as unknown as ArrayBuffer], {
        type: "application/pdf",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = sheetFilename(url.trim(), layout);
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate the PDF.");
    } finally {
      setBusy(false);
    }
  }, [url, urlOk, layout, style, proofPages, ecChoice]);

  const activeLogo =
    BUNDLED_LOGOS.find((l) => l.path === style.logo)?.id ??
    (style.logo?.startsWith("data:") ? "upload" : style.logo ? "custom" : "none");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 items-start">
      {/* ── Controls ── */}
      <div className={`${cls.cardPad} flex flex-col gap-5`}>
        {/* URL */}
        <div>
          <label className={cls.label}>URL</label>
          <input
            className={cls.input}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={`${QR_ORIGIN}/CODE`}
            spellCheck={false}
          />
          {!urlOk && (
            <p className="text-[11.5px] text-danger mt-1">
              Enter an absolute http(s) URL.
            </p>
          )}
        </div>

        {/* Layout */}
        <div className="flex flex-col gap-2">
          <label className={cls.label}>Layout</label>
          <div className="flex flex-wrap gap-2">
            {GRID_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setTemplate(p.value)}
                className={template === p.value ? cls.btnPrimary : cls.btn}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <input
              className={`${cls.input} max-w-[140px]`}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder="AxB or Avery #"
              spellCheck={false}
            />
            <select
              className={`${cls.select} max-w-[280px]`}
              value={
                layout?.kind === "avery" ? layout.name.replace("avery-", "") : ""
              }
              onChange={(e) => e.target.value && setTemplate(e.target.value)}
            >
              <option value="">Avery templates…</option>
              {AVERY_INFO.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} - {a.desc} ({a.dims})
                </option>
              ))}
            </select>
          </div>
          {!layout && (
            <p className="text-[11.5px] text-danger">
              Grid must be 1–12 per axis (e.g. 5x7) or a known Avery number.
            </p>
          )}
        </div>

        {/* Presets */}
        <div className="flex flex-col gap-2">
          <label className={cls.label}>DC34 templates</label>
          <div className="flex flex-wrap gap-2">
            {DC34_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className={presetId === p.id ? cls.btnPrimary : cls.btn}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Style controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={cls.label}>Modules</label>
            <select
              className={cls.select}
              value={style.moduleShape}
              onChange={(e) =>
                patchStyle({ moduleShape: e.target.value as ModuleShape })
              }
            >
              {MODULE_SHAPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={cls.label}>Eyes</label>
            <select
              className={cls.select}
              value={style.eyeShape}
              onChange={(e) =>
                patchStyle({ eyeShape: e.target.value as EyeShape })
              }
            >
              {EYE_SHAPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <ColorField
            label="Module color"
            value={style.moduleColor}
            onChange={(hex) => patchStyle({ moduleColor: hex })}
          />
          <ColorField
            label="Eye color"
            value={style.eyeColor}
            onChange={(hex) => patchStyle({ eyeColor: hex })}
          />
        </div>

        {/* Logo */}
        <div className="flex flex-col gap-2">
          <label className={cls.label}>
            Center logo (forces high error correction)
          </label>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              onClick={() => patchStyle({ logo: undefined })}
              className={activeLogo === "none" ? cls.btnPrimary : cls.btn}
            >
              None
            </button>
            {BUNDLED_LOGOS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => patchStyle({ logo: l.path })}
                className={activeLogo === l.id ? cls.btnPrimary : cls.btn}
              >
                {l.label}
              </button>
            ))}
            <label className={`${cls.btn} cursor-pointer`}>
              {activeLogo === "upload" ? "Uploaded ✓" : "Upload…"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onLogoUpload(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <p className="text-[11.5px] text-default-400">
            Uploads stay in your browser - the image is embedded straight into
            the PDF, never sent to a server.
          </p>
        </div>

        {/* Error correction / redundancy */}
        <div className="flex flex-col gap-2">
          <label className={cls.label}>Redundancy (error correction)</label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setEcChoice("auto")}
              className={ecChoice === "auto" ? cls.btnPrimary : cls.btn}
            >
              Auto
            </button>
            {EC_INFO.map((e) => (
              <button
                key={e.level}
                type="button"
                disabled={ecDisabled(e.level)}
                title={
                  ecDisabled(e.level)
                    ? "Too little redundancy for a center logo - needs Q or H"
                    : `${e.pct}% of the code can be damaged and still scan`
                }
                onClick={() => setEcChoice(e.level)}
                className={ecChoice === e.level ? cls.btnPrimary : cls.btn}
              >
                {e.level} · {e.pct}%
              </button>
            ))}
          </div>
          <p className="text-[11.5px] text-default-400">
            How much of the printed code can be damaged (or covered by a logo)
            and still scan. Higher survives more abuse; lower packs modules less
            densely. Auto picks the highest level the URL fits at.
          </p>
        </div>

        {/* Proof pages + download */}
        <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-divider">
          <label className="flex items-center gap-2 text-[13px] cursor-pointer">
            <input
              type="checkbox"
              checked={proofPages}
              onChange={(e) => setProofPages(e.target.checked)}
            />
            Include proof pages (giant QR, size comparison, density test)
          </label>
          <button
            type="button"
            onClick={download}
            disabled={!urlOk || !layout || busy}
            className={cls.btnPrimary}
          >
            {busy ? "Generating…" : "Download PDF"}
          </button>
        </div>

        {warning && <p className="text-[12.5px] text-warning">{warning}</p>}
        {error && <p className="text-[12.5px] text-danger">{error}</p>}
      </div>

      {/* ── Preview ── */}
      <div className={`${cls.cardPad} flex flex-col gap-4 items-center`}>
        <span className={cls.label}>Preview</span>
        {previewSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewSrc}
            alt="QR preview"
            className="w-[240px] h-[240px] rounded-lg border border-divider bg-white"
          />
        ) : (
          <div className="w-[240px] h-[240px] rounded-lg border border-divider bg-content2" />
        )}
        {effectiveEc && (
          <p className="text-[11.5px] text-default-500 -mt-2">
            EC level <span className="font-mono font-semibold">{effectiveEc}</span>
            {" · "}
            {effectiveEcPct}% redundancy
            {ecChoice === "auto" ? " (auto)" : " (forced)"}
          </p>
        )}
        {layout && (
          <>
            <div
              className="relative overflow-hidden border border-divider bg-white rounded-sm"
              style={{ width: 153, height: 198 }}
              aria-label="Page layout thumbnail"
            >
              {Array.from({ length: layout.across * layout.down }).map((_, i) => {
                const dx = i % layout.across;
                const dy = Math.floor(i / layout.across);
                const s = 0.25; // 612×792pt → 153×198px
                const pad = (layout.cellW - layout.qrBox * 0.9) / 2;
                const padY = (layout.cellH - layout.qrBox * 0.9) / 2;
                return (
                  <div
                    key={i}
                    className="absolute bg-black/70 rounded-[1px]"
                    style={{
                      left: (layout.startX + dx * layout.pitchX + pad) * s,
                      bottom: (layout.startY - dy * layout.pitchY + padY) * s,
                      width: layout.qrBox * 0.9 * s,
                      height: layout.qrBox * 0.9 * s,
                    }}
                  />
                );
              })}
            </div>
            <p className="text-[11.5px] text-default-400 text-center">
              {layout.across}×{layout.down} · {layout.widthIn.toFixed(2)}″ ×{" "}
              {layout.heightIn.toFixed(2)}″ cells
              {layout.kind === "grid" ? " · fold lines" : " · Avery stock"}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
