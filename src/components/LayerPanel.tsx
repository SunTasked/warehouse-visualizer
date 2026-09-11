import { useState } from "react";
import { useEditor } from "../state/EditorContext";
import { LAYER_IDS, LAYER_LABELS, useLayers } from "../state/LayerContext";

/**
 * The "what am I looking at" control (specs.md §5.4) — docked bottom-left,
 * always visible in view mode, because layer state is something you change
 * constantly while reading the scene rather than a setting you configure
 * once. Collapsible for when the 3D view needs the room.
 */
export function LayerPanel() {
  const { mode } = useEditor();
  const layers = useLayers();
  const [collapsed, setCollapsed] = useState(false);

  if (mode !== "view") return null;

  const heatmapOn = layers.isVisible("pathHeatmap") || layers.isVisible("slotHeatmap");
  const activeCount = LAYER_IDS.filter((id) => layers.isVisible(id)).length;

  return (
    <div className="layer-panel">
      <button className="layer-panel__header" onClick={() => setCollapsed((c) => !c)}>
        <span className="layer-panel__title">Layers</span>
        <span className="layer-panel__count">{activeCount}</span>
        <span className="layer-panel__chevron">{collapsed ? "▸" : "▾"}</span>
      </button>

      {!collapsed && (
        <div className="layer-panel__body">
          {LAYER_IDS.map((id) => (
            <label key={id} className="layer-panel__row" title={LAYER_LABELS[id].hint}>
              <input type="checkbox" checked={layers.isVisible(id)} onChange={() => layers.toggle(id)} />
              <span className="layer-panel__label">{LAYER_LABELS[id].label}</span>
            </label>
          ))}

          {/* A display option for the heatmap layers rather than a layer of
              its own — numbers without colors isn't a view anyone wants. */}
          <label
            className={heatmapOn ? "layer-panel__row layer-panel__row--option" : "layer-panel__row layer-panel__row--option layer-panel__row--disabled"}
            title={heatmapOn ? "Draw each count next to its color" : "Turn on a heatmap layer first"}
          >
            <input
              type="checkbox"
              checked={layers.labelCounts}
              disabled={!heatmapOn}
              onChange={(e) => layers.setLabelCounts(e.target.checked)}
            />
            <span className="layer-panel__label">Label with counts</span>
          </label>
        </div>
      )}
    </div>
  );
}
