import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type { Point, Warehouse } from "../types/warehouse";
import type { PickingList, PickingStop } from "../types/simulation";
import { pickingLists as exampleLists } from "../data/pickingLists";
import { buildPathGraph, routeBetween, type PathGraph, type RouteEdge } from "../lib/pathGraph";
import { slotEntryPoint } from "../lib/geometry";
import type { LegProfile, StopHandling } from "../lib/timeModel";
import { useEditor } from "./EditorContext";
import { useViewFocus } from "./ViewFocusContext";

export type PlaybackMode = "animated" | "static";

/** How long a Next-step fast-forward takes to finish the leg it's on — short enough to click through a list quickly, long enough to still read as the forklift *driving* there. */
export const FAST_FORWARD_SECONDS = 0.5;

export interface Leg {
  from: PickingStop;
  to: PickingStop;
  /** Route polyline for this leg, riding the path network (see src/lib/pathGraph.ts). */
  points: Point[];
  length: number;
  /** Real-node-to-real-node hops this leg's route actually rides, in order — used to tally directed per-segment usage counts once the leg is traveled for real (see edgeUsage below). */
  edges: RouteEdge[];
}

export type StopEvent =
  | { type: "pick"; slotId: string }
  | { type: "store"; slotId: string }
  | { type: "deliver" }
  | { type: "load" };

/**
 * The step the operations list is currently hovered over (PickingListPanel).
 * The scene blinks both the stop's own slot/facility and the route leg that
 * arrives there, so a row, a place and a path all read as the same thing.
 *
 * The stop is stored resolved (rather than as a list+index pair) so a queued
 * list's declared stops blink too — those have no computed route yet, which
 * is exactly when `legIndex` is null.
 */
export interface HoveredStep {
  stop: PickingStop;
  /** Index into the active run's `legs` of the leg arriving at this stop — leg i runs stop i -> stop i+1, so arriving at stop k is leg k-1. Null for the first stop (nothing leads to it) and for not-yet-routed queued lists. */
  legIndex: number | null;
}

/** One executed run kept in the capture's history — enough to re-display its route without re-running (or re-counting) it, and to score it (§5.5). */
export interface CapturedRun {
  id: string;
  list: PickingList;
  stops: PickingStop[];
  events: StopEvent[];
  legs: Leg[];
  /** Geometry-free per-leg profile for the time model — see LegProfile. */
  profiles: LegProfile[];
  /** What each stop cost to work, resolved against the inventory as it stood when this run was recorded. */
  handling: StopHandling[];
  /** Wall-clock time it was executed, for ordering and display. */
  at: number;
  /** Whether this run fed the heatmaps. A run played with capture disarmed still belongs to the session (it is navigable, and it happened) — it just wasn't measured. */
  captured: boolean;
}

export interface ActiveRun {
  list: PickingList;
  mode: PlaybackMode;
  /** The list's own stops, with the forklift's home lift station prepended — see stopsWithDepot() below. */
  stops: PickingStop[];
  /** Parallel to `stops`. */
  events: StopEvent[];
  /** One fewer than `stops`/`events` — leg i runs from stops[i] to stops[i+1]. */
  legs: Leg[];
  /** Which leg is currently being traveled (animated) — >= legs.length once finished/static. */
  currentLegIndex: number;
  /** Animated mode only — freezes the vehicle in place without losing progress. */
  isPaused: boolean;
  /** Index into sessionRuns, so the run-navigation buttons know where they are. -1 while a run is still being set up. */
  sessionIndex: number;
}

interface SimulationContextValue {
  pickingLists: PickingList[];
  activeRun: ActiveRun | null;
  /** Whether the forklift drives the route or it simply appears complete. A presentation choice on the play widget, not a property of the run: the route, the events and every metric are identical either way. */
  animate: boolean;
  setAnimate: (value: boolean) => void;
  /** Meters/second, animated mode only. */
  speed: number;
  setSpeed: (value: number) => void;
  playList: (list: PickingList) => void;
  playQueue: (lists: PickingList[]) => void;
  stop: () => void;
  togglePause: () => void;
  /** Jumps directly to a leg boundary (0..legs.length) — the slider's "each tick is a step". Stepping forward applies the events passed along the way; stepping backward only moves the displayed position (see the doc comment on goToStep itself for why). */
  goToStep: (target: number) => void;
  nextStep: () => void;
  previousStep: () => void;
  showPanel: boolean;
  setShowPanel: (value: boolean) => void;
  /** Distance traveled (meters) within the active run's current leg — a ref, not state, so the per-frame vehicle animation (Forklift.tsx) doesn't trigger a React re-render every frame. */
  progressRef: MutableRefObject<number>;
  /** Non-null while a Next-step fast-forward is in flight: the m/s that finishes the current leg's *remaining* distance in FAST_FORWARD_SECONDS. A ref for the same reason progressRef is. */
  fastForwardSpeedRef: MutableRefObject<number | null>;
  /** Lists waiting behind the active run, so the operations list can show what's still coming ("list by list"). */
  queuedLists: PickingList[];
  /** Directed per-segment travel tallies keyed `"${nodeIdA}→${nodeIdB}"` — read by Paths.tsx for the path heatmap. Only accumulates while capture is armed. */
  edgeUsage: Record<string, number>;
  /** Per-slot interaction tallies (one per pick or store) — read by SlotHeatmap.tsx. Only accumulates while capture is armed. */
  slotUsage: Record<string, number>;
  /** While armed, every list played adds to both heatmaps; while off, runs play and animate but measure nothing. */
  captureArmed: boolean;
  setCaptureArmed: (value: boolean) => void;
  /** Every run played this session in play order, whether or not capture was armed — what the run-navigation buttons walk. */
  sessionRuns: CapturedRun[];
  /**
   * First index into `sessionRuns` the console's order list shows (§5.4).
   * Starting a new batch or stopping resets it to "from here on", so the list
   * is just what you last launched — *unless* capture is armed, in which case
   * it stays put and the list accumulates as the record of the capture.
   */
  orderListStart: number;
  /** The subset of sessionRuns that fed the heatmaps — the record of what produced the current capture. */
  capturedRuns: CapturedRun[];
  /** Re-displays a run already played this session, read-only: its route is drawn, but nothing is re-applied or re-counted. */
  showSessionRun: (index: number) => void;
  nextRun: () => void;
  previousRun: () => void;
  canGoNextRun: boolean;
  canGoPreviousRun: boolean;
  /** Discards the whole session — runs, heatmaps and the active run. Used when entering edit mode (see App). */
  clearSession: () => void;
  /** Which captured run is being re-displayed in the scene (read-only; it is not re-executed and does not re-count). */
  reviewedRunId: string | null;
  reviewRun: (id: string | null) => void;
  /** Wipes both heatmaps and the run history, leaving inventory alone. */
  clearCapture: () => void;
  /** Reverts every simulated pallet mutation via the editor's own undo history, leaving the captured heatmaps alone — so stock can be restored mid-capture without losing the measurement. */
  resetWarehouse: () => void;
  hoveredStep: HoveredStep | null;
  setHoveredStep: (value: HoveredStep | null) => void;
}

const SimulationContext = createContext<SimulationContextValue | null>(null);

function totalLength(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) {
    sum += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return sum;
}

/**
 * The forklift always starts *and* ends its journey at its home lift station
 * (per user feedback) — prepended/appended as extra depot stops around
 * whatever the list itself contains. Skips the trailing append when the list
 * already ends there itself (avoids a zero-length final leg). Falls back to
 * the list's own stops unchanged if the warehouse has no lift station at all.
 */
function stopsWithDepot(list: PickingList, warehouse: Warehouse): PickingStop[] {
  const home = warehouse.liftStations[0];
  if (!home) return list.stops;
  const homeStop: PickingStop = { kind: "depot", id: home.id };
  const last = list.stops[list.stops.length - 1];
  const alreadyEndsAtHome = last && last.kind === "depot" && last.id === home.id;
  return [homeStop, ...list.stops, ...(alreadyEndsAtHome ? [] : [homeStop])];
}

/**
 * What happens at each stop, in order: picking removes a real pallet at a
 * slot stop and delivers everything held at a depot stop; storing loads up
 * to 3 synthetic pallets at a depot stop (only as many as the next
 * consecutive batch of slot stops actually needs) and stores one at each
 * slot stop. See specs.md §5.3. Operates on the *effective* (depot-
 * prepended) stop list, not the list's own raw `stops` — the prepended
 * lift-station stop is just an ordinary depot stop under this same logic
 * (a picking run's first "deliver" is a no-op since nothing is held yet; a
 * storing run's prepended stop loads 0 since the very next stop is itself
 * a depot, and the *real* load happens there).
 */
function planEvents(stops: PickingStop[], mode: PickingList["mode"]): StopEvent[] {
  const events: StopEvent[] = [];
  if (mode === "picking") {
    for (const stop of stops) {
      events.push(stop.kind === "slot" ? { type: "pick", slotId: stop.id } : { type: "deliver" });
    }
  } else {
    for (const stop of stops) {
      events.push(stop.kind === "slot" ? { type: "store", slotId: stop.id } : { type: "load" });
    }
  }
  return events;
}

/** Capacity a storing run loads up to at a depot — matches the hard 3-pallet limit the lists are authored against (specs.md §5.3). */
const FORKLIFT_CAPACITY = 3;

/** A turn sharp enough to cost the forklift time — anything gentler is taken in stride. */
const TURN_COS_THRESHOLD = Math.cos(Math.PI / 6); // 30°

/** Reduces a leg's polyline to straight-run lengths and a turn count, the only geometry the time model needs (see LegProfile). */
function legProfile(points: Point[]): LegProfile {
  const segmentLengths: number[] = [];
  const directions: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-6) continue;
    segmentLengths.push(length);
    directions.push({ x: dx / length, y: dy / length });
  }

  let turns = 0;
  for (let i = 1; i < directions.length; i++) {
    const dot = directions[i - 1].x * directions[i].x + directions[i - 1].y * directions[i].y;
    if (dot < TURN_COS_THRESHOLD) turns += 1;
  }

  return { segmentLengths, turns };
}

/**
 * Works out what each stop of a run actually costs to handle, by replaying
 * the run's picks and puts against a lightweight copy of the affected slots'
 * pallet counts — mirroring EditorContext's own pickPalletAuto (front-most
 * non-empty sub-slot, topmost pallet) and addPalletAuto (fewest pallets,
 * ties toward the deepest).
 *
 * Resolved once at record time rather than read back from the live warehouse,
 * because by the time anyone opens the analytics board the inventory has
 * moved on — and a run's cost is a fact about the state it ran against.
 */
function resolveHandling(
  stops: PickingStop[],
  events: StopEvent[],
  warehouse: Warehouse,
): StopHandling[] {
  const counts = new Map<string, number[]>();
  const countsFor = (slotId: string): number[] => {
    if (!counts.has(slotId)) {
      const slot = warehouse.slots.find((s) => s.id === slotId);
      counts.set(slotId, (slot?.subSlots ?? [{ pallets: [] }]).map((ss) => ss.pallets.length));
    }
    return counts.get(slotId)!;
  };

  let held = 0;

  return events.map((event, index) => {
    if (event.type === "pick") {
      const tiers = countsFor(event.slotId);
      const subSlotIndex = tiers.findIndex((count) => count > 0);
      if (subSlotIndex === -1) return { kind: "none" };
      const tierIndex = tiers[subSlotIndex] - 1;
      tiers[subSlotIndex] -= 1;
      held += 1;
      return { kind: "pick", subSlotIndex, tierIndex };
    }

    if (event.type === "store") {
      const tiers = countsFor(event.slotId);
      let target = 0;
      let fewest = Infinity;
      tiers.forEach((count, i) => {
        if (count <= fewest) {
          fewest = count;
          target = i; // later (deeper) indices win ties, as addPalletAuto does
        }
      });
      const tierIndex = tiers[target];
      tiers[target] += 1;
      held = Math.max(0, held - 1);
      return { kind: "store", subSlotIndex: target, tierIndex };
    }

    if (event.type === "deliver") {
      const pallets = held;
      held = 0;
      return { kind: "deliver", pallets };
    }

    const pallets = loadAmountAt(stops, index);
    held = pallets;
    return { kind: "load", pallets };
  });
}

/** How many pallets a `load` at `stopIndex` takes on: only as many as the run's next unbroken batch of slot stops will actually consume, capped at capacity, so the forklift is never drawn carrying more than it needs. */
function loadAmountAt(stops: PickingStop[], stopIndex: number): number {
  let needed = 0;
  for (let i = stopIndex + 1; i < stops.length && stops[i].kind === "slot"; i++) needed++;
  return Math.min(FORKLIFT_CAPACITY, needed);
}

/**
 * What the forklift is carrying once it has finished everything up to and
 * including `stopIndex` — i.e. what it hauls along the leg leaving that stop.
 * Replayed from the run's own events rather than tracked as mutable state, so
 * it stays correct however the run was navigated (played, stepped, or
 * scrubbed back and forth).
 */
export function heldPalletsAt(run: ActiveRun, stopIndex: number): number {
  let held = 0;
  for (let i = 0; i <= stopIndex && i < run.events.length; i++) {
    const event = run.events[i];
    if (event.type === "pick") held += 1;
    else if (event.type === "store") held = Math.max(0, held - 1);
    else if (event.type === "deliver") held = 0;
    else if (event.type === "load") held = loadAmountAt(run.stops, i);
  }
  return held;
}

function stopPoint(stop: PickingStop, warehouse: Warehouse): Point | null {
  if (stop.kind === "slot") {
    const slot = warehouse.slots.find((s) => s.id === stop.id);
    return slot ? slotEntryPoint(slot, warehouse.slotDefaults) : null;
  }
  const lift = warehouse.liftStations.find((l) => l.id === stop.id);
  if (lift) return { x: lift.x, y: lift.y };
  const delivery = warehouse.deliverySpaces.find((d) => d.id === stop.id);
  if (delivery) return { x: delivery.x, y: delivery.y };
  return null;
}

function buildLegs(stops: PickingStop[], warehouse: Warehouse, graph: PathGraph): Leg[] {
  const legs: Leg[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i];
    const to = stops[i + 1];
    const fromPoint = stopPoint(from, warehouse);
    const toPoint = stopPoint(to, warehouse);
    if (!fromPoint || !toPoint) {
      console.warn(`SimulationContext: unresolved stop (${from.id} -> ${to.id})`);
      continue;
    }
    const route = routeBetween(graph, fromPoint, toPoint);
    legs.push({ from, to, points: route.points, length: totalLength(route.points), edges: route.edges });
  }
  return legs;
}

export function SimulationProvider({ children }: { children: ReactNode }) {
  const editor = useEditor();
  const { reset: resetFocus } = useViewFocus();
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [animate, setAnimateState] = useState(true);
  const [speed, setSpeed] = useState(2); // m/s — a plausible forklift travel speed
  const [showPanel, setShowPanel] = useState(false);
  // Directed per-segment travel tallies for the path heatmap (Paths.tsx) —
  // keyed `"${nodeIdA}→${nodeIdB}"` (RouteEdge's own ids, already the same
  // convention pathGraph.ts's nodeKey/edgeKey use), so a corridor traveled
  // one way and back is two independent counts, not one merged total.
  const [edgeUsage, setEdgeUsage] = useState<Record<string, number>>({});
  // One tally per pick or store at a slot, for the slot heatmap
  // (SlotHeatmap.tsx) — answers "is load balanced across the racks", which
  // the path tallies can't, since several slots share one corridor.
  const [slotUsage, setSlotUsage] = useState<Record<string, number>>({});
  const [captureArmed, setCaptureArmed] = useState(false);
  const [sessionRuns, setSessionRuns] = useState<CapturedRun[]>([]);
  const [orderListStart, setOrderListStart] = useState(0);
  const [reviewedRunId, setReviewedRunId] = useState<string | null>(null);
  const [queuedLists, setQueuedLists] = useState<PickingList[]>([]);
  const [hoveredStep, setHoveredStep] = useState<HoveredStep | null>(null);
  const progressRef = useRef(0);
  const fastForwardSpeedRef = useRef<number | null>(null);
  const queueRef = useRef<PickingList[]>([]);
  /** Next index into sessionRuns — see recordRun for why this can't be read off the state. */
  const sessionCountRef = useRef(0);

  // queueRef stays the source of truth (it's mutated synchronously mid-run,
  // where a state value would be a render behind); this mirrors it into state
  // purely so the panel can render what's still coming.
  const syncQueuedLists = useCallback(() => {
    setQueuedLists([...queueRef.current]);
  }, []);

  const graph = useMemo(() => buildPathGraph(editor.warehouse.paths), [editor.warehouse.paths]);

  const applyEvent = useCallback(
    (event: StopEvent) => {
      if (event.type === "pick") editor.pickPalletAuto(event.slotId);
      else if (event.type === "store") editor.addPalletAuto(event.slotId);
      // "deliver"/"load" have no data-model effect: delivered pallets simply
      // leave the simulation, and loaded ones are synthetic (a delivery
      // space carries no tracked inventory to remove them from).
    },
    [editor],
  );

  /**
   * Commits a whole run's measurements at once, the moment its route is
   * computed — deliberately *not* leg-by-leg as the forklift arrives.
   * Measurement is a property of the route, which is fully known upfront;
   * the animation is a presentation of that route, not the thing being
   * measured. So a heatmap reads the same whether the run was played
   * animated, played static, or stepped through by hand, and it doesn't
   * creep upward while someone is watching the truck drive. Inventory is
   * the opposite case and still applies on arrival (see applyEvent's
   * callers) — watching stock change as the forklift reaches each slot is
   * the point of the animation.
   *
   * Every run joins the session either way — it happened, and the run
   * navigation walks it. Only an armed capture also feeds the heatmaps:
   * playing a list to demo it shouldn't silently contaminate a measurement.
   *
   * Returns the session index the run landed at, so the active run can point
   * back at its own record.
   */
  const recordRun = useCallback(
    (list: PickingList, stops: PickingStop[], legs: Leg[], events: StopEvent[]): number => {
      const profiles = legs.map((leg) => legProfile(leg.points));
      const handling = resolveHandling(stops, events, editor.warehouse);
      // A ref, not current.length inside the updater: that updater runs
      // during the next render, so anything it assigns is still unset by the
      // time this function returns the index to its caller.
      const index = sessionCountRef.current;
      sessionCountRef.current += 1;
      setSessionRuns((current) => {
        return [
          ...current,
          {
            id: `${list.id}-${Date.now()}-${current.length}`,
            list,
            stops,
            events,
            legs,
            profiles,
            handling,
            at: Date.now(),
            captured: captureArmed,
          },
        ];
      });

      if (!captureArmed) return index;

      setEdgeUsage((current) => {
        const next = { ...current };
        for (const leg of legs) {
          for (const edge of leg.edges) {
            const key = `${edge.a}→${edge.b}`;
            next[key] = (next[key] ?? 0) + 1;
          }
        }
        return next;
      });

      setSlotUsage((current) => {
        const next = { ...current };
        for (const event of events) {
          if (event.type !== "pick" && event.type !== "store") continue;
          next[event.slotId] = (next[event.slotId] ?? 0) + 1;
        }
        return next;
      });

      return index;
    },
    [captureArmed, editor.warehouse],
  );

  // playNext calls itself (directly for static-mode's immediate completion
  // path, deferred via setTimeout for queue chaining below) — always
  // through this ref, never the closed-over `playNext` binding, so a
  // deferred call picks up the *current* warehouse/graph state (post the
  // mutations this same call just applied) rather than the stale snapshot
  // captured when the timeout was scheduled.
  const playNextRef = useRef<() => void>(() => {});

  const playNext = useCallback(() => {
    const list = queueRef.current.shift();
    syncQueuedLists();
    setReviewedRunId(null); // a live run supersedes whatever was being reviewed
    if (!list) {
      setActiveRun(null);
      return;
    }
    resetFocus(); // don't let a cross-building route get truncated by per-building visibility (§5.1)

    const stops = stopsWithDepot(list, editor.warehouse);
    const events = planEvents(stops, list.mode);
    const legs = buildLegs(stops, editor.warehouse, graph);

    // The whole run's measurement lands here, before a wheel has turned —
    // see recordRun's doc comment.
    const sessionIndex = recordRun(list, stops, legs, events);

    if (!animate) {
      for (const event of events) applyEvent(event);
      setActiveRun({ list, mode: "static", stops, events, legs, currentLegIndex: legs.length, isPaused: false, sessionIndex });
      // Static runs finish synchronously — pause briefly before the next
      // queued list so each one is actually visible, rather than only the
      // last one ever appearing on screen.
      if (queueRef.current.length > 0) setTimeout(() => playNextRef.current(), 600);
      return;
    }

    // Animated: stop 0's event applies immediately (the forklift "starts"
    // already there — now always the home lift station); each subsequent
    // stop's event applies on arrival, via goToStep below.
    applyEvent(events[0]);
    progressRef.current = 0;
    fastForwardSpeedRef.current = null;
    if (legs.length === 0) {
      // A single-stop (or fully unresolved) list has nothing to animate —
      // nothing would ever call goToStep to finish/advance the queue, so do
      // it here instead.
      if (queueRef.current.length > 0) playNextRef.current();
      else setActiveRun(null);
      return;
    }
    setActiveRun({ list, mode: "animated", stops, events, legs, currentLegIndex: 0, isPaused: false, sessionIndex });
  }, [animate, applyEvent, recordRun, editor.warehouse, graph, resetFocus, syncQueuedLists]);

  playNextRef.current = playNext;

  /**
   * Marks where the console's order list starts. A fresh batch (or a stop)
   * normally replaces whatever was listed — but while capture is armed the
   * list *is* the capture's record, so it keeps everything and simply grows.
   */
  const beginOrderList = useCallback(() => {
    if (!captureArmed) setOrderListStart(sessionCountRef.current);
  }, [captureArmed]);

  const playList = useCallback(
    (list: PickingList) => {
      beginOrderList();
      queueRef.current = [list];
      playNext();
    },
    [beginOrderList, playNext],
  );

  const playQueue = useCallback(
    (lists: PickingList[]) => {
      beginOrderList();
      queueRef.current = [...lists];
      playNext();
    },
    [beginOrderList, playNext],
  );

  /**
   * Clears the scene of any route — the active run, the queue behind it and
   * whatever was being reviewed. The order list follows the same armed/not
   * rule as starting a batch: stopping mid-capture must not throw away the
   * record of what has been measured so far.
   */
  const stop = useCallback(() => {
    queueRef.current = [];
    fastForwardSpeedRef.current = null;
    setActiveRun(null);
    setQueuedLists([]);
    setReviewedRunId(null);
    beginOrderList();
  }, [beginOrderList]);

  const togglePause = useCallback(() => {
    setActiveRun((run) => (run ? { ...run, isPaused: !run.isPaused } : run));
  }, []);

  /**
   * The single function behind natural leg completion (Forklift.tsx's
   * useFrame driver calling goToStep(current + 1) on arrival), the panel's
   * transport buttons, and clicking a row in the operations list. Moving
   * *forward* applies every leg's arrival event along the way, exactly as if
   * the vehicle had actually traveled there. Moving *backward* only
   * repositions the displayed vehicle; it does not undo any pallet mutation
   * already applied. There's no general undo for "which exact pallet was
   * picked" to reverse, so scrubbing back is a navigation aid for reviewing
   * the route, not a replay/rewind of warehouse state.
   *
   * Heatmaps are deliberately untouched here — a run's measurement is
   * committed once, upfront (see captureRun), so stepping back and forth
   * through the same legs can't inflate it.
   */
  const goToStep = useCallback(
    (target: number) => {
      if (!activeRun) return;
      const clamped = Math.max(0, Math.min(activeRun.legs.length, target));
      if (clamped > activeRun.currentLegIndex) {
        for (let i = activeRun.currentLegIndex; i < clamped; i++) {
          const arrivalEvent = activeRun.events[i + 1]; // leg i ends at stop i+1
          if (arrivalEvent) applyEvent(arrivalEvent);
        }
      }
      progressRef.current = 0;
      fastForwardSpeedRef.current = null;
      if (clamped >= activeRun.legs.length && queueRef.current.length > 0) {
        playNextRef.current();
      } else {
        setActiveRun({ ...activeRun, currentLegIndex: clamped });
      }
    },
    [activeRun, applyEvent],
  );

  /**
   * Next *drives* to the following stop rather than teleporting to it: it
   * sets the speed that covers whatever's left of the current leg in
   * FAST_FORWARD_SECONDS, and the vehicle's own useFrame (Forklift.tsx)
   * completes the leg from there, arriving through the normal goToStep path.
   * Keeps the forklift's movement continuous — you can see *where* it went,
   * not just that the marker moved — while still being quick enough to click
   * through a list. Falls back to a plain jump when there's nothing being
   * animated (static runs, or an already-finished one).
   */
  const nextStep = useCallback(() => {
    const run = activeRun;
    if (!run || run.mode !== "animated" || run.currentLegIndex >= run.legs.length) {
      goToStep((activeRun?.currentLegIndex ?? 0) + 1);
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
    setReviewedRunId(null);
  }, []);

  /** Everything the session holds: runs, heatmaps, whatever is on screen. Entering edit mode does this — the routes were computed against a layout that's about to change, so keeping them would mean scoring runs that could no longer happen. */
  const clearSession = useCallback(() => {
    queueRef.current = [];
    fastForwardSpeedRef.current = null;
    progressRef.current = 0;
    setSessionRuns([]);
    sessionCountRef.current = 0;
    setOrderListStart(0);
    setEdgeUsage({});
    setSlotUsage({});
    setQueuedLists([]);
    setActiveRun(null);
    setReviewedRunId(null);
    setCaptureArmed(false);
  }, []);

  /**
   * Re-displays a run already played this session without re-executing it —
   * reviewing what happened must not change what happened. Drawn as a
   * finished static run: the whole route visible, nothing animating, no
   * events applied and nothing counted.
   */
  const showSessionRun = useCallback(
    (index: number) => {
      const recorded = sessionRuns[index];
      if (!recorded) return;
      queueRef.current = [];
      fastForwardSpeedRef.current = null;
      progressRef.current = 0;
      setQueuedLists([]);
      setReviewedRunId(recorded.id);
      setActiveRun({
        list: recorded.list,
        mode: "static",
        stops: recorded.stops,
        events: recorded.events,
        legs: recorded.legs,
        currentLegIndex: recorded.legs.length,
        isPaused: false,
        sessionIndex: index,
      });
    },
    [sessionRuns],
  );

  const reviewRun = useCallback(
    (id: string | null) => {
      if (id === null) {
        setReviewedRunId(null);
        return;
      }
      const index = sessionRuns.findIndex((entry) => entry.id === id);
      if (index >= 0) showSessionRun(index);
    },
    [sessionRuns, showSessionRun],
  );

  // Run navigation walks the whole session in play order, then spills into
  // the queue: going forward past the last played run starts the next one
  // waiting, so ⏭ reads as "the run after this one" whether that run has
  // happened yet or not.
  const currentRunIndex = activeRun?.sessionIndex ?? -1;
  const canGoPreviousRun = currentRunIndex > 0;
  const canGoNextRun = currentRunIndex >= 0 && (currentRunIndex < sessionRuns.length - 1 || queueRef.current.length > 0);

  const previousRun = useCallback(() => {
    if (currentRunIndex > 0) showSessionRun(currentRunIndex - 1);
  }, [currentRunIndex, showSessionRun]);

  const nextRun = useCallback(() => {
    if (currentRunIndex >= 0 && currentRunIndex < sessionRuns.length - 1) {
      showSessionRun(currentRunIndex + 1);
      return;
    }
    if (queueRef.current.length > 0) playNextRef.current();
  }, [currentRunIndex, sessionRuns.length, showSessionRun]);

  /**
   * Animate is a presentation choice, so flipping it never recomputes a
   * route. Turning it off mid-run finishes the run where it stands —
   * applying the stock changes it hadn't reached yet, because the run did
   * happen. Turning it back on re-drives the same route from the start as
   * pure playback: the events already applied, so nothing lands twice.
   */
  const setAnimate = useCallback(
    (value: boolean) => {
      setAnimateState(value);
      const run = activeRun;
      if (!run) return;

      if (!value) {
        if (run.currentLegIndex < run.legs.length) goToStep(run.legs.length);
        return;
      }
      progressRef.current = 0;
      fastForwardSpeedRef.current = null;
      setActiveRun({ ...run, mode: "animated", currentLegIndex: 0, isPaused: false });
    },
    [activeRun, goToStep],
  );

  /**
   * Discards every simulation-driven pallet mutation by jumping the editor's
   * own history back to entries[0] (the originally loaded state) — reusing
   * the existing undo/history system rather than a separate snapshot, since
   * every pick/store this simulation makes already flows through it.
   *
   * Deliberately leaves the captured heatmaps alone (clearCapture is its own
   * action): restocking between runs is a normal thing to do *during* a
   * capture, and coupling the two would throw away the measurement every
   * time someone topped the warehouse back up.
   */
  const resetWarehouse = useCallback(() => {
    queueRef.current = [];
    fastForwardSpeedRef.current = null;
    setActiveRun(null);
    setQueuedLists([]);
    editor.jumpTo(0);
  }, [editor]);

  const value = useMemo<SimulationContextValue>(
    () => ({
      pickingLists: exampleLists,
      activeRun,
      animate,
      setAnimate,
      speed,
      setSpeed,
      playList,
      playQueue,
      stop,
      togglePause,
      goToStep,
      nextStep,
      previousStep,
      showPanel,
      setShowPanel,
      progressRef,
      fastForwardSpeedRef,
      queuedLists,
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
      reviewedRunId,
      reviewRun,
      clearCapture,
      resetWarehouse,
      hoveredStep,
      setHoveredStep,
    }),
    [
      activeRun,
      animate,
      setAnimate,
      speed,
      playList,
      playQueue,
      stop,
      togglePause,
      goToStep,
      nextStep,
      previousStep,
      showPanel,
      queuedLists,
      edgeUsage,
      slotUsage,
      captureArmed,
      sessionRuns,
      orderListStart,
      capturedRuns,
      showSessionRun,
      nextRun,
      previousRun,
      canGoNextRun,
      canGoPreviousRun,
      clearSession,
      reviewedRunId,
      reviewRun,
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
