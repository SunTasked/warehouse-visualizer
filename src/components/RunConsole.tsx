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

/** One run expanded into its ordered operations, each row wired to blink its target (and the leg reaching it) on hover, and to move the forklift there on click. */
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
              // Leg i-1 is the one that arrives at stop i; the very first
              // stop has nothing leading to it.
              onMouseEnter={() => simulation.setHoveredStep({ stop, legIndex: i > 0 ? i - 1 : null })}
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
            onMouseEnter={() => simulation.setHoveredStep({ stop, legIndex: null })}
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

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * The run console (specs.md §5.4): everything about *what is happening now* —
 * capture arming, transport, the current run's operations, and the history
 * of runs that fed the capture. Docked top-center, above the scene, while
 * the side panel stays the catalogue of lists you can launch: one place to
 * watch, one place to choose.
 */
export function RunConsole() {
  const { mode } = useEditor();
  const simulation = useSimulation();
  const [tab, setTab] = useState<"operations" | "history">("operations");

  if (mode !== "view" || !simulation.showPanel) return null;

  const run = simulation.activeRun;
  // Static runs finish synchronously the instant they're started — there's
  // no "still in progress" state for them, unlike an animated run whose
  // vehicle hasn't reached the last leg yet.
  const isPlaying = run !== null && run.mode === "animated" && run.currentLegIndex < run.legs.length;
  const measuredSegments = Object.keys(simulation.edgeUsage).length;
  const measuredSlots = Object.keys(simulation.slotUsage).length;
  const history = simulation.capturedRuns;

  return (
    <div className="run-console">
      <div className="run-console__bar">
        {/* Capture is deliberately explicit: a run played to demo or debug
            shouldn't silently contaminate a measurement. */}
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
          {simulation.captureArmed ? "Capturing" : "Capture"}
        </button>

        <span className="run-console__measured">
          {measuredSegments} segment{measuredSegments === 1 ? "" : "s"} · {measuredSlots} slot
          {measuredSlots === 1 ? "" : "s"}
        </span>

        <div className="run-console__transport">
          <button
            className="picking-panel__transport-btn"
            disabled={!run || run.currentLegIndex === 0}
            onClick={simulation.previousStep}
            title="Previous stop"
          >
            ⏮
          </button>
          <button
            className="picking-panel__transport-btn"
            disabled={!run || run.mode !== "animated" || run.currentLegIndex >= run.legs.length}
            onClick={simulation.togglePause}
            title={run?.isPaused ? "Resume" : "Pause"}
          >
            {run?.isPaused ? "▶" : "⏸"}
          </button>
          {/* Drives the rest of the current leg in half a second rather than
              teleporting — you still see where it went. */}
          <button
            className="picking-panel__transport-btn"
            disabled={!run || run.currentLegIndex >= run.legs.length}
            onClick={simulation.nextStep}
            title="Next stop (fast-forwards the current leg)"
          >
            ⏭
          </button>
          <button className="picking-panel__transport-btn" disabled={!run} onClick={simulation.stop} title="Stop">
            ⏹
          </button>
        </div>

        <div className="run-console__status">
          {run ? (
            <>
              <strong>{run.list.label}</strong>{" "}
              <span>
                {simulation.reviewedRunId
                  ? "reviewing"
                  : run.isPaused
                    ? "paused"
                    : isPlaying
                      ? "running"
                      : "done"}
              </span>
            </>
          ) : (
            <span>Nothing running</span>
          )}
        </div>
      </div>

      <div className="run-console__tabs">
        <button
          className={tab === "operations" ? "run-console__tab run-console__tab--active" : "run-console__tab"}
          onClick={() => setTab("operations")}
        >
          Operations
        </button>
        <button
          className={tab === "history" ? "run-console__tab run-console__tab--active" : "run-console__tab"}
          onClick={() => setTab("history")}
        >
          Record ({history.length})
        </button>
      </div>

      <div className="run-console__body">
        {tab === "operations" &&
          (run || simulation.queuedLists.length > 0 ? (
            <div className="ops">
              {run && (
                <div className="ops__list">
                  <div className="ops__list-head">
                    <span className="ops__list-name">{run.list.label}</span>
                    <ModeBadge list={run.list} />
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
          ) : (
            <div className="run-console__empty">Play a list to see its operations here.</div>
          ))}

        {tab === "history" &&
          (history.length > 0 ? (
            <div className="record">
              <div className="record__head">
                <span>Runs in this capture</span>
                <button className="capture__clear" onClick={simulation.clearCapture} title="Wipe the heatmaps and this record (leaves stock alone)">
                  Clear
                </button>
              </div>
              <ol className="record__list">
                {history
                  .map((entry, i) => ({ entry, index: i }))
                  .reverse()
                  .map(({ entry, index }) => (
                    <li key={entry.id}>
                      <button
                        className={
                          simulation.reviewedRunId === entry.id ? "record__row record__row--active" : "record__row"
                        }
                        onClick={() =>
                          simulation.reviewRun(simulation.reviewedRunId === entry.id ? null : entry.id)
                        }
                        title="Show this run's route again (does not re-run or re-count it)"
                      >
                        <span className="record__index">{index + 1}</span>
                        <span className="record__name">{entry.list.label}</span>
                        <ModeBadge list={entry.list} />
                        <span className="record__time">{formatTime(entry.at)}</span>
                      </button>
                    </li>
                  ))}
              </ol>
            </div>
          ) : (
            <div className="run-console__empty">
              {simulation.captureArmed
                ? "Capturing — play a list and it will be recorded here."
                : "Arm capture, then play lists to build a record."}
            </div>
          ))}
      </div>
    </div>
  );
}
