import { useState } from "react";
import { useEditor } from "../state/EditorContext";
import { useSimulation } from "../state/SimulationContext";

/**
 * Overlay menu for the forklift picking-list simulation (§5.3): lists the
 * example test lists, lets one be played on its own or several be queued
 * ("played one after the other"), and toggles between the two playback
 * modes the user asked for explicitly rather than choosing one — an
 * animated forklift with real travel time, or an instant static route
 * highlight.
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
  // Static runs finish synchronously the instant they're started — there's
  // no "still in progress" state for them, unlike an animated run whose
  // vehicle hasn't reached the last leg yet.
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
        <button
          className="picking-panel__btn"
          onClick={() => simulation.playQueue(simulation.pickingLists)}
        >
          Play all
        </button>
        <button className="picking-panel__btn picking-panel__btn--stop" disabled={!isPlaying} onClick={simulation.stop}>
          Stop
        </button>
        <button
          className="picking-panel__btn picking-panel__btn--reset"
          onClick={simulation.resetWarehouse}
          title="Undo every pallet moved by the simulation and clear the usage coloring"
        >
          Reset warehouse
        </button>
      </div>

      {run && run.mode === "animated" ? (
        <div className="picking-panel__transport">
          <div className="picking-panel__transport-title">
            {run.isPaused ? "Paused" : isPlaying ? "Playing" : "Finished"} <strong>{run.list.label}</strong>
          </div>
          <div className="picking-panel__transport-buttons">
            <button
              className="picking-panel__transport-btn"
              disabled={run.currentLegIndex === 0}
              onClick={simulation.previousStep}
              title="Previous stop"
            >
              ⏮
            </button>
            <button
              className="picking-panel__transport-btn"
              disabled={run.currentLegIndex >= run.legs.length}
              onClick={simulation.togglePause}
              title={run.isPaused ? "Resume" : "Pause"}
            >
              {run.isPaused ? "▶" : "⏸"}
            </button>
            <button
              className="picking-panel__transport-btn"
              disabled={run.currentLegIndex >= run.legs.length}
              onClick={simulation.nextStep}
              title="Next stop"
            >
              ⏭
            </button>
            <button className="picking-panel__transport-btn" onClick={simulation.stop} title="Stop">
              ⏹
            </button>
          </div>
          {/* Each tick is one leg/stop — dragging fast-forwards through the
              intervening pick/store/deliver/load events for real, same as
              letting the animation play there; dragging back only moves the
              displayed position (see SimulationContext.goToStep). */}
          <input
            className="picking-panel__transport-slider"
            type="range"
            min={0}
            max={run.legs.length}
            step={1}
            value={Math.min(run.currentLegIndex, run.legs.length)}
            onChange={(e) => simulation.goToStep(Number(e.target.value))}
          />
          <div className="picking-panel__transport-label">
            Stop {Math.min(run.currentLegIndex + 1, run.stops.length)}/{run.stops.length} —{" "}
            {run.stops[Math.min(run.currentLegIndex, run.stops.length - 1)]?.id}
          </div>
        </div>
      ) : (
        run && (
          <div className="picking-panel__status">
            Finished <strong>{run.list.label}</strong>
          </div>
        )
      )}
    </div>
  );
}
