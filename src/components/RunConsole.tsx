import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PickingList } from "../types/simulation";
import { useEditor } from "../state/EditorContext";
import { useSimulation, type CapturedRun, type StopEvent } from "../state/SimulationContext";
import { useAnalytics } from "../state/AnalyticsContext";
import { formatDuration } from "../lib/metrics";
import { handlingBreakdown, handlingTime, legTravelTime } from "../lib/timeModel";
import { useDraggable } from "../lib/useDraggable";
import { useVirtualRows } from "../lib/useVirtualRows";

/** Matches `.orders__scroll`'s --order-row: every row, order or step, is this tall. */
const ROW_HEIGHT = 26;
/** Rows kept rendered above and below the visible ones, so scrolling and arrow keys never land on a gap. */
const OVERSCAN = 8;

const formatCount = (n: number) => n.toLocaleString("en-US");

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
 */
function StepMetrics({ record, stopIndex, anchor }: { record: CapturedRun; stopIndex: number; anchor: DOMRect | null }) {
  const { settings } = useAnalytics();

  const profile = stopIndex > 0 ? record.profiles[stopIndex - 1] : null;
  const handling = record.handling[stopIndex];
  if (!handling) return null;

  const travel = profile ? legTravelTime(profile, settings) : 0;
  const work = handlingTime(handling, settings);
  const parts = handlingBreakdown(handling, settings);
  const distance = profile ? profile.segmentLengths.reduce((a, b) => a + b, 0) : 0;

  let cumulative = 0;
  for (let i = 0; i <= stopIndex; i++) {
    if (i > 0 && record.profiles[i - 1]) cumulative += legTravelTime(record.profiles[i - 1], settings);
    if (record.handling[i]) cumulative += handlingTime(record.handling[i], settings);
  }

  return (
    // Positioned from the hovered row's own rect: the console clips its
    // content, so the tooltip has to sit outside that box entirely.
    <div className="step-tip" style={anchor ? { top: anchor.top, left: anchor.right + 8 } : undefined}>
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

/** A row of the order list: an order, or one step of an expanded order. */
type Row =
  | { kind: "order"; record: CapturedRun; sessionIndex: number }
  | { kind: "step"; record: CapturedRun; sessionIndex: number; stopIndex: number };

/**
 * The run console (specs.md §5.4): everything about *what is happening now* —
 * capture arming, transport, and the orders of the batch you last computed.
 * Docked under the breadcrumb, above the scene, while the side panel stays
 * the catalogue of lists you can launch: one place to watch, one place to
 * choose.
 *
 * The bar is three fixed lines whether collapsed or not (capture + metadata,
 * transport, playback options) — collapsing hides only the order list, so
 * every control keeps its place. A batch can hold thousands of orders, so
 * the list only renders the rows in view.
 */
export function RunConsole() {
  const { mode } = useEditor();
  const simulation = useSimulation();
  // Collapsed by default: the three control lines are what you need
  // constantly, the orders only when you go looking.
  const [collapsed, setCollapsed] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** A row the arrow keys moved to that wasn't rendered yet — focused once it is. */
  const pendingFocusRef = useRef<number | null>(null);
  const drag = useDraggable(panelRef);
  const { sessionRuns, orderListStart, lastBatch } = simulation;

  // A finished batch opens the order list: its runs are what there is to
  // look at now.
  useEffect(() => {
    if (lastBatch && !lastBatch.error) setCollapsed(false);
  }, [lastBatch]);

  const rows = useMemo(() => {
    const list: Row[] = [];
    for (let i = orderListStart; i < sessionRuns.length; i++) {
      const record = sessionRuns[i];
      list.push({ kind: "order", record, sessionIndex: i });
      if (expanded.has(record.id)) {
        for (let stopIndex = 0; stopIndex < record.stops.length; stopIndex++) {
          list.push({ kind: "step", record, sessionIndex: i, stopIndex });
        }
      }
    }
    return list;
  }, [sessionRuns, orderListStart, expanded]);
  const view = useVirtualRows<HTMLDivElement>(rows.length, ROW_HEIGHT, OVERSCAN);

  useLayoutEffect(() => {
    const target = pendingFocusRef.current;
    if (target === null) return;
    const element = view.element?.querySelector<HTMLElement>(`[data-row="${target}"]`);
    if (element) {
      element.focus({ preventScroll: true });
      pendingFocusRef.current = null;
    }
  });

  if (mode !== "view") return null;

  const run = simulation.activeRun;
  const computation = simulation.computation;
  const isPlaying = run !== null && run.mode === "animated" && run.currentLegIndex < run.legs.length;
  const measuredSegments = Object.keys(simulation.edgeUsage).length;
  const measuredSlots = Object.keys(simulation.slotUsage).length;
  const orderCount = sessionRuns.length - orderListStart;

  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Selecting an order puts its route on screen, unless it's already there. */
  const selectOrder = (sessionIndex: number) => {
    if (run?.sessionIndex === sessionIndex) return;
    simulation.showSessionRun(sessionIndex);
  };

  /** Arrow keys walk the flat row list — orders and any expanded steps alike — letting the whole batch be scanned without the mouse. */
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (rows.length === 0) return;
    event.preventDefault();
    const active = document.activeElement as HTMLElement | null;
    const current = active?.dataset.row !== undefined ? Number(active.dataset.row) : -1;
    const next =
      current === -1
        ? 0
        : event.key === "ArrowDown"
          ? Math.min(rows.length - 1, current + 1)
          : Math.max(0, current - 1);
    const box = view.element;
    if (box) {
      const top = next * ROW_HEIGHT;
      if (top < box.scrollTop) box.scrollTop = top;
      else if (top + ROW_HEIGHT > box.scrollTop + box.clientHeight) box.scrollTop = top + ROW_HEIGHT - box.clientHeight;
      view.setScrollTop(box.scrollTop);
    }
    const element = box?.querySelector<HTMLElement>(`[data-row="${next}"]`);
    if (element) element.focus({ preventScroll: true });
    else pendingFocusRef.current = next;
  };

  const renderRow = (row: Row, index: number) => {
    const live = run !== null && run.sessionIndex === row.sessionIndex;

    if (row.kind === "order") {
      const { record } = row;
      const open = expanded.has(record.id);
      const playing = live && isPlaying;
      return (
        <button
          key={`order-${record.id}`}
          className={live ? "orders__row orders__row--active" : "orders__row"}
          data-row={index}
          onClick={() => {
            toggleExpanded(record.id);
            selectOrder(row.sessionIndex);
          }}
          title={live ? "Expand its operations" : "Expand its operations and show its route"}
        >
          <span className="orders__caret">{open ? "▾" : "▸"}</span>
          {record.captured && <span className="orders__dot" title="Measured into the heatmaps" />}
          <span className="orders__name">{record.list.label}</span>
          <ModeBadge list={record.list} />
          <span className={playing ? "orders__state orders__state--running" : "orders__state"}>
            {playing ? (run.isPaused ? "paused" : "running") : live ? "shown" : "done"}
          </span>
        </button>
      );
    }

    const { record, stopIndex } = row;
    const stop = record.stops[stopIndex];
    // currentLegIndex is the leg being *traveled*, so the forklift is
    // standing at (or heading away from) stop currentLegIndex: anything
    // before it is done, that one is where it is now.
    const state = !live
      ? "queued"
      : stopIndex < run.currentLegIndex
        ? "done"
        : stopIndex === run.currentLegIndex
          ? "current"
          : "todo";
    return (
      <div className="orders__step-item" key={`step-${record.id}-${stopIndex}`}>
        <button
          className={`orders__step orders__step--${state}`}
          data-row={index}
          // Leg i-1 is the one that arrives at stop i — only meaningful for
          // the run actually drawn.
          onMouseEnter={(e) => {
            simulation.setHoveredStep({ stop, legIndex: live && stopIndex > 0 ? stopIndex - 1 : null });
            setAnchor(e.currentTarget.getBoundingClientRect());
          }}
          onMouseLeave={() => simulation.setHoveredStep(null)}
          onFocus={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
          onClick={() => (live ? simulation.goToStep(stopIndex) : selectOrder(row.sessionIndex))}
          title={live ? "Jump the forklift to this step" : "Show this order's route"}
        >
          <span className="orders__step-index">{stopIndex + 1}</span>
          <span className="orders__step-verb">{stepVerb(record.events[stopIndex], stopIndex, record.stops.length)}</span>
          <span className="orders__step-target">{stop.id}</span>
        </button>
        <StepMetrics record={record} stopIndex={stopIndex} anchor={anchor} />
      </div>
    );
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
                : "Start adding every run computed to the path and slot heatmaps"
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
          <button
            className="picking-panel__transport-btn"
            disabled={!run && !computation}
            onClick={simulation.stop}
            title="Stop"
          >
            ⏹
          </button>
        </div>

        {/* Line 3 — playback options, and what is on screen right now. */}
        <div className="run-console__line">
          <label
            className="run-console__animate"
            title="Drive the route shown instead of drawing it complete. Never changes the route or its metrics."
          >
            <input
              type="checkbox"
              checked={simulation.animate}
              onChange={(e) => simulation.setAnimate(e.target.checked)}
            />
            <span>Animate</span>
          </label>
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
          <label
            className={
              simulation.animate ? "run-console__animate" : "run-console__animate run-console__animate--disabled"
            }
            title={
              simulation.animate
                ? "Keep the camera on the forklift while it drives — scroll to zoom, drag to turn"
                : "Needs Animate: a route shown complete has no forklift to follow"
            }
          >
            <input
              type="checkbox"
              checked={simulation.follow}
              disabled={!simulation.animate}
              onChange={(e) => simulation.setFollow(e.target.checked)}
            />
            <span>Follow</span>
          </label>
          <span className="run-console__status">
            {computation ? (
              <>
                <strong>Computing routes</strong>{" "}
                <span>
                  {formatCount(computation.done)} / {formatCount(computation.total)}
                </span>
              </>
            ) : run ? (
              <>
                <strong>{run.list.label}</strong>{" "}
                <span>{run.isPaused ? "paused" : isPlaying ? "running" : "done"}</span>
              </>
            ) : lastBatch?.error ? (
              <span>Route computation failed</span>
            ) : lastBatch ? (
              <span>
                {formatCount(lastBatch.lists)} list{lastBatch.lists === 1 ? "" : "s"} computed in{" "}
                {lastBatch.seconds < 10 ? lastBatch.seconds.toFixed(1) : Math.round(lastBatch.seconds)} s
                {lastBatch.emptyPicks + lastBatch.fullStores > 0 && (
                  <span
                    className="run-console__skipped"
                    title={`${formatCount(lastBatch.emptyPicks)} picks found their slot empty, ${formatCount(lastBatch.fullStores)} stores found it full`}
                  >
                    {" "}
                    · {formatCount(lastBatch.emptyPicks + lastBatch.fullStores)} skipped
                  </span>
                )}
              </span>
            ) : (
              <span>Nothing running</span>
            )}
          </span>
        </div>
      </div>

      {!collapsed && (
        <div className="run-console__body">
          {orderCount > 0 ? (
            <>
              <div className="orders__head">
                <span className="orders__head-title">Orders ({formatCount(orderCount)})</span>
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
                  the list area, before any row has been focused. Spacers stand
                  in for the rows out of view (not a transform: the step
                  tooltips are position: fixed, which a transform would trap). */}
              <div
                className="orders__scroll"
                ref={view.ref}
                tabIndex={0}
                onKeyDown={onKeyDown}
                onScroll={view.onScroll}
              >
                <div style={{ height: view.before }} />
                {rows.slice(view.first, view.last).map((row, offset) => renderRow(row, view.first + offset))}
                <div style={{ height: view.after }} />
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
