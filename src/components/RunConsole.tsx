import { useRef, useState } from "react";
import type { PickingList, PickingStop } from "../types/simulation";
import { useEditor } from "../state/EditorContext";
import { useSimulation, type ActiveRun, type StopEvent } from "../state/SimulationContext";
import { useAnalytics } from "../state/AnalyticsContext";
import { formatDuration } from "../lib/metrics";
import { handlingBreakdown, handlingTime, legTravelTime } from "../lib/timeModel";
import { useDraggable } from "../lib/useDraggable";

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

/**
 * What a step costs under the current time model, itemised — the same
 * components the performance board totals up, shown for one step so a slow
 * row explains itself (a deep, high pallet at the end of a long leg reads
 * very differently from a short hop to a floor-level one).
 *
 * Falls back to nothing when the run wasn't recorded (capture disarmed), as
 * there's no resolved tier/depth to price.
 */
function StepMetrics({ run, stopIndex, anchor }: { run: ActiveRun; stopIndex: number; anchor: DOMRect | null }) {
  const simulation = useSimulation();
  const { settings } = useAnalytics();

  const recorded = simulation.sessionRuns[run.sessionIndex];
  if (!recorded) return null;

  const profile = stopIndex > 0 ? recorded.profiles[stopIndex - 1] : null;
  const handling = recorded.handling[stopIndex];
  if (!handling) return null;

  const travel = profile ? legTravelTime(profile, settings) : 0;
  const work = handlingTime(handling, settings);
  const parts = handlingBreakdown(handling, settings);
  const distance = profile ? profile.segmentLengths.reduce((a, b) => a + b, 0) : 0;

  let cumulative = 0;
  for (let i = 0; i <= stopIndex; i++) {
    if (i > 0 && recorded.profiles[i - 1]) cumulative += legTravelTime(recorded.profiles[i - 1], settings);
    if (recorded.handling[i]) cumulative += handlingTime(recorded.handling[i], settings);
  }

  return (
    // Positioned from the hovered row's own rect: the console clips its
    // content, so the tooltip has to sit outside that box entirely.
    <div
      className="step-tip"
      style={anchor ? { top: anchor.top, left: anchor.right + 8 } : undefined}
    >
      <div className="step-tip__row">
        <span>Travel</span>
        <span>{formatDuration(travel)}</span>
      </div>
      {profile && (
        <div className="step-tip__sub">
          {distance.toFixed(1)} m · {profile.turns} turn{profile.turns === 1 ? "" : "s"}
        </div>
      )}
      <div className="step-tip__row">
        <span>Handling</span>
        <span>{formatDuration(work)}</span>
      </div>
      {parts.base > 0 && (
        <div className="step-tip__sub">
          base {formatDuration(parts.base)}
          {parts.tier > 0 ? ` · tier +${formatDuration(parts.tier)}` : ""}
          {parts.depth > 0 ? ` · depth +${formatDuration(parts.depth)}` : ""}
        </div>
      )}
      {handling.kind === "deliver" && <div className="step-tip__sub">{handling.pallets} pallet unload</div>}
      {handling.kind === "load" && <div className="step-tip__sub">{handling.pallets} pallet load</div>}
      <div className="step-tip__row step-tip__row--total">
        <span>Step</span>
        <span>{formatDuration(travel + work)}</span>
      </div>
      <div className="step-tip__row">
        <span>Tour so far</span>
        <span>{formatDuration(cumulative)}</span>
      </div>
    </div>
  );
}

/**
 * One order's operations, each row wired to blink its target (and the leg
 * reaching it) on hover, and to act on it when clicked. `live` says whether
 * these steps belong to the run the scene is currently showing: only then is
 * there a forklift to move, so for any other order a click selects the order
 * instead (see onSelect).
 */
function RunSteps({ run, live, onSelect }: { run: ActiveRun; live: boolean; onSelect: (index: number) => void }) {
  const simulation = useSimulation();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  return (
    <>
      {run.stops.map((stop, i) => {
        // currentLegIndex is the leg being *traveled*, so the forklift is
        // standing at (or heading away from) stop currentLegIndex: anything
        // before it is done, that one is where it is now.
        const state = !live ? "queued" : i < run.currentLegIndex ? "done" : i === run.currentLegIndex ? "current" : "todo";
        return (
          <div className="orders__step-item" key={i}>
            <button
              className={`orders__step orders__step--${state}`}
              data-row
              // Leg i-1 is the one that arrives at stop i; the very first
              // stop has nothing leading to it.
              onMouseEnter={(e) => {
                simulation.setHoveredStep({ stop, legIndex: i > 0 ? i - 1 : null });
                setAnchor(e.currentTarget.getBoundingClientRect());
              }}
              onMouseLeave={() => simulation.setHoveredStep(null)}
              onFocus={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
              onClick={() => onSelect(i)}
              title={live ? "Jump the forklift to this step" : "Show this order's route"}
            >
              <span className="orders__step-index">{i + 1}</span>
              <span className="orders__step-verb">{stepVerb(run.events[i], i, run.stops.length)}</span>
              <span className="orders__step-target">{stop.id}</span>
            </button>
            <StepMetrics run={run} stopIndex={i} anchor={anchor} />
          </div>
        );
      })}
    </>
  );
}

/** A list that hasn't started yet: its declared stops are known from the data, but its route (and therefore its depot bookends) isn't computed until it plays — so these rows preview the stops without pretending to be executable steps. */
function QueuedSteps({ stops }: { stops: PickingStop[] }) {
  const simulation = useSimulation();

  return (
    <>
      {stops.map((stop, i) => (
        <div
          key={i}
          className="orders__step orders__step--queued"
          data-row
          tabIndex={0}
          onMouseEnter={() => simulation.setHoveredStep({ stop, legIndex: null })}
          onMouseLeave={() => simulation.setHoveredStep(null)}
        >
          <span className="orders__step-index">{i + 1}</span>
          <span className="orders__step-verb">{stop.kind === "slot" ? "Visit" : "Depot"}</span>
          <span className="orders__step-target">{stop.id}</span>
        </div>
      ))}
    </>
  );
}

/** An order as the list shows it: one already played (with a route to inspect) or one still waiting behind the active run. */
interface DisplayOrder {
  key: string;
  list: PickingList;
  /** The run to draw steps from — synthesised from the record for orders that aren't the one currently on screen. Null for orders that haven't run yet. */
  run: ActiveRun | null;
  stops: PickingStop[];
  state: "running" | "paused" | "done" | "queued";
  /** Whether this order is the run the scene is currently showing. */
  live: boolean;
  captured: boolean;
  sessionIndex: number | null;
}

/**
 * The run console (specs.md §5.4): everything about *what is happening now* —
 * capture arming, transport, and the orders of the batch you last launched.
 * Docked under the breadcrumb, above the scene, while the side panel stays
 * the catalogue of lists you can launch: one place to watch, one place to
 * choose.
 *
 * The bar is three fixed lines whether collapsed or not (capture + metadata,
 * transport, playback options) — collapsing hides only the order list, so
 * every control keeps its place.
 */
export function RunConsole() {
  const { mode } = useEditor();
  const simulation = useSimulation();
  // Collapsed by default: the three control lines are what you need
  // constantly, the orders only when you go looking.
  const [collapsed, setCollapsed] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useDraggable(panelRef);

  if (mode !== "view") return null;

  const run = simulation.activeRun;
  // Static runs finish synchronously the instant they're started — there's
  // no "still in progress" state for them, unlike an animated run whose
  // vehicle hasn't reached the last leg yet.
  const isPlaying = run !== null && run.mode === "animated" && run.currentLegIndex < run.legs.length;
  const measuredSegments = Object.keys(simulation.edgeUsage).length;
  const measuredSlots = Object.keys(simulation.slotUsage).length;

  // The batch (or, while capturing, the accumulated record) plus whatever is
  // still queued behind it — one flat list of orders, newest last.
  const orders: DisplayOrder[] = simulation.sessionRuns.slice(simulation.orderListStart).map((entry, offset) => {
    const index = simulation.orderListStart + offset;
    const live = run !== null && run.sessionIndex === index;
    const playing = live && run.mode === "animated" && run.currentLegIndex < run.legs.length;
    return {
      key: entry.id,
      list: entry.list,
      // A finished order still has a full route to inspect: replayed from its
      // record as a completed static run, which is exactly what the scene
      // would show if you reviewed it.
      run: live
        ? run
        : {
            list: entry.list,
            mode: "static",
            stops: entry.stops,
            events: entry.events,
            legs: entry.legs,
            currentLegIndex: entry.legs.length,
            isPaused: false,
            sessionIndex: index,
          },
      stops: entry.stops,
      state: playing ? (run.isPaused ? "paused" : "running") : "done",
      live,
      captured: entry.captured,
      sessionIndex: index,
    };
  });

  for (const [i, list] of simulation.queuedLists.entries()) {
    orders.push({
      key: `queued-${list.id}-${i}`,
      list,
      run: null,
      stops: list.stops,
      state: "queued",
      live: false,
      captured: false,
      sessionIndex: null,
    });
  }

  const toggleExpanded = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /**
   * Selecting an order also puts its route back on screen — except while a
   * run is actually playing, when reviewing would cancel the rest of the
   * batch (showSessionRun drops the queue). Looking at the list must never
   * interrupt the thing the list is describing.
   */
  const selectOrder = (order: DisplayOrder) => {
    if (isPlaying || order.sessionIndex === null || order.live) return;
    simulation.showSessionRun(order.sessionIndex);
  };

  /** Arrow keys walk the flat row list — orders and any expanded steps alike — letting the whole batch be scanned without the mouse. */
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []);
    if (rows.length === 0) return;
    event.preventDefault();
    const current = rows.indexOf(document.activeElement as HTMLElement);
    const next =
      current === -1
        ? 0
        : event.key === "ArrowDown"
          ? Math.min(rows.length - 1, current + 1)
          : Math.max(0, current - 1);
    rows[next]?.focus();
  };

  return (
    <div
      className={drag.dragging ? "run-console run-console--dragging" : "run-console"}
      ref={panelRef}
      style={drag.style}
    >
      {/* The bar doubles as the drag handle — its own controls opt out, see
          useDraggable. Double-click puts the panel back where it started. */}
      <div
        className="run-console__bar"
        onPointerDown={drag.onPointerDown}
        onDoubleClick={drag.reset}
        title="Drag to move · double-click to reset"
      >
        {/* Line 1 — capture and what it has measured so far. Capture is
            deliberately explicit: a run played to demo or debug shouldn't
            silently contaminate a measurement. */}
        <div className="run-console__line">
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

          <button
            className="run-console__expand"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Show the orders of this run" : "Hide the order list"}
          >
            {collapsed ? "▾" : "▴"}
          </button>
        </div>

        {/* Line 2 — transport. Single bars step between stops, double bars
            between runs. */}
        <div className="run-console__line run-console__transport">
          <button
            className="picking-panel__transport-btn"
            disabled={!simulation.canGoPreviousRun}
            onClick={simulation.previousRun}
            title="Previous run"
          >
            ⏮
          </button>
          <button
            className="picking-panel__transport-btn"
            disabled={!run || run.currentLegIndex === 0}
            onClick={simulation.previousStep}
            title="Previous stop"
          >
            ◀|
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
            |▶
          </button>
          <button
            className="picking-panel__transport-btn"
            disabled={!simulation.canGoNextRun}
            onClick={simulation.nextRun}
            title="Next run"
          >
            ⏭
          </button>
          <button className="picking-panel__transport-btn" disabled={!run} onClick={simulation.stop} title="Stop">
            ⏹
          </button>
        </div>

        {/* Line 3 — playback options, and what is on screen right now. */}
        <div className="run-console__line">
          <button
            className={simulation.animate ? "run-console__opt run-console__opt--on" : "run-console__opt"}
            onClick={() => simulation.setAnimate(!simulation.animate)}
            title="Drive the route instead of showing it complete. Never changes the route or its metrics."
          >
            Animate
          </button>
          {simulation.animate && (
            <input
              className="run-console__speed"
              type="number"
              min={0.5}
              max={10}
              step={0.5}
              value={simulation.speed}
              onChange={(e) => simulation.setSpeed(Math.max(0.5, Number(e.target.value) || 0.5))}
              title="Travel speed for the animation only (m/s)"
            />
          )}
          <span className="run-console__status">
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
          </span>
        </div>
      </div>

      {!collapsed && (
        <div className="run-console__body">
          {orders.length > 0 ? (
            <>
              <div className="orders__head">
                <span className="orders__head-title">Orders ({orders.length})</span>
                {simulation.captureArmed && <span className="orders__capturing">recording</span>}
                <button
                  className="capture__clear"
                  onClick={simulation.clearCapture}
                  title="Wipe the heatmaps and this list (leaves stock alone)"
                >
                  Clear
                </button>
              </div>

              {/* tabIndex so the arrow keys work straight after clicking in
                  the list area, before any row has been focused. */}
              <div className="orders__scroll" ref={scrollRef} tabIndex={0} onKeyDown={onKeyDown}>
                {orders.map((order) => {
                  const open = expanded.has(order.key);
                  return (
                    <div key={order.key}>
                      <button
                        className={
                          order.live
                            ? "orders__row orders__row--active"
                            : order.state === "queued"
                              ? "orders__row orders__row--queued"
                              : "orders__row"
                        }
                        data-row
                        onClick={() => {
                          toggleExpanded(order.key);
                          selectOrder(order);
                        }}
                        title={
                          order.state === "queued"
                            ? "Waiting to run — expand to preview its stops"
                            : isPlaying
                              ? "Expand to see its operations"
                              : "Expand its operations and show its route"
                        }
                      >
                        <span className="orders__caret">{open ? "▾" : "▸"}</span>
                        {order.captured && <span className="orders__dot" title="Measured into the heatmaps" />}
                        <span className="orders__name">{order.list.label}</span>
                        <ModeBadge list={order.list} />
                        <span
                          className={
                            order.state === "running"
                              ? "orders__state orders__state--running"
                              : "orders__state"
                          }
                        >
                          {order.state}
                        </span>
                      </button>

                      {open &&
                        (order.run ? (
                          <RunSteps
                            run={order.run}
                            live={order.live}
                            onSelect={(index) => (order.live ? simulation.goToStep(index) : selectOrder(order))}
                          />
                        ) : (
                          <QueuedSteps stops={order.stops} />
                        ))}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="orders__empty">
              {simulation.captureArmed
                ? "Capturing — run some lists and they will be recorded here."
                : "Run a selection of picking lists to see its orders here."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
