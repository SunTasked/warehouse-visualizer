import type { Access, Point, Slot, SlotSize, SubSlot, Warehouse } from "../types/warehouse";
import type { PickingList, PickingStop } from "../types/simulation";
import type { LegProfile, StopHandling } from "./timeModel";
import { PathGraph, TURN_COS_THRESHOLD, connectPoint, routeBetween, type Connection, type Route } from "./pathGraph";
import { slotEntryPoint, slotFacing } from "./geometry";
import { levelsOf, storeTarget } from "./stock";

/**
 * The picking-list simulation's engine (specs.md §5.3): plain data in, plain
 * data out, no React. A batch runs in a web worker (src/workers/runWorker.ts)
 * so thousands of lists can be routed while the page stays responsive, and
 * the scene only ever re-routes the one run someone asks to see.
 */

/** The parts of a warehouse a batch needs — its corridors, where things are, and the stock it starts from. */
export type WarehouseLayout = Pick<Warehouse, "paths" | "slots" | "liftStations" | "deliverySpaces" | "slotDefaults">;

export interface Leg {
  from: PickingStop;
  to: PickingStop;
  /** Route polyline for this leg, riding the path network (see src/lib/pathGraph.ts). */
  points: Point[];
  length: number;
}

export type StopEvent =
  | { type: "pick"; slotId: string }
  | { type: "store"; slotId: string }
  | { type: "deliver" }
  | { type: "load" };

/**
 * One list, worked through: everything the run console and the performance
 * board need, and nothing they don't. No route geometry — thousands of runs
 * would otherwise carry every leg's polyline around, when a run's route is
 * recomputed in a few milliseconds the moment it's shown.
 */
export interface RunRecord {
  list: PickingList;
  /** The list's own stops, with the forklift's home lift station around them — see stopsWithDepot. */
  stops: PickingStop[];
  /** Parallel to `stops`. */
  events: StopEvent[];
  /** Geometry-free per-leg profile for the time model — see LegProfile. */
  profiles: LegProfile[];
  /** What each stop cost to work, resolved against the stock as it stood when the run reached it. */
  handling: StopHandling[];
}

/**
 * What a batch sends back per list: only what it cost. The rest of a run —
 * its stops with the depot around them, its events — follows from the list
 * itself, so the page rebuilds it (runRecord) instead of having thousands of
 * copies cloned back from the worker.
 */
export interface RunCost {
  profiles: LegProfile[];
  handling: StopHandling[];
}

/** A list and what it cost, as a run record — its depot bookends and events derived exactly as the batch derived them. */
export function runRecord(list: PickingList, homeId: string | undefined, cost: RunCost): RunRecord {
  const stops = stopsWithDepot(list, homeId);
  return { list, stops, events: planEvents(stops, list.mode), profiles: cost.profiles, handling: cost.handling };
}

/** Capacity a storing run loads up to at a depot — matches the hard 3-pallet limit the lists are authored against (specs.md §5.3). */
export const FORKLIFT_CAPACITY = 3;

/**
 * The forklift always starts *and* ends its journey at its home lift station
 * (per user feedback) — prepended/appended as extra depot stops around
 * whatever the list itself contains. Skips the trailing append when the list
 * already ends there itself (avoids a zero-length final leg). Falls back to
 * the list's own stops unchanged if the warehouse has no lift station at all.
 */
export function stopsWithDepot(list: PickingList, homeId: string | undefined): PickingStop[] {
  if (!homeId) return list.stops;
  const homeStop: PickingStop = { kind: "depot", id: homeId };
  const last = list.stops[list.stops.length - 1];
  const alreadyEndsAtHome = last && last.kind === "depot" && last.id === homeId;
  return [homeStop, ...list.stops, ...(alreadyEndsAtHome ? [] : [homeStop])];
}

/**
 * What happens at each stop, in order: picking removes a real pallet at a
 * slot stop and delivers everything held at a depot stop; storing loads up
 * to 3 synthetic pallets at a depot stop (only as many as the next
 * consecutive batch of slot stops actually needs) and stores one at each
 * slot stop. See specs.md §5.3. Operates on the *effective* (depot-
 * prepended) stop list — the prepended lift-station stop is just an ordinary
 * depot stop under this same logic (a picking run's first "deliver" is a
 * no-op since nothing is held yet; a storing run's prepended stop loads 0
 * since the very next stop is itself a depot, and the *real* load happens
 * there).
 */
export function planEvents(stops: PickingStop[], mode: PickingList["mode"]): StopEvent[] {
  return stops.map((stop): StopEvent => {
    if (mode === "picking") return stop.kind === "slot" ? { type: "pick", slotId: stop.id } : { type: "deliver" };
    return stop.kind === "slot" ? { type: "store", slotId: stop.id } : { type: "load" };
  });
}

/** How many pallets a `load` at `stopIndex` takes on: only as many as the run's next unbroken batch of slot stops will actually consume, capped at capacity, so the forklift is never drawn carrying more than it needs. */
export function loadAmountAt(stops: PickingStop[], stopIndex: number): number {
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
export function heldPalletsAt(run: Pick<RunRecord, "stops" | "events">, stopIndex: number): number {
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

/** Reduces a leg's polyline to straight-run lengths and a turn count, the only geometry the time model needs (see LegProfile). */
export function legProfile(points: Point[]): LegProfile {
  const segmentLengths: number[] = [];
  let turns = 0;
  let previousX = 0;
  let previousY = 0;
  let hasPrevious = false;

  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-6) continue;
    segmentLengths.push(length);
    const x = dx / length;
    const y = dy / length;
    if (hasPrevious && previousX * x + previousY * y < TURN_COS_THRESHOLD) turns += 1;
    previousX = x;
    previousY = y;
    hasPrevious = true;
  }

  return { segmentLengths, turns };
}

function polylineLength(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) {
    sum += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return sum;
}

/** Where a stop is, and where it joins the corridors. */
export interface StopJoin {
  /** The stop's own point: a slot's entry edge, a facility's centre. */
  point: Point;
  /** Where it joins the network; null when the plan has no corridors. */
  connection: Connection | null;
  /** That join as the plan would state it: a corridor and the distance along it. */
  place: Access | null;
  /** Whether the plan states it (`access`), rather than the router picking the nearest corridor. */
  explicit: boolean;
}

/**
 * Routes stops across one warehouse's corridors: the path graph compiled
 * once, and each stop's position and join onto the network worked out the
 * first time it's visited and kept — a batch of thousands of lists visits the
 * same few thousand slots and a handful of depots over and over.
 */
export class RoutePlanner {
  readonly graph: PathGraph;
  private readonly slots = new Map<string, Slot>();
  private readonly depots = new Map<string, { point: Point; access?: Access }>();
  private readonly slotDefaults: SlotSize;
  private readonly joins = new Map<string, StopJoin | null>();

  constructor(layout: WarehouseLayout) {
    this.graph = new PathGraph(layout.paths);
    for (const slot of layout.slots) this.slots.set(slot.id, slot);
    // Lift stations are looked up first, so they win an id shared with a delivery space.
    for (const depot of [...layout.deliverySpaces, ...layout.liftStations]) {
      this.depots.set(depot.id, { point: { x: depot.x, y: depot.y }, access: depot.access });
    }
    this.slotDefaults = layout.slotDefaults;
  }

  slot(id: string): Slot | undefined {
    return this.slots.get(id);
  }

  /** The stated access when the plan has one (and its corridor exists); otherwise the nearest corridor — in front of it, for a slot. */
  private resolve(point: Point, access: Access | undefined, facing?: Point): StopJoin {
    if (access) {
      const connection = this.graph.joinAlong(access);
      if (connection) return { point, connection, place: access, explicit: true };
    }
    const connection = connectPoint(this.graph, point, facing);
    return { point, connection, place: connection ? this.graph.placeOf(connection) : null, explicit: false };
  }

  /** Where a stop is and how it joins the network, or null for an id the plan doesn't have. Worked out once per stop and kept. */
  joinOf(stop: PickingStop): StopJoin | null {
    const key = `${stop.kind}:${stop.id}`;
    const known = this.joins.get(key);
    if (known !== undefined) return known;

    let join: StopJoin | null = null;
    if (stop.kind === "slot") {
      const slot = this.slots.get(stop.id);
      if (slot) join = this.resolve(slotEntryPoint(slot, this.slotDefaults), slot.access, slotFacing(slot));
    } else {
      const depot = this.depots.get(stop.id);
      if (depot) join = this.resolve(depot.point, depot.access);
    }
    this.joins.set(key, join);
    return join;
  }

  /** Whether the plan has anything by this stop's id. */
  knows(stop: PickingStop): boolean {
    return this.joinOf(stop) !== null;
  }

  /** One leg's route, or null when either end names nothing in the plan. */
  route(from: PickingStop, to: PickingStop): Route | null {
    const a = this.joinOf(from);
    const b = this.joinOf(to);
    if (!a || !b) return null;
    return routeBetween(this.graph, a.point, a.connection, b.point, b.connection);
  }

  /** A run's legs, to draw and drive. A stop the plan doesn't have drops the leg into it, as it always has. */
  legs(stops: PickingStop[]): Leg[] {
    const legs: Leg[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const route = this.route(stops[i], stops[i + 1]);
      if (!route) continue;
      legs.push({ from: stops[i], to: stops[i + 1], points: route.points, length: polylineLength(route.points) });
    }
    return legs;
  }
}

export interface BatchResult {
  /** One per list, in order. */
  runs: RunCost[];
  /** The new sub-slots of every slot the batch stored into or picked from — applied to the warehouse in one go. */
  stock: Record<string, SubSlot[]>;
  /** Directed per-segment travel tallies keyed `"${junctionA}→${junctionB}"`, as the path heatmap reads them. Empty unless captured. */
  edgeUsage: Record<string, number>;
  /** One tally per pick or store at a slot. Empty unless captured. */
  slotUsage: Record<string, number>;
  /** Picks that reached a slot with nothing in it. */
  emptyPicks: number;
  /** Stores that reached a slot with no room left: every depth position stacked to the plan's levels. */
  fullStores: number;
  /** Stop ids the plan doesn't have. */
  unknownStops: string[];
}

/**
 * Works a list of picking lists through, in order, against a private copy of
 * the stock: each list's picks and stores change what the next one finds, as
 * they would if the lists were played one after another. `step` does as many
 * lists as fit before a deadline, so the caller can report progress (and
 * notice a cancel) between slices.
 */
export class Batch {
  readonly total: number;
  done = 0;
  private readonly lists: PickingList[];
  private readonly capture: boolean;
  private readonly planner: RoutePlanner;
  private readonly homeId: string | undefined;
  /** Copy-on-write stock: a slot's sub-slots are copied the first time the batch changes them. */
  private readonly stock = new Map<string, SubSlot[]>();
  private readonly runs: RunCost[] = [];
  /** Keyed by `from * graph.size + to`, turned into heatmap keys once at the end. */
  private readonly edgeCounts = new Map<number, number>();
  private readonly slotCounts = new Map<string, number>();
  private emptyPicks = 0;
  private fullStores = 0;
  private readonly unknownStops = new Set<string>();
  /** How high each depth position stacks — a store never goes past it. */
  private readonly levels: number;

  constructor(layout: WarehouseLayout, lists: PickingList[], capture: boolean) {
    this.lists = lists;
    this.total = lists.length;
    this.capture = capture;
    this.planner = new RoutePlanner(layout);
    this.homeId = layout.liftStations[0]?.id;
    this.levels = levelsOf(layout.slotDefaults);
  }

  /** Works lists until they're all done (true) or the clock passes `deadline` (a performance.now() time). */
  step(deadline: number): boolean {
    while (this.done < this.total) {
      this.work(this.lists[this.done]);
      this.done += 1;
      if (this.done % 16 === 0 && performance.now() >= deadline) break;
    }
    return this.done >= this.total;
  }

  result(): BatchResult {
    const { size, keys } = this.planner.graph;
    const edgeUsage: Record<string, number> = {};
    for (const [code, count] of this.edgeCounts) {
      edgeUsage[`${keys[Math.floor(code / size)]}→${keys[code % size]}`] = count;
    }
    return {
      runs: this.runs,
      stock: Object.fromEntries(this.stock),
      edgeUsage,
      slotUsage: Object.fromEntries(this.slotCounts),
      emptyPicks: this.emptyPicks,
      fullStores: this.fullStores,
      unknownStops: [...this.unknownStops],
    };
  }

  private work(list: PickingList): void {
    const stops = stopsWithDepot(list, this.homeId);
    const events = planEvents(stops, list.mode);
    const profiles: LegProfile[] = [];
    const size = this.planner.graph.size;

    for (let i = 0; i < stops.length - 1; i++) {
      const route = this.planner.route(stops[i], stops[i + 1]);
      if (!route) {
        for (const stop of [stops[i], stops[i + 1]]) if (!this.planner.knows(stop)) this.unknownStops.add(stop.id);
        continue;
      }
      profiles.push(legProfile(route.points));
      if (this.capture) {
        for (let h = 0; h < route.hops.length; h += 2) {
          const code = route.hops[h] * size + route.hops[h + 1];
          this.edgeCounts.set(code, (this.edgeCounts.get(code) ?? 0) + 1);
        }
      }
    }

    const handling = this.handle(stops, events);
    if (this.capture) {
      for (const event of events) {
        if (event.type === "pick" || event.type === "store") {
          this.slotCounts.set(event.slotId, (this.slotCounts.get(event.slotId) ?? 0) + 1);
        }
      }
    }
    this.runs.push({ profiles, handling });
  }

  /** A slot's sub-slots as the batch currently has them — copied first when about to be changed. Null for a slot the plan doesn't have. */
  private subSlots(slotId: string, forWriting: boolean): SubSlot[] | null {
    const copy = this.stock.get(slotId);
    if (copy) return copy;
    const slot = this.planner.slot(slotId);
    if (!slot) return null;
    const original = slot.subSlots ?? [{ id: `${slot.id}.1`, pallets: [] }];
    if (!forWriting) return original;
    const fresh = original.map((subSlot) => ({ id: subSlot.id, pallets: [...subSlot.pallets] }));
    this.stock.set(slotId, fresh);
    return fresh;
  }

  /**
   * Applies each stop to the stock and says what it cost to work. Picks take
   * the front-most non-empty sub-slot's top pallet; stores go to the sub-slot
   * with room that has the fewest pallets, ties toward the deepest — the rule
   * the editor's own "add pallet" and a loaded stock extract fill by
   * (storeTarget), so a stocked slot looks the same whichever way it was
   * filled. A slot stacked to the plan's levels everywhere takes nothing.
   */
  private handle(stops: PickingStop[], events: StopEvent[]): StopHandling[] {
    let held = 0;
    return events.map((event, index): StopHandling => {
      if (event.type === "pick") {
        const current = this.subSlots(event.slotId, false);
        const subSlotIndex = current ? current.findIndex((subSlot) => subSlot.pallets.length > 0) : -1;
        if (subSlotIndex === -1) {
          if (current) this.emptyPicks += 1;
          return { kind: "none" };
        }
        const pallets = this.subSlots(event.slotId, true)![subSlotIndex].pallets;
        pallets.pop();
        held += 1;
        return { kind: "pick", subSlotIndex, tierIndex: pallets.length };
      }

      if (event.type === "store") {
        const current = this.subSlots(event.slotId, false);
        if (!current) return { kind: "none" };
        const target = storeTarget(current, this.levels);
        if (target === -1) {
          this.fullStores += 1;
          return { kind: "none" };
        }
        const subSlot = this.subSlots(event.slotId, true)![target];
        const tierIndex = subSlot.pallets.length;
        const palletId = `${subSlot.id}-P${tierIndex + 1}`;
        subSlot.pallets.push({ id: palletId, items: [{ id: `${palletId}-I1` }] });
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
}

/** Messages to the run worker. */
export type WorkerRequest =
  | { type: "run"; jobId: number; layout: WarehouseLayout; lists: PickingList[]; capture: boolean }
  | { type: "cancel"; jobId: number };

/** Messages back from it. */
export type WorkerReply =
  | { type: "progress"; jobId: number; done: number; total: number }
  | { type: "done"; jobId: number; result: BatchResult }
  | { type: "error"; jobId: number; message: string };
