import { useMemo } from "react";
import { useEditor } from "../state/EditorContext";
import { useSimulation } from "../state/SimulationContext";
import { usageColor, usageRange } from "../lib/usageColor";

const STOPS = 6;

/**
 * The green-to-red scale key for the path usage coloring (Paths.tsx) — shown
 * whenever at least one path segment has been traveled, independent of
 * whether the picking-list panel itself is open, since the coloring itself
 * persists on the 3D view after a run finishes or the panel is closed.
 */
export function UsageLegend() {
  const { mode } = useEditor();
  const simulation = useSimulation();
  const range = useMemo(() => usageRange(simulation.edgeUsage), [simulation.edgeUsage]);

  if (mode !== "view" || !range) return null;

  const stops = Array.from({ length: STOPS }, (_, i) => {
    const t = i / (STOPS - 1);
    const count = Math.round(range.min + t * (range.max - range.min));
    return { count, color: usageColor(count, range.min, range.max) };
  });

  return (
    <div className="usage-legend">
      <div className="usage-legend__title">Path usage</div>
      <div className="usage-legend__bar">
        {stops.map((stop, i) => (
          <div key={i} className="usage-legend__swatch" style={{ background: stop.color }} />
        ))}
      </div>
      <div className="usage-legend__labels">
        <span>{range.min} pass{range.min === 1 ? "" : "es"}</span>
        <span>{range.max} pass{range.max === 1 ? "" : "es"}</span>
      </div>
    </div>
  );
}
