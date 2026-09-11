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
import { buildPathGraph, routeBetween, type PathGraph } from "../lib/pathGraph";
import { slotEntryPoint } from "../lib/geometry";
import { useEditor } from "./EditorContext";
import { useViewFocus } from "./ViewFocusContext";

export type PlaybackMode = "animated" | "static";

export interface Leg {
  from: PickingStop;
  to: PickingStop;
  /** Route polyline for this leg, riding the path network (see src/lib/pathGraph.ts). */
  points: Point[];
  length: number;
}

type StopEvent =
  | { type: "pick"; slotId: string }
  | { type: "store"; slotId: string }
  | { type: "deliver" }
  | { type: "load" };

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
}

interface SimulationContextValue {
  pickingLists: PickingList[];
  activeRun: ActiveRun | null;
  playbackMode: PlaybackMode;
  setPlaybackMode: (mode: PlaybackMode) => void;
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
 * The forklift always starts its journey at its home lift station (per user
 * feedback) — prepended as an extra depot stop ahead of whatever the list
 * itself starts with. Falls back to the list's own stops unchanged if the
 * warehouse has no lift station at all.
 */
function stopsWithDepot(list: PickingList, warehouse: Warehouse): PickingStop[] {
  const home = warehouse.liftStations[0];
  if (!home) return list.stops;
  return [{ kind: "depot", id: home.id }, ...list.stops];
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
    const points = routeBetween(graph, fromPoint, toPoint);
    legs.push({ from, to, points, length: totalLength(points) });
  }
  return legs;
}

export function SimulationProvider({ children }: { children: ReactNode }) {
  const editor = useEditor();
  const { reset: resetFocus } = useViewFocus();
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("animated");
  const [speed, setSpeed] = useState(2); // m/s — a plausible forklift travel speed
  const [showPanel, setShowPanel] = useState(false);
  const progressRef = useRef(0);
  const queueRef = useRef<PickingList[]>([]);

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

  // playNext calls itself (directly for static-mode's immediate completion
  // path, deferred via setTimeout for queue chaining below) — always
  // through this ref, never the closed-over `playNext` binding, so a
  // deferred call picks up the *current* warehouse/graph state (post the
  // mutations this same call just applied) rather than the stale snapshot
  // captured when the timeout was scheduled.
  const playNextRef = useRef<() => void>(() => {});

  const playNext = useCallback(() => {
    const list = queueRef.current.shift();
    if (!list) {
      setActiveRun(null);
      return;
    }
    resetFocus(); // don't let a cross-building route get truncated by per-building visibility (§5.1)

    const stops = stopsWithDepot(list, editor.warehouse);
    const events = planEvents(stops, list.mode);
    const legs = buildLegs(stops, editor.warehouse, graph);

    if (playbackMode === "static") {
      for (const event of events) applyEvent(event);
      setActiveRun({ list, mode: "static", stops, events, legs, currentLegIndex: legs.length, isPaused: false });
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
    if (legs.length === 0) {
      // A single-stop (or fully unresolved) list has nothing to animate —
      // nothing would ever call goToStep to finish/advance the queue, so do
      // it here instead.
      if (queueRef.current.length > 0) playNextRef.current();
      else setActiveRun(null);
      return;
    }
    setActiveRun({ list, mode: "animated", stops, events, legs, currentLegIndex: 0, isPaused: false });
  }, [applyEvent, editor.warehouse, graph, playbackMode, resetFocus]);

  playNextRef.current = playNext;

  const playList = useCallback(
    (list: PickingList) => {
      queueRef.current = [list];
      playNext();
    },
    [playNext],
  );

  const playQueue = useCallback(
    (lists: PickingList[]) => {
      queueRef.current = [...lists];
      playNext();
    },
    [playNext],
  );

  const stop = useCallback(() => {
    queueRef.current = [];
    setActiveRun(null);
  }, []);

  const togglePause = useCallback(() => {
    setActiveRun((run) => (run ? { ...run, isPaused: !run.isPaused } : run));
  }, []);

  /**
   * The single function behind natural leg completion (Forklift.tsx's
   * useFrame driver calling goToStep(current + 1) on arrival), the panel's
   * Next/Previous buttons, and its step slider. Moving *forward* applies
   * every leg's arrival event along the way, exactly as if the vehicle had
   * actually traveled there — this is real simulation progress, not just a
   * view change. Moving *backward* only repositions the displayed vehicle;
   * it does not undo any pallet mutation already applied. There's no
   * general undo for "which exact pallet was picked" to reverse, so
   * scrubbing back is a navigation aid for reviewing the route, not a
   * replay/rewind of warehouse state — matches what was asked ("brings the
   * forklift to the next/previous slot") without pretending to be something
   * it isn't.
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
      if (clamped >= activeRun.legs.length && queueRef.current.length > 0) {
        playNextRef.current();
      } else {
        setActiveRun({ ...activeRun, currentLegIndex: clamped });
      }
    },
    [activeRun, applyEvent],
  );

  const nextStep = useCallback(() => goToStep((activeRun?.currentLegIndex ?? 0) + 1), [activeRun, goToStep]);
  const previousStep = useCallback(() => goToStep((activeRun?.currentLegIndex ?? 0) - 1), [activeRun, goToStep]);

  const value = useMemo<SimulationContextValue>(
    () => ({
      pickingLists: exampleLists,
      activeRun,
      playbackMode,
      setPlaybackMode,
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
    }),
    [
      activeRun,
      playbackMode,
      speed,
      playList,
      playQueue,
      stop,
      togglePause,
      goToStep,
      nextStep,
      previousStep,
      showPanel,
    ],
  );

  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
}

export function useSimulation(): SimulationContextValue {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error("useSimulation must be used within a SimulationProvider");
  return ctx;
}
