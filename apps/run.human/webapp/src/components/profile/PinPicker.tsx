'use client';

import { pinIconById, pinSvg, DEFAULT_PIN_COLOR } from '@/lib/pin-icons';

/** DC34 palette quick-picks (mirrors the gpx-studio dc34-palette ramp). */
export const DC34_SWATCHES = [
  '#e6007a', // magenta
  '#00e5ff', // cyan
  '#00d4aa', // teal
  '#f59e0b', // amber
  '#9933ff', // violet
  '#22c55e', // green
  '#ff9900', // orange
  '#50f0be', // aqua
  '#ff6ebe', // pink
] as const;

export type PinOption = { id: string; label: string; fixedColor?: string };

interface PinPickerProps {
  icons: PinOption[];
  icon: string;
  color: string;
  onChange: (pin: { icon: string; color: string }) => void;
  compact?: boolean;
}

/**
 * Check-in pin picker: icon grid + color choice. The color row leads with the
 * DC34 palette as one-tap swatches, with a free hex picker beside them
 * (Kurt 2026-07-04). Icons with a fixedColor (gold star) preview in it and
 * ignore the color choice.
 */
export default function PinPicker({ icons, icon, color, onChange, compact }: PinPickerProps) {
  const size = compact ? 34 : 44;

  const preview = (id: string) => {
    const def = pinIconById(id);
    if (!def) return '';
    return `data:image/svg+xml,${encodeURIComponent(pinSvg(def, color || DEFAULT_PIN_COLOR))}`;
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex flex-wrap gap-1.5">
        {icons.map((opt) => (
          <button
            key={opt.id}
            type="button"
            aria-label={opt.label}
            title={opt.label}
            onClick={() => onChange({ icon: opt.id, color })}
            className={`rounded-lg p-0.5 border-2 transition-colors ${
              icon === opt.id ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-default-100'
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview(opt.id)} alt={opt.label} width={size} height={size} />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {DC34_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            onClick={() => onChange({ icon, color: c })}
            className={`h-6 w-6 rounded-full border-2 ${
              color.toLowerCase() === c ? 'border-foreground' : 'border-transparent'
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
        <label
          className="h-6 w-6 rounded-full border-2 border-dashed border-default-400 overflow-hidden cursor-pointer relative"
          title="Custom color"
        >
          <input
            type="color"
            value={color || DEFAULT_PIN_COLOR}
            onChange={(e) => onChange({ icon, color: e.target.value })}
            className="absolute inset-0 opacity-0 cursor-pointer h-full w-full"
          />
          <span
            className="absolute inset-0.5 rounded-full"
            style={{
              background: DC34_SWATCHES.includes(color as (typeof DC34_SWATCHES)[number])
                ? 'conic-gradient(#e6007a,#f59e0b,#22c55e,#00e5ff,#9933ff,#e6007a)'
                : color,
            }}
          />
        </label>
      </div>
    </div>
  );
}
