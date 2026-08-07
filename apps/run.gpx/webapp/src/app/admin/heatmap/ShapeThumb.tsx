"use client";

import type { RunShape } from "@/lib/heatmap-shape";

/**
 * A run's geometry, drawn small enough to scan and big enough to recognise.
 *
 * Pure presentation — `buildRunShape` did the projection server-side, so this
 * only picks a size and strokes the path. `preserveAspectRatio` stays at its
 * default (`xMidYMid meet`) so the shape is letterboxed inside the cell rather
 * than stretched: a distorted thumbnail on a page whose job is judging shapes
 * would defeat the point.
 */
export default function ShapeThumb({
  shape,
  size = 56,
  loading = false,
  failed = false,
  onClick,
}: {
  shape?: RunShape;
  size?: number;
  loading?: boolean;
  failed?: boolean;
  onClick?: () => void;
}) {
  const box: React.CSSProperties = {
    width: size,
    height: size,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #e5e5e5",
    borderRadius: 4,
    background: "#fafafa",
    fontSize: size < 80 ? "0.65rem" : "0.8rem",
    color: "#999",
    flexShrink: 0,
  };

  if (loading) return <div style={box}>…</div>;
  if (failed)
    return (
      <div style={{ ...box, color: "#b00" }} title="Could not read this run's GPX from S3">
        !
      </div>
    );
  if (!shape) return <div style={box}>—</div>;
  if (!shape.path)
    return (
      <div style={box} title="No trackpoints — distance-only import">
        —
      </div>
    );

  return (
    <div
      style={{ ...box, cursor: onClick ? "zoom-in" : "default", padding: 3 }}
      onClick={onClick}
      title={`${shape.points} points · ${shape.spanMeters} m across`}
    >
      <svg
        viewBox={shape.viewBox}
        width="100%"
        height="100%"
        // A hairline that does NOT scale with the viewBox — without this a run
        // with a tiny extent gets a stroke wider than the shape it describes.
        vectorEffect="non-scaling-stroke"
        style={{ overflow: "visible" }}
      >
        <path
          d={shape.path}
          fill="none"
          stroke={shape.signals.includes("drawn-in-place") ? "#b00020" : "#111"}
          strokeWidth={size > 100 ? 1.2 : 2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
