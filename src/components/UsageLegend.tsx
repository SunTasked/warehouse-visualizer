import { useMemo } from "react";
import { useEditor } from "../state/EditorContext";
import { useSimulation } from "../state/SimulationContext";
import { useLayers, type LayerId } from "../state/LayerContext";
import { usageColor, usageRange } from "../lib/usageColor";

const STOPS = 7;

function Scale({
  title,
  unit,
  units,
  range,
}: {
  title: string;
  unit: string;
  units: string;
  range: { min: number; max: number };
}) {
  const stops = Array.from({ length: STOPS }, (_, i) => {
    const t = i / (STOPS - 1);
    const count = range.min + t * (range.max - range.min);
    return usageColor(count, range.min, range.max);
  });

  return (
    <div className="usage-legend__scale">
      <div className="usage-legend__title">{title}</div>
      <div className="usage-legend__bar">
        {stops.map((color, i) => (
          <div key={i} className="usage-legend__swatch" style={{ background: color }} />
        ))}
      </div>
      <div className="usage-legend__labels">
        <span>
          {range.min} {range.min === 1 ? unit : units}
        </span>
        <span>
          {range.max} {range.max === 1 ? unit : units}
        </span>
      </div>
    </div>
  );
}

/**
 * The colour key for whichever heatmap layers are on (specs.md §5.4). Each
 * heatmap gets its own scale rather than a shared one: a corridor is
 * traversed far more often than any single slot is picked from, so forcing
 * both onto one range would flatten the slot heatmap into a single colour.
 */
export function UsageLegend() {
  const { mode } = useEditor();
  const simulation = useSimulation();
  const { isVisible } = useLayers();
  const pathRange = useMemo(() => usageRange(simulation.edgeUsage), [simulation.edgeUsage]);
  const slotRange = useMemo(() => usageRange(simulation.slotUsage), [simulation.slotUsage]);

  const shows = (layer: LayerId, range: unknown) => isVisible(layer) && range !== null;
  const showPath = shows("pathHeatmap", pathRange);
  const showSlot = shows("slotHeatmap", slotRange);

  if (mode !== "view" || (!showPath && !showSlot)) return null;

  return (
    <div className="usage-legend">
      {showPath && pathRange && <Scale title="Path usage" unit="pass" units="passes" range={pathRange} />}
      {showSlot && slotRange && <Scale title="Slot activity" unit="op" units="ops" range={slotRange} />}
    </div>
  );
}
