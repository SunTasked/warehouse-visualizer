import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type { Point } from "../types/warehouse";
import type { PickingList, PickingStop } from "../types/simulation";
import {
  RoutePlanner,
  runRecord,
  type BatchResult,
  type Leg,
  type RunRecord,
  type StopEvent,
  type WorkerReply,
  type WorkerRequest,
} from "../lib/runEngine";
import { useEditor } from "./EditorContext";
import { useViewFocus } from "./ViewFocusContext";

export { heldPalletsAt } from "../lib/runEngine";
export type { Leg, StopEvent } from "../lib/runEngine";

export type PlaybackMode = "animated" | "static";

/** How long a Next-step fast-forward takes to finish the leg it's on — short enough to click through a list quickly, long enough to still read as the forklift *driving* there. */
export const FAST_FORWARD_SECONDS = 0.5;

/**
 * The step the operations list is currently hovered over (RunConsole).
 * The scene blinks both the stop's own slot/facility and the route leg that
 * arrives there, so a row, a place and a path all read as the same thing.
 */
export interface HoveredStep {
  stop: PickingStop;
  /** Index into the active run's `legs` of the leg arriving at this stop — leg i runs stop i -> stop i+1, so arriving at stop k is leg k-1. Null for the first stop, and for a step of a run that isn't the one on screen. */
  legIndex: number | null;
}

/** One run computed this session: what was worked and what it cost (§5.5). Its route isn't kept — see RunRecord. */
export interface CapturedRun extends RunRecord {
  id: string;
  /** Wall-clock time its batch finished, for ordering and display. */
  at: number;
  /** Whether this run fed the heatmaps. A run computed with capture disarmed still belongs to the session (it is navigable, and it happened) — it just wasn't measured. */
  captured: boolean;
}

/** The run on screen: one of the session's runs, re-routed to be drawn and, with Animate on, driven. */
export interface ActiveRun {
  list: PickingList;
  mode: PlaybackMode;
  /** The list's own stops, with the forklift's home lift station around them. */
  stops: PickingStop[];
  /** Parallel to `stops`. */
  events: StopEvent[];
  /** One fewer than `stops`/`events` — leg i runs from stops[i] to stops[i+1]. */
  legs: Leg[];
  /** Which leg is currently being traveled (animated) — >= legs.length once finished/static. */
  currentLegIndex: number;
  /** Animated mode only — freezes the vehicle in place without losing progress. */
  isPaused: boolean;
  /** Index into sessionRuns, so the run-navigation buttons know where they are. */
  sessionIndex: number;
}

/** A batch of lists being routed in the worker. */
export interface Computation {
  done: number;
  total: number;
}

/** How the last batch went — for the console's status line. */
export interface BatchSummary {
  id: number;
  lists: number;
  seconds: number;
  emptyPicks: number;
  unknownStops: string[];
  error?: string;
}

interface SimulationContextValue {
  pickingLists: PickingList[];
  /**
   * Works lists through in the route worker: routes, stock and measurements
   * for all of them, with `computation` reporting progress, then lands the
   * lot at once — the session's runs, one stock change, the heatmaps if
   * capture was armed. Resolves true once landed, false if cancelled or
   * superseded. `show` puts the first run on screen when it lands (a single
   * list's Play); a batch leaves the scene clear.
   */
  runLists: (lists: PickingList[], options?: { show?: boolean }) => Promise<boolean>;
  computation: Computation | null;
  cancelComputation: () => void;
  lastBatch: BatchSummary | null;
  activeRun: ActiveRun | null;
  /** Whether a shown run is driven by the forklift or drawn complete. A presentation choice: the route, the events and every metric are identical either way. */
  animate: boolean;
  setAnimate: (value: boolean) => void;
  /** Meters/second, animated mode only. */
  speed: number;
  setSpeed: (value: number) => void;
  /** Whether the camera keeps the forklift in view while it drives (WarehouseScene's FollowCameraDriver). Only does anything for an animated run. */
  follow: boolean;
  setFollow: (value: boolean) => void;
  /** Where the forklift is drawn right now, or null when there is none — written every frame by Forklift.tsx, so a ref, like progressRef. */
  vehiclePositionRef: MutableRefObject<Point | null>;
  /** Clears the scene of any route, and cancels a batch still computing. */
  stop: () => void;
  togglePause: () => void;
  /** Jumps to a leg boundary (0..legs.length). Pure navigation: the run's stock changes landed with its batch. */
  goToStep: (target: number) => void;
  nextStep: () => void;
  previousStep: () => void;
  /** Distance traveled (meters) within the active run's current leg — a ref, not state, so the per-frame vehicle animation (Forklift.tsx) doesn't trigger a React re-render every frame. */
  progressRef: MutableRefObject<number>;
  /** Non-null while a Next-step fast-forward is in flight: the m/s that finishes the current leg's *remaining* distance in FAST_FORWARD_SECONDS. A ref for the same reason progressRef is. */
  fastForwardSpeedRef: MutableRefObject<number | null>;
  /** Directed per-segment travel tallies keyed `"${nodeKeyA}→${nodeKeyB}"` — read by Paths.tsx for the path heatmap. Only accumulates while capture is armed. */
  edgeUsage: Record<string, number>;
  /** Per-slot interaction tallies (one per pick or store) — read by SlotHeatmap.tsx. Only accumulates while capture is armed. */
  slotUsage: Record<string, number>;
  /** While armed, every batch computed adds to both heatmaps; while off, runs are computed and navigable but measure nothing. */
  captureArmed: boolean;
  setCaptureArmed: (value: boolean) => void;
  /** Every run computed this session, in order, whether or not capture was armed — what the order list and run navigation walk. */
  sessionRuns: CapturedRun[];
  /**
   * First index into `sessionRuns` the console's order list shows (§5.4).
   * A new batch or a stop resets it to "from here on", so the list is just
   * what you last launched — *unless* capture is armed, in which case it
   * stays put and the list accumulates as the record of the capture.
   */
  orderListStart: number;
  /** The subset of sessionRuns that fed the heatmaps — the record of what produced the current capture. */
  capturedRuns: CapturedRun[];
  /** Puts a run of this session on screen: re-routed and drawn (driven, with Animate on), nothing re-applied or re-counted. */
  showSessionRun: (index: number) => void;
  nextRun: () => void;
  previousRun: () => void;
  canGoNextRun: boolean;
  canGoPreviousRun: boolean;
  /** Discards the whole session — runs, heatmaps, the run on screen and any batch computing. Used when entering edit mode or loading another plant. */
  clearSession: () => void;
  /** Wipes both heatmaps and the run history, leaving inventory alone. */
  clearCapture: () => void;
  /** Reverts every simulated pallet move via the editor's own undo history, leaving the captured heatmaps alone — so stock can be restored mid-capture without losing the measurement. */
  resetWarehouse: () => void;
  hoveredStep: HoveredStep | null;
  setHoveredStep: (value: HoveredStep | null) => void;
}

const SimulationContext = createContext<SimulationContextValue | null>(null);

/** A batch sent to the worker and not yet back. */
interface PendingBatch {
  jobId: number;
  /** The lists sent, which the worker's costs are matched back to by position. */
  lists: PickingList[];
  /** The home lift station they were routed from. */
  homeId: string | undefined;
  show: boolean;
  captured: boolean;
  startedAt: number;
  resolve: (completed: boolean) => void;
}

function addCounts(current: Record<string, number>, extra: Record<string, number>): Record<string, number> {
  const next = { ...current };
  for (const key in extra) next[key] = (next[key] ?? 0) + extra[key];
  return next;
}

export function SimulationProvider({ children }: { children: ReactNode }) {
  const editor = useEditor();
  const { warehouse } = editor;
  const { revealPlant } = useViewFocus();
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  // Off by default: showing a route complete is the quicker read, and the
  // metrics are identical either way.
  const [animate, setAnimateState] = useState(false);
  /** Mirrors `animate` for a batch landing with `show`, which reads it outside a render. */
  const animateRef = useRef(animate);
  const [speed, setSpeed] = useState(2); // m/s — a plausible forklift travel speed
  const [follow, setFollow] = useState(false);
  const vehiclePositionRef = useRef<Point | null>(null);
  // Directed per-segment travel tallies for the path heatmap (Paths.tsx), so
  // a corridor traveled one way and back is two independent counts.
  const [edgeUsage, setEdgeUsage] = useState<Record<string, number>>({});
  // One tally per pick or store at a slot, for the slot heatmap
  // (SlotHeatmap.tsx) — answers "is load balanced across the racks", which
  // the path tallies can't, since several slots share one corridor.
  const [slotUsage, setSlotUsage] = useState<Record<string, number>>({});
  const [captureArmed, setCaptureArmedState] = useState(false);
  /**
   * Mirrors `captureArmed` for runLists and beginOrderList: the capture
   * prompt's "Run without capturing" disarms and launches in one click,
   * before React re-renders, and reading the state would still find capture
   * armed and measure the batch after all.
   */
  const captureArmedRef = useRef(captureArmed);
  const setCaptureArmed = useCallback((value: boolean) => {
    captureArmedRef.current = value;
    setCaptureArmedState(value);
  }, []);
  const [sessionRuns, setSessionRuns] = useState<CapturedRun[]>([]);
  const [orderListStart, setOrderListStart] = useState(0);
  const [computation, setComputation] = useState<Computation | null>(null);
  const [lastBatch, setLastBatch] = useState<BatchSummary | null>(null);
  const [hoveredStep, setHoveredStep] = useState<HoveredStep | null>(null);
  const progressRef = useRef(0);
  const fastForwardSpeedRef = useRef<number | null>(null);
  /** Next index into sessionRuns — known before the state catches up, so a landing batch can number its runs. */
  const sessionCountRef = useRef(0);

  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<PendingBatch | null>(null);
  const jobCounterRef = useRef(0);
  const replyHandlerRef = useRef<(reply: WorkerReply) => void>(() => {});

  // Showing a run routes it again on this thread, with the same planner the
  // worker builds: same corridors, same slot positions, so the same route.
  const planner = useMemo(
    () =>
      new RoutePlanner({
        paths: warehouse.paths,
        slots: warehouse.slots,
        liftStations: warehouse.liftStations,
        deliverySpaces: warehouse.deliverySpaces,
        slotDefaults: warehouse.slotDefaults,
      }),
    [warehouse.paths, warehouse.slots, warehouse.liftStations, warehouse.deliverySpaces, warehouse.slotDefaults],
  );

  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      const worker = new Worker(new URL("../workers/runWorker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<WorkerReply>) => replyHandlerRef.current(event.data);
      worker.onerror = (event) => {
        event.preventDefault();
        const jobId = pendingRef.current?.jobId ?? -1;
        replyHandlerRef.current({ type: "error", jobId, message: event.message || "the route worker failed" });
      };
      workerRef.current = worker;
    }
    return workerRef.current;
  }, []);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  /**
   * Marks where the console's order list starts. A fresh batch (or a stop)
   * normally replaces whatever was listed — but while capture is armed the
   * list *is* the capture's record, so it keeps everything and simply grows.
   */
  const beginOrderList = useCallback(() => {
    if (!captureArmedRef.current) setOrderListStart(sessionCountRef.current);
  }, []);

  const showRun = useCallback(
    (record: RunRecord, sessionIndex: number) => {
      // Don't let a cross-building route get truncated by per-building
      // visibility (§5.1) — but leave the camera where the user put it.
      revealPlant();
      const legs = planner.legs(record.stops);
      progressRef.current = 0;
      fastForwardSpeedRef.current = null;
      const animated = animateRef.current && legs.length > 0;
      setActiveRun({
        list: record.list,
        mode: animated ? "animated" : "static",
        stops: record.stops,
        events: record.events,
        legs,
        currentLegIndex: animated ? 0 : legs.length,
        isPaused: false,
        sessionIndex,
      });
    },
    [planner, revealPlant],
  );

  /** A finished batch, landed at once: its runs join the session, its stock is one history entry, its tallies join the heatmaps. */
  const landBatch = (pending: PendingBatch, result: BatchResult) => {
    const at = Date.now();
    beginOrderList();
    const first = sessionCountRef.current;
    const records: CapturedRun[] = result.runs.map((cost, i) => ({
      ...runRecord(pending.lists[i], pending.homeId, cost),
      id: `${pending.lists[i].id}-${at}-${first + i}`,
      at,
      captured: pending.captured,
    }));
    sessionCountRef.current += records.length;
    setSessionRuns((current) => [...current, ...records]);

    if (Object.keys(result.stock).length > 0) {
      editor.applySimulatedStock(
        result.stock,
        records.length === 1 ? `Run ${records[0].list.label}` : `Run ${records.length.toLocaleString("en-US")} picking lists`,
      );
    }
    if (pending.captured) {
      setEdgeUsage((current) => addCounts(current, result.edgeUsage));
      setSlotUsage((current) => addCounts(current, result.slotUsage));
    }
    // One line for the whole batch, rather than one warning per stop.
    if (result.emptyPicks > 0) console.warn(`${result.emptyPicks} pick(s) found their slot empty and were skipped`);
    if (result.unknownStops.length > 0) console.warn(`Stops not in this plan, skipped: ${result.unknownStops.join(", ")}`);

    setLastBatch({
      id: pending.jobId,
      lists: records.length,
      seconds: (performance.now() - pending.startedAt) / 1000,
      emptyPicks: result.emptyPicks,
      unknownStops: result.unknownStops,
    });
    if (pending.show && records.length > 0) showRun(records[0], first);
  };

  // Reassigned every render, so a reply always lands on the current warehouse
  // and session rather than whatever was current when the worker was made.
  replyHandlerRef.current = (reply: WorkerReply) => {
    const pending = pendingRef.current;
    if (!pending || reply.jobId !== pending.jobId) return; // cancelled or superseded
    if (reply.type === "progress") {
      setComputation({ done: reply.done, total: reply.total });
      return;
    }
    pendingRef.current = null;
    setComputation(null);
    if (reply.type === "error") {
      console.error(`Route computation failed: ${reply.message}`);
      setLastBatch({
        id: pending.jobId,
        lists: pending.lists.length,
        seconds: (performance.now() - pending.startedAt) / 1000,
        emptyPicks: 0,
        unknownStops: [],
        error: reply.message,
      });
      pending.resolve(false);
      return;
    }
    landBatch(pending, reply.result);
    pending.resolve(true);
  };

  const cancelComputation = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    workerRef.current?.postMessage({ type: "cancel", jobId: pending.jobId } satisfies WorkerRequest);
    setComputation(null);
    pending.resolve(false);
  }, []);

  const runLists = useCallback(
    (lists: PickingList[], options: { show?: boolean } = {}): Promise<boolean> => {
      if (lists.length === 0) return Promise.resolve(false);
      cancelComputation();
      const jobId = ++jobCounterRef.current;
      fastForwardSpeedRef.current = null;
      setActiveRun(null);
      setComputation({ done: 0, total: lists.length });
      const request: WorkerRequest = {
        type: "run",
        jobId,
        layout: {
          paths: warehouse.paths,
          slots: warehouse.slots,
          liftStations: warehouse.liftStations,
          deliverySpaces: warehouse.deliverySpaces,
          slotDefaults: warehouse.slotDefaults,
        },
        lists,
        capture: captureArmedRef.current,
      };
      return new Promise<boolean>((resolve) => {
        const pending: PendingBatch = {
          jobId,
          lists,
          homeId: warehouse.liftStations[0]?.id,
          show: options.show ?? false,
          captured: captureArmedRef.current,
          startedAt: performance.now(),
          resolve,
        };
        pendingRef.current = pending;
        try {
          getWorker().postMessage(request);
        } catch (error) {
          replyHandlerRef.current({ type: "error", jobId, message: error instanceof Error ? error.message : String(error) });
        }
      });
    },
    [warehouse, cancelComputation, getWorker],
  );

  /**
   * Clears the scene of any route, and cancels a batch still computing. The
   * order list follows the same armed/not rule as starting a batch: stopping
   * mid-capture must not throw away the record of what has been measured.
   */
  const stop = useCallback(() => {
    cancelComputation();
    fastForwardSpeedRef.current = null;
    setActiveRun(null);
    beginOrderList();
  }, [cancelComputation, beginOrderList]);

  const togglePause = useCallback(() => {
    setActiveRun((run) => (run ? { ...run, isPaused: !run.isPaused } : run));
  }, []);

  /**
   * The single function behind natural leg completion (Forklift.tsx's
   * useFrame driver calling goToStep(current + 1) on arrival), the transport
   * buttons, and clicking a step in the order list. Pure navigation, in either
   * direction: a run's picks and stores were applied when its batch landed,
   * so driving, stepping or scrubbing through it changes nothing but where
   * the forklift is drawn.
   */
  const goToStep = useCallback((target: number) => {
    progressRef.current = 0;
    fastForwardSpeedRef.current = null;
    setActiveRun((run) =>
      run ? { ...run, currentLegIndex: Math.max(0, Math.min(run.legs.length, target)) } : run,
    );
  }, []);

  /**
   * Next *drives* to the following stop rather than teleporting to it: it
   * sets the speed that covers whatever's left of the current leg in
   * FAST_FORWARD_SECONDS, and the vehicle's own useFrame (Forklift.tsx)
   * completes the leg from there, arriving through the normal goToStep path.
   * Falls back to a plain jump when nothing is being animated.
   */
  const nextStep = useCallback(() => {
    const run = activeRun;
    if (!run || run.mode !== "animated" || run.currentLegIndex >= run.legs.length) {
      goToStep((run?.currentLegIndex ?? 0) + 1);
      return;
    }
    const remaining = Math.max(0, run.legs[run.currentLegIndex].length - progressRef.current);
    fastForwardSpeedRef.current = remaining / FAST_FORWARD_SECONDS;
    // A fast-forward is movement, so un-pause — otherwise the vehicle's
    // useFrame would ignore the new speed and nothing would happen.
    if (run.isPaused) setActiveRun({ ...run, isPaused: false });
  }, [activeRun, goToStep]);

  const previousStep = useCallback(() => goToStep((activeRun?.currentLegIndex ?? 0) - 1), [activeRun, goToStep]);

  /** Only the runs that actually fed the heatmaps — the record behind the current capture. */
  const capturedRuns = useMemo(() => sessionRuns.filter((run) => run.captured), [sessionRuns]);

  /** Wipes both captured heatmaps and the record of what produced them. Inventory is left exactly as it is, so a capture can be discarded and restarted without disturbing stock. */
  const clearCapture = useCallback(() => {
    setEdgeUsage({});
    setSlotUsage({});
    setSessionRuns([]);
    sessionCountRef.current = 0;
    setOrderListStart(0);
    setActiveRun(null);
  }, []);

  /** Everything the session holds. Entering edit mode does this — the routes were computed against a layout that's about to change, so keeping them would mean scoring runs that could no longer happen. */
  const clearSession = useCallback(() => {
    cancelComputation();
    fastForwardSpeedRef.current = null;
    progressRef.current = 0;
    setSessionRuns([]);
    sessionCountRef.current = 0;
    setOrderListStart(0);
    setEdgeUsage({});
    setSlotUsage({});
    setActiveRun(null);
    setLastBatch(null);
    setCaptureArmed(false);
  }, [cancelComputation, setCaptureArmed]);

  const showSessionRun = useCallback(
    (index: number) => {
      const record = sessionRuns[index];
      if (record) showRun(record, index);
    },
    [sessionRuns, showRun],
  );

  const currentRunIndex = activeRun?.sessionIndex ?? -1;
  const canGoPreviousRun = currentRunIndex > 0;
  const canGoNextRun = currentRunIndex >= 0 && currentRunIndex < sessionRuns.length - 1;

  const previousRun = useCallback(() => {
    if (currentRunIndex > 0) showSessionRun(currentRunIndex - 1);
  }, [currentRunIndex, showSessionRun]);

  const nextRun = useCallback(() => {
    if (currentRunIndex >= 0 && currentRunIndex < sessionRuns.length - 1) showSessionRun(currentRunIndex + 1);
  }, [currentRunIndex, sessionRuns.length, showSessionRun]);

  /**
   * Animate is a presentation choice, so flipping it never recomputes
   * anything. Turning it off shows the run on screen complete; turning it on
   * drives that same route from the start.
   */
  const setAnimate = useCallback((value: boolean) => {
    animateRef.current = value;
    setAnimateState(value);
    progressRef.current = 0;
    fastForwardSpeedRef.current = null;
    setActiveRun((run) => {
      if (!run) return run;
      if (!value) return { ...run, mode: "static", currentLegIndex: run.legs.length, isPaused: false };
      return run.legs.length > 0 ? { ...run, mode: "animated", currentLegIndex: 0, isPaused: false } : run;
    });
  }, []);

  /**
   * Discards the simulation's pallet moves by stepping the editor's own
   * history back over them (revertSimulation) — each batch landed as one
   * entry tagged as the simulation's. Stops at the first entry that wasn't,
   * so layout edits made before the runs survive a reset, and the
   * unsaved-changes indicator stays untouched.
   *
   * Deliberately leaves the captured heatmaps alone (clearCapture is its own
   * action): restocking between runs is a normal thing to do *during* a
   * capture. A batch still computing is cancelled — it started from the
   * stock being thrown away.
   */
  const resetWarehouse = useCallback(() => {
    cancelComputation();
    fastForwardSpeedRef.current = null;
    setActiveRun(null);
    editor.revertSimulation();
  }, [cancelComputation, editor]);

  const value = useMemo<SimulationContextValue>(
    () => ({
      // Plant data, loaded with the plan and content (EditorContext) —
      // presets or Overview → Load → Picking lists.
      pickingLists: editor.pickingLists,
      runLists,
      computation,
      cancelComputation,
      lastBatch,
      activeRun,
      animate,
      setAnimate,
      speed,
      setSpeed,
      follow,
      setFollow,
      vehiclePositionRef,
      stop,
      togglePause,
      goToStep,
      nextStep,
      previousStep,
      progressRef,
      fastForwardSpeedRef,
      edgeUsage,
      slotUsage,
      captureArmed,
      setCaptureArmed,
      sessionRuns,
      orderListStart,
      capturedRuns,
      showSessionRun,
      nextRun,
      previousRun,
      canGoNextRun,
      canGoPreviousRun,
      clearSession,
      clearCapture,
      resetWarehouse,
      hoveredStep,
      setHoveredStep,
    }),
    [
      editor.pickingLists,
      runLists,
      computation,
      cancelComputation,
      lastBatch,
      activeRun,
      animate,
      setAnimate,
      speed,
      follow,
      stop,
      togglePause,
      goToStep,
      nextStep,
      previousStep,
      edgeUsage,
      slotUsage,
      captureArmed,
      setCaptureArmed,
      sessionRuns,
      orderListStart,
      capturedRuns,
      showSessionRun,
      nextRun,
      previousRun,
      canGoNextRun,
      canGoPreviousRun,
      clearSession,
      clearCapture,
      resetWarehouse,
      hoveredStep,
    ],
  );

  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
}

export function useSimulation(): SimulationContextValue {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error("useSimulation must be used within a SimulationProvider");
  return ctx;
}
