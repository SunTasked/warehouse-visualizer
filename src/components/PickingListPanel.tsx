import { useState } from "react";
import type { PickingList, PickingStop } from "../types/simulation";
import { useEditor } from "../state/EditorContext";
import { useSimulation, type ActiveRun, type StopEvent } from "../state/SimulationContext";

/**
 * What a given stop actually does, as a verb for the operations list — the
 * raw event type isn't enough on its own, because the first and last stops
 * of every run are the home lift station bookends (see stopsWithDepot) whose
 * own deliver/load event is a no-op, and calling those "Deliver" would be
 * misleading.
 */
function stepVerb(event: StopEvent | undefined, index: number, total: number): string {
  if (index === 0) return "Start";
  if (index === total - 1) return "Return";
  switch (event?.type) {
    case "pick":
      return "Pick";
    case "store":
      return "Store";
    case "deliver":
      return "Deliver";
    case "load":
      return "Load";
    default:
      return "Go to";
  }
}

/** One run expanded into its ordered operations, each row wired to blink its target on hover and move the forklift there on click. */
function RunSteps({ run }: { run: ActiveRun }) {
  const simulation = useSimulation();

  return (
    <ol className="ops__steps">
      {run.stops.map((stop, i) => {
        // currentLegIndex is the leg being *traveled*, so the forklift is
        // standing at (or heading away from) stop currentLegIndex: anything
        // before it is done, that one is where it is now.
        const state = i < run.currentLegIndex ? "done" : i === run.currentLegIndex ? "current" : "todo";
        return (
          <li key={i}>
            <button
              className={`ops__step ops__step--${state}`}
              onMouseEnter={() => simulation.setHoveredStep(stop)}
              onMouseLeave={() => simulation.setHoveredStep(null)}
              onClick={() => simulation.goToStep(i)}
              title="Jump the forklift to this step"
            >
              <span className="ops__step-index">{i + 1}</span>
              <span className="ops__step-verb">{stepVerb(run.events[i], i, run.stops.length)}</span>
              <span className="ops__step-target">{stop.id}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** A list that hasn't started yet: its declared stops are known from the data, but its route (and therefore its depot bookends) isn't computed until it plays — so these rows preview the stops without pretending to be executable steps. */
function QueuedSteps({ stops }: { stops: PickingStop[] }) {
  const simulation = useSimulation();

  return (
    <ol className="ops__steps">
      {stops.map((stop, i) => (
        <li key={i}>
          <div
            className="ops__step ops__step--queued"
            onMouseEnter={() => simulation.setHoveredStep(stop)}
            onMouseLeave={() => simulation.setHoveredStep(null)}
          >
            <span className="ops__step-index">{i + 1}</span>
            <span className="ops__step-verb">{stop.kind === "slot" ? "Visit" : "Depot"}</span>
            <span className="ops__step-target">{stop.id}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ModeBadge({ list }: { list: PickingList }) {
  return (
    <span
      className={
        list.mode === "picking"
          ? "picking-panel__badge picking-panel__badge--picking"
          : "picking-panel__badge picking-panel__badge--storing"
      }
    >
      {list.mode}
    </span>
  );
}

/**
 * Overlay menu for the forklift picking-list simulation (§5.3, §5.4): the
 * catalogue of test lists, the capture arming that decides whether a run is
 * measured, playback controls, and the operations list — every list in the
 * current run broken down step by step, so "what is the forklift actually
 * doing" is readable as text next to the 3D view rather than only inferable
 * from watching it drive.
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
  const measuredSegments = Object.keys(simulation.edgeUsage).length;
  const measuredSlots = Object.keys(simulation.slotUsage).length;
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

      {/* Capture is deliberately explicit: a run you play to demo or debug
          shouldn't silently contaminate a measurement, so nothing reaches
          the heatmaps unless this is armed first. */}
      <div className="capture">
        <button
          className={simulation.captureArmed ? "capture__arm capture__arm--on" : "capture__arm"}
          onClick={() => simulation.setCaptureArmed(!simulation.captureArmed)}
          title={
            simulation.captureArmed
              ? "Stop adding runs to the heatmaps"
              : "Start adding every run played to the path and slot heatmaps"
          }
        >
          <span className="capture__dot" />
          {simulation.captureArmed ? "Capturing usage" : "Capture usage"}
        </button>
        <div className="capture__meta">
          <span>
            {measuredSegments} segment{measuredSegments === 1 ? "" : "s"} · {measuredSlots} slot
            {measuredSlots === 1 ? "" : "s"}
          </span>
          <button
            className="capture__clear"
            disabled={measuredSegments === 0 && measuredSlots === 0}
            onClick={simulation.clearCapture}
            title="Wipe both heatmaps (leaves stock alone)"
          >
            Clear
          </button>
        </div>
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
          title="Undo every pallet the simulation moved (keeps the captured heatmaps)"
        >
          Reset warehouse
        </button>
      </div>

      {run && run.mode === "animated" && (
        <div className="picking-panel__transport">
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
            {/* Drives the rest of the current leg in half a second rather
                than teleporting — you still see where it went. */}
            <button
              className="picking-panel__transport-btn"
              disabled={run.currentLegIndex >= run.legs.length}
              onClick={simulation.nextStep}
              title="Next stop (fast-forwards the current leg)"
            >
              ⏭
            </button>
            <button className="picking-panel__transport-btn" onClick={simulation.stop} title="Stop">
              ⏹
            </button>
          </div>
        </div>
      )}

      {(run || simulation.queuedLists.length > 0) && (
        <div className="ops">
          <div className="ops__header">Operations</div>

          {run && (
            <div className="ops__list">
              <div className="ops__list-head">
                <span className="ops__list-name">{run.list.label}</span>
                <ModeBadge list={run.list} />
                <span className="ops__list-state">
                  {run.isPaused ? "paused" : isPlaying ? "running" : "done"}
                </span>
              </div>
              <RunSteps run={run} />
            </div>
          )}

          {simulation.queuedLists.map((list) => (
            <div className="ops__list ops__list--queued" key={list.id}>
              <div className="ops__list-head">
                <span className="ops__list-name">{list.label}</span>
                <ModeBadge list={list} />
                <span className="ops__list-state">queued</span>
              </div>
              <QueuedSteps stops={list.stops} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
