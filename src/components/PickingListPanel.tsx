import { useState } from "react";
import { useEditor } from "../state/EditorContext";
import { useSimulation } from "../state/SimulationContext";

/**
 * The catalogue of picking lists (§5.3): what you can launch, and how. Kept
 * deliberately separate from the run console (RunConsole.tsx, docked
 * top-center) which owns everything about what's currently *happening* —
 * capture, transport, operations and the capture's run history. One place to
 * choose, one place to watch.
 */
export function PickingListPanel() {
  const { mode } = useEditor();
  const simulation = useSimulation();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (mode !== "view" || !simulation.showPanel) return null;

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedLists = simulation.pickingLists.filter((list) => selected.has(list.id));
  const run = simulation.activeRun;
  const isPlaying = run !== null && run.mode === "animated" && run.currentLegIndex < run.legs.length;

  return (
    <div className="picking-panel">
      <div className="picking-panel__header">
        <h2>Picking lists</h2>
        <button className="picking-panel__close" onClick={() => simulation.setShowPanel(false)}>
          ×
        </button>
      </div>

      <div className="picking-panel__mode">
        <span>Playback</span>
        <div className="picking-panel__toggle">
          <button
            className={
              simulation.playbackMode === "animated"
                ? "picking-panel__toggle-btn picking-panel__toggle-btn--active"
                : "picking-panel__toggle-btn"
            }
            onClick={() => simulation.setPlaybackMode("animated")}
          >
            Animated
          </button>
          <button
            className={
              simulation.playbackMode === "static"
                ? "picking-panel__toggle-btn picking-panel__toggle-btn--active"
                : "picking-panel__toggle-btn"
            }
            onClick={() => simulation.setPlaybackMode("static")}
          >
            Static
          </button>
        </div>
      </div>

      {simulation.playbackMode === "animated" && (
        <label className="picking-panel__speed">
          Speed
          <input
            type="number"
            min={0.5}
            max={10}
            step={0.5}
            value={simulation.speed}
            onChange={(e) => simulation.setSpeed(Math.max(0.5, Number(e.target.value) || 0.5))}
          />
          m/s
        </label>
      )}

      <ul className="picking-panel__list">
        {simulation.pickingLists.map((list) => (
          <li key={list.id} className="picking-panel__row">
            <input
              type="checkbox"
              checked={selected.has(list.id)}
              onChange={() => toggleSelected(list.id)}
              aria-label={`Select ${list.label}`}
            />
            <div className="picking-panel__info">
              <div className="picking-panel__label">{list.label}</div>
              <div className="picking-panel__meta">
                <span
                  className={
                    list.mode === "picking"
                      ? "picking-panel__badge picking-panel__badge--picking"
                      : "picking-panel__badge picking-panel__badge--storing"
                  }
                >
                  {list.mode}
                </span>
                <span>{list.stops.map((s) => s.id).join(" → ")}</span>
              </div>
            </div>
            <button className="picking-panel__play" onClick={() => simulation.playList(list)}>
              Play
            </button>
          </li>
        ))}
      </ul>

      <div className="picking-panel__actions">
        <button
          className="picking-panel__btn"
          disabled={selectedLists.length === 0}
          onClick={() => simulation.playQueue(selectedLists)}
        >
          Play selected ({selectedLists.length})
        </button>
        <button className="picking-panel__btn" onClick={() => simulation.playQueue(simulation.pickingLists)}>
          Play all
        </button>
        <button className="picking-panel__btn picking-panel__btn--stop" disabled={!isPlaying} onClick={simulation.stop}>
          Stop
        </button>
        <button
          className="picking-panel__btn picking-panel__btn--reset"
          onClick={simulation.resetWarehouse}
          title="Undo every pallet the simulation moved (keeps the captured heatmaps)"
        >
          Reset warehouse
        </button>
      </div>
    </div>
  );
}
