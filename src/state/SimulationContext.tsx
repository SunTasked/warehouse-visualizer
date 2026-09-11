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

export interface ActiveRun {
  list: PickingList;
  mode: PlaybackMode;
  legs: Leg[];
  /** Flattened for rendering the full highlight regardless of mode. */
  route: Point[];
  /** Index into legs currently being traveled (animated) — >= legs.length once finished/static. */
  currentLegIndex: number;
}

type StopEvent =
  | { type: "pick"; slotId: string }
  | { type: "store"; slotId: string }
  | { type: "deliver" }
  | { type: "load" };

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
  showPanel: boolean;
  setShowPanel: (value: boolean) => void;
  /** Distance traveled (meters) within the active run's current leg — a ref, not state, so the per-frame vehicle animation (Forklift.tsx) doesn't trigger a React re-render every frame. */
  progressRef: MutableRefObject<number>;
  /** Called by Forklift.tsx's useFrame driver once the vehicle reaches the current leg's end. */
  advanceLeg: () => void;
}

const SimulationContext = createContext<SimulationContextValue | null>(null);

function totalLength(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) {
    sum += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return sum;
}

/** Flattens legs into one polyline for the route highlight — consecutive legs share their boundary point exactly, so it's deduped rather than left as a zero-length segment. */
function flattenLegs(legs: Leg[]): Point[] {
  const route: Point[] = [];
  for (const leg of legs) {
    const points = route.length > 0 ? leg.points.slice(1) : leg.points;
    route.push(...points);
  }
  return route;
}

/**
 * What happens at each stop, in order — derived once per list, not
 * authored: picking removes a real pallet at a slot stop and delivers
 * everything held at a depot stop; storing loads up to 3 synthetic pallets
 * at a depot stop (only as many as the next consecutive batch of slot stops
 * actually needs) and stores one at each slot stop. See specs.md §5.3.
 */
function planEvents(list: PickingList): StopEvent[] {
  const events: StopEvent[] = [];
  if (list.mode === "picking") {
    for (const stop of list.stops) {
      events.push(stop.kind === "slot" ? { type: "pick", slotId: stop.id } : { type: "deliver" });
    }
  } else {
    for (const stop of list.stops) {
      events.push(stop.kind === "slot" ? { type: "store", slotId: stop.id } : { type: "load" });
    }
  }
  return events;
}

function stopPoint(
  stop: PickingStop,
  warehouse: Warehouse,
): Point | null {
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

function buildLegs(list: PickingList, warehouse: Warehouse, graph: PathGraph): Leg[] {
  const legs: Leg[] = [];
  for (let i = 0; i < list.stops.length - 1; i++) {
    const from = list.stops[i];
    const to = list.stops[i + 1];
    const fromPoint = stopPoint(from, warehouse);
    const toPoint = stopPoint(to, warehouse);
    if (!fromPoint || !toPoint) {
      console.warn(`SimulationContext: unresolved stop in list "${list.id}" (${from.id} -> ${to.id})`);
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

  // playNext calls itself (directly for the animated advance-leg path,
  // deferred via setTimeout for static-mode queue chaining below) — always
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

    const events = planEvents(list);
    const legs = buildLegs(list, editor.warehouse, graph);
    const route = flattenLegs(legs);

    if (playbackMode === "static") {
      for (const event of events) applyEvent(event);
      setActiveRun({ list, mode: "static", legs, route, currentLegIndex: legs.length });
      // Static runs finish synchronously — pause briefly before the next
      // queued list so each one is actually visible, rather than only the
      // last one ever appearing on screen.
      if (queueRef.current.length > 0) setTimeout(() => playNextRef.current(), 600);
      return;
    }

    // Animated: stop 0's event applies immediately (the forklift "starts"
    // already there); each subsequent stop's event applies on arrival, via
    // advanceLeg below.
    applyEvent(events[0]);
    progressRef.current = 0;
    if (legs.length === 0) {
      // A single-stop (or fully unresolved) list has nothing to animate —
      // nothing would ever call advanceLeg to finish/advance the queue, so
      // do it here instead.
      if (queueRef.current.length > 0) playNextRef.current();
      else setActiveRun(null);
      return;
    }
    setActiveRun({ list, mode: "animated", legs, route, currentLegIndex: 0 });
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

  // Called by Forklift.tsx (imperatively, from its useFrame driver — not
  // from within another state update) once the vehicle's traveled distance
  // reaches the current leg's length. Applies that leg's arrival event and
  // moves on to the next leg, the next queued list, or finishes.
  const advanceLeg = useCallback(() => {
    if (!activeRun) return;
    const events = planEvents(activeRun.list);
    const arrivedLegIndex = activeRun.currentLegIndex;
    const arrivalEvent = events[arrivedLegIndex + 1]; // leg i ends at stop i+1
    if (arrivalEvent) applyEvent(arrivalEvent);
    progressRef.current = 0;
    const nextLegIndex = arrivedLegIndex + 1;
    if (nextLegIndex >= activeRun.legs.length && queueRef.current.length > 0) {
      playNextRef.current();
    } else {
      setActiveRun({ ...activeRun, currentLegIndex: nextLegIndex });
    }
  }, [activeRun, applyEvent]);

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
      showPanel,
      setShowPanel,
      progressRef,
      advanceLeg,
    }),
    [activeRun, playbackMode, speed, playList, playQueue, stop, showPanel, advanceLeg],
  );

  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
}

export function useSimulation(): SimulationContextValue {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error("useSimulation must be used within a SimulationProvider");
  return ctx;
}
