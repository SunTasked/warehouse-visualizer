import type { Access, Path, Point } from "../types/warehouse";

/**
 * The corridor network as a routable graph, for the forklift picking-list
 * simulation (§5.3). Nodes are the plan's named junctions and edges the
 * segments between consecutive junctions of each corridor (src/lib/corridors.ts
 * resolves them), so two corridors are connected exactly when they name the
 * same junction — no coordinate matching involved.
 *
 * Compiled for batches of thousands of lists: nodes are integer indices with
 * their coordinates in typed arrays, each segment is stored once, and a
 * shortest-route tree is computed the first time a route leaves from a given
 * junction in a given direction, then kept. A plan's graph is small (CML: 271
 * junctions, 285 segments), so after a handful of trees a leg costs a table
 * lookup and a walk back along its own path.
 *
 * Routes are shortest first and, between routes of equal length, fewest
 * turns — the tie a driver would break the same way, and the one the time
 * model charges for (see TURN_COS_THRESHOLD). That's why the trees are over
 * *directed segments* rather than junctions: whether the next segment is a
 * turn depends on the one you arrived by.
 */

/** A direction change sharper than 30° is a turn: it costs the forklift time (legProfile in runEngine.ts), and among equally short routes the router takes the one with fewest. */
export const TURN_COS_THRESHOLD = Math.cos(Math.PI / 6);

export const NO_NODE = -1;

/** Route lengths are summed in whole micrometres, so two routes of the same length compare equal rather than a rounding error apart. */
const MICRONS = 1e6;
/** Routes within this many micrometres of each other count as equally short, so turns decide between them. */
const TIE_MICRONS = 10;

type Direction = [number, number];

function turn(a: Direction, bx: number, by: number): number {
  return a[0] * bx + a[1] * by < TURN_COS_THRESHOLD ? 1 : 0;
}

function unit(from: Point, to: Point): Direction | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length < 1e-6 ? null : [dx / length, dy / length];
}

/** Best routes from one start to every directed segment: its length (µm), turns, and the segment before it (-1 for one leaving the start). */
interface RouteTree {
  length: Float64Array;
  turns: Uint32Array;
  previous: Int32Array;
}

/** A binary min-heap of directed segments, ordered by route length, then turns. Stale entries are skipped by the caller rather than updated in place. */
class SegmentHeap {
  private readonly states: number[] = [];
  private readonly lengths: number[] = [];
  private readonly turnCounts: number[] = [];

  get size(): number {
    return this.states.length;
  }

  private before(i: number, j: number): boolean {
    return this.lengths[i] < this.lengths[j] || (this.lengths[i] === this.lengths[j] && this.turnCounts[i] < this.turnCounts[j]);
  }

  private swap(i: number, j: number): void {
    [this.states[i], this.states[j]] = [this.states[j], this.states[i]];
    [this.lengths[i], this.lengths[j]] = [this.lengths[j], this.lengths[i]];
    [this.turnCounts[i], this.turnCounts[j]] = [this.turnCounts[j], this.turnCounts[i]];
  }

  push(state: number, length: number, turns: number): void {
    this.states.push(state);
    this.lengths.push(length);
    this.turnCounts.push(turns);
    for (let i = this.states.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (!this.before(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.states[0];
    const last = this.states.length - 1;
    this.swap(0, last);
    this.states.pop();
    this.lengths.pop();
    this.turnCounts.pop();
    for (let i = 0; ; ) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < this.states.length && this.before(left, smallest)) smallest = left;
      if (right < this.states.length && this.before(right, smallest)) smallest = right;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
    return top;
  }
}

export class PathGraph {
  readonly size: number;
  /** Junction id of each node, by index — what the path heatmap is keyed on. */
  readonly keys: string[];
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  /** Segments, each stored once: the node at either end and its length (m). */
  readonly edgeA: Int32Array;
  readonly edgeB: Int32Array;
  readonly edgeLength: Float64Array;
  private readonly edgeMicrons: Float64Array;
  // A directed segment ("state") is 2e for edgeA→edgeB and 2e+1 for the
  // reverse; these hold its unit direction.
  private readonly stateX: Float64Array;
  private readonly stateY: Float64Array;
  // Adjacency in compressed rows: node i's entries are offsets[i] ..
  // offsets[i + 1] - 1, each the directed segment leaving i.
  private readonly offsets: Int32Array;
  private readonly leaving: Int32Array;
  private readonly segmentOf = new Map<string, number>();
  /** Each corridor as its nodes and the distance along it at each, for joins stated as an offset along a corridor. */
  private readonly corridors = new Map<string, { nodes: number[]; along: number[] }>();
  /** For each segment, the first corridor drawn along it and the offsets along that corridor at its two ends. */
  private readonly placeOfSegment: Array<{ corridor: string; atA: number; atB: number }> = [];
  private readonly trees = new Map<string, RouteTree>();

  constructor(paths: Path[]) {
    const index = new Map<string, number>();
    const keys: string[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    const nodeOf = (id: string, p: Point): number => {
      let i = index.get(id);
      if (i === undefined) {
        i = keys.length;
        index.set(id, i);
        keys.push(id);
        xs.push(p.x);
        ys.push(p.y);
      }
      return i;
    };

    const edgeA: number[] = [];
    const edgeB: number[] = [];
    const edgeLength: number[] = [];
    for (const path of paths) {
      const nodes = path.points.map((p, i) => nodeOf(path.junctionIds[i], p));
      const along = [0];
      for (let i = 1; i < nodes.length; i++) {
        along.push(along[i - 1] + Math.hypot(path.points[i].x - path.points[i - 1].x, path.points[i].y - path.points[i - 1].y));
      }
      if (!this.corridors.has(path.id)) this.corridors.set(path.id, { nodes, along });

      for (let i = 0; i < nodes.length - 1; i++) {
        const a = nodes[i];
        const b = nodes[i + 1];
        if (a === b) continue;
        const length = along[i + 1] - along[i];
        // Two corridors drawn over the same segment are one stretch of floor.
        const pair = a < b ? `${a}:${b}` : `${b}:${a}`;
        const existing = this.segmentOf.get(pair);
        if (existing !== undefined) {
          edgeLength[existing] = Math.min(edgeLength[existing], length);
          continue;
        }
        this.segmentOf.set(pair, edgeA.length);
        edgeA.push(a);
        edgeB.push(b);
        edgeLength.push(length);
        this.placeOfSegment.push({ corridor: path.id, atA: along[i], atB: along[i + 1] });
      }
    }

    this.size = keys.length;
    this.keys = keys;
    this.xs = Float64Array.from(xs);
    this.ys = Float64Array.from(ys);
    this.edgeA = Int32Array.from(edgeA);
    this.edgeB = Int32Array.from(edgeB);
    this.edgeLength = Float64Array.from(edgeLength);
    this.edgeMicrons = Float64Array.from(edgeLength, (length) => Math.round(length * MICRONS));

    const segments = edgeA.length;
    this.stateX = new Float64Array(segments * 2);
    this.stateY = new Float64Array(segments * 2);
    for (let e = 0; e < segments; e++) {
      const length = edgeLength[e] || 1;
      const dx = (xs[edgeB[e]] - xs[edgeA[e]]) / length;
      const dy = (ys[edgeB[e]] - ys[edgeA[e]]) / length;
      this.stateX[2 * e] = dx;
      this.stateY[2 * e] = dy;
      this.stateX[2 * e + 1] = -dx;
      this.stateY[2 * e + 1] = -dy;
    }

    const offsets = new Int32Array(this.size + 1);
    for (let e = 0; e < segments; e++) {
      offsets[edgeA[e] + 1] += 1;
      offsets[edgeB[e] + 1] += 1;
    }
    for (let i = 0; i < this.size; i++) offsets[i + 1] += offsets[i];
    const fill = offsets.slice(0, this.size);
    const leaving = new Int32Array(segments * 2);
    for (let e = 0; e < segments; e++) {
      leaving[fill[edgeA[e]]++] = 2 * e;
      leaving[fill[edgeB[e]]++] = 2 * e + 1;
    }
    this.offsets = offsets;
    this.leaving = leaving;
  }

  point(node: number): Point {
    return { x: this.xs[node], y: this.ys[node] };
  }

  /** The node a directed segment arrives at. */
  head(state: number): number {
    return state & 1 ? this.edgeA[state >> 1] : this.edgeB[state >> 1];
  }

  /** The node it leaves from. */
  tail(state: number): number {
    return state & 1 ? this.edgeB[state >> 1] : this.edgeA[state >> 1];
  }

  direction(state: number): Direction {
    return [this.stateX[state], this.stateY[state]];
  }

  /** The directed segments arriving at a node. */
  arrivingAt(node: number): number[] {
    const states: number[] = [];
    for (let k = this.offsets[node]; k < this.offsets[node + 1]; k++) states.push(this.leaving[k] ^ 1);
    return states;
  }

  segmentBetween(a: number, b: number): number {
    return this.segmentOf.get(a < b ? `${a}:${b}` : `${b}:${a}`) ?? -1;
  }

  /** Where a stated access joins the network — null for a corridor the plan doesn't have. The offset is held within the corridor's length. */
  joinAlong(access: Access): Connection | null {
    const corridor = this.corridors.get(access.corridor);
    if (!corridor || corridor.nodes.length < 2) return null;
    const { nodes, along } = corridor;
    const offset = Math.max(0, Math.min(along[along.length - 1], access.offset));
    let i = 0;
    while (i < nodes.length - 2 && along[i + 1] < offset) i++;
    const start = along[i];
    const end = along[i + 1];
    if (offset - start <= SNAP_METERS || end - start <= SNAP_METERS) return nodeJoin(this, nodes[i]);
    if (end - offset <= SNAP_METERS) return nodeJoin(this, nodes[i + 1]);
    const e = this.segmentBetween(nodes[i], nodes[i + 1]);
    if (e < 0) return nodeJoin(this, nodes[i]);
    const share = (offset - start) / (end - start);
    const a = nodes[i];
    const b = nodes[i + 1];
    return {
      point: { x: this.xs[a] + share * (this.xs[b] - this.xs[a]), y: this.ys[a] + share * (this.ys[b] - this.ys[a]) },
      node: NO_NODE,
      edge: e,
      t: this.edgeA[e] === a ? share : 1 - share,
    };
  }

  /** A join as the plan would state it: a corridor and the distance along it. */
  placeOf(connection: Connection): Access | null {
    if (connection.node !== NO_NODE) {
      const k = this.offsets[connection.node];
      if (k === this.offsets[connection.node + 1]) return null;
      const e = this.leaving[k] >> 1;
      const place = this.placeOfSegment[e];
      return { corridor: place.corridor, offset: this.edgeA[e] === connection.node ? place.atA : place.atB };
    }
    const place = this.placeOfSegment[connection.edge];
    return { corridor: place.corridor, offset: place.atA + connection.t * (place.atB - place.atA) };
  }

  /**
   * Shortest routes, then fewest turns, from `node` to every directed
   * segment, having arrived at `node` heading `heading` (null: no turn is
   * counted for the first segment). Kept per node and per set of first
   * segments that would count as turns.
   */
  treeFrom(node: number, heading: Direction | null): RouteTree {
    const first = this.offsets[node];
    const last = this.offsets[node + 1];
    let mask = 0;
    if (heading) {
      for (let k = first; k < last; k++) {
        const state = this.leaving[k];
        mask |= turn(heading, this.stateX[state], this.stateY[state]) << (k - first);
      }
    }
    const key = `${node}:${mask}`;
    const cached = this.trees.get(key);
    if (cached) return cached;

    const states = this.edgeA.length * 2;
    const length = new Float64Array(states).fill(Infinity);
    const turns = new Uint32Array(states);
    const previous = new Int32Array(states).fill(-1);
    const settled = new Uint8Array(states);
    const heap = new SegmentHeap();
    const offer = (state: number, routeLength: number, routeTurns: number, from: number) => {
      if (routeLength < length[state] || (routeLength === length[state] && routeTurns < turns[state])) {
        length[state] = routeLength;
        turns[state] = routeTurns;
        previous[state] = from;
        heap.push(state, routeLength, routeTurns);
      }
    };

    for (let k = first; k < last; k++) {
      const state = this.leaving[k];
      offer(state, this.edgeMicrons[state >> 1], (mask >> (k - first)) & 1, -1);
    }
    while (heap.size > 0) {
      const state = heap.pop();
      if (settled[state]) continue;
      settled[state] = 1;
      const at = this.head(state);
      const direction: Direction = [this.stateX[state], this.stateY[state]];
      for (let k = this.offsets[at]; k < this.offsets[at + 1]; k++) {
        const next = this.leaving[k];
        if (settled[next]) continue;
        offer(
          next,
          length[state] + this.edgeMicrons[next >> 1],
          turns[state] + turn(direction, this.stateX[next], this.stateY[next]),
          state,
        );
      }
    }

    const tree = { length, turns, previous };
    this.trees.set(key, tree);
    return tree;
  }
}

/** Where a point (a slot's entry, a facility's centre) joins the corridor network. */
export interface Connection {
  /** The point on the network it joins at. */
  point: Point;
  /** The node it joins at, when it lands on (or within a centimetre of) one; NO_NODE otherwise. */
  node: number;
  /** Otherwise the segment it joins partway along... */
  edge: number;
  /** ...and how far along it, 0..1 from edgeA to edgeB. */
  t: number;
}

// How close a projection has to be to a segment's own end to just reuse that
// node instead of joining a hair's width away from it.
const SNAP_EPSILON = 0.01;
/** The same, for a join stated as an offset along a corridor: within a centimetre of a junction is at it. */
const SNAP_METERS = 0.01;
// A corridor exactly level with a slot's entry edge still counts as in front.
const FACING_EPSILON = 1e-6;

function nodeJoin(graph: PathGraph, node: number): Connection {
  return { point: graph.point(node), node, edge: -1, t: 0 };
}

/**
 * For a slot or facility whose plan doesn't state its access: projects the
 * point onto the *nearest point along any segment* of the graph — not just
 * onto existing nodes, which would route a slot to the nearest aisle *end*
 * instead of the nearest aisle *point*. Point-to-segment projection, clamped
 * to the segment's own span, checked against every segment.
 *
 * With `facing` (a slot's outward direction), only corridors in front of the
 * point count, when there are any: a slot is entered from the aisle it opens
 * onto, never through its own back. Where two aisles run close on either side
 * of a rack (10H's short east end of aisle A, right behind HA76), the one
 * behind can be the nearer by a few centimetres.
 *
 * Null when the plan has no corridors at all.
 */
export function connectPoint(graph: PathGraph, point: Point, facing?: Point): Connection | null {
  let best = -1;
  let bestT = 0;
  let bestDistance = Infinity;
  let front = -1;
  let frontT = 0;
  let frontDistance = Infinity;

  for (let e = 0; e < graph.edgeA.length; e++) {
    const ax = graph.xs[graph.edgeA[e]];
    const ay = graph.ys[graph.edgeA[e]];
    const dx = graph.xs[graph.edgeB[e]] - ax;
    const dy = graph.ys[graph.edgeB[e]] - ay;
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq === 0 ? 0 : ((point.x - ax) * dx + (point.y - ay) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const distance = Math.hypot(point.x - px, point.y - py);
    if (distance < bestDistance) {
      best = e;
      bestT = t;
      bestDistance = distance;
    }
    const inFront = !facing || (px - point.x) * facing.x + (py - point.y) * facing.y >= -FACING_EPSILON;
    if (inFront && distance < frontDistance) {
      front = e;
      frontT = t;
      frontDistance = distance;
    }
  }
  if (front >= 0) {
    best = front;
    bestT = frontT;
  }
  if (best < 0) return null;

  const a = graph.edgeA[best];
  const b = graph.edgeB[best];
  if (bestT <= SNAP_EPSILON) return nodeJoin(graph, a);
  if (bestT >= 1 - SNAP_EPSILON) return nodeJoin(graph, b);
  return {
    point: { x: graph.xs[a] + bestT * (graph.xs[b] - graph.xs[a]), y: graph.ys[a] + bestT * (graph.ys[b] - graph.ys[a]) },
    node: NO_NODE,
    edge: best,
    t: bestT,
  };
}

export interface Route {
  /** [from, ...network points..., to] — always starts/ends with the exact input points, see below. */
  points: Point[];
  /**
   * Every corridor segment traveled, as directed node pairs laid flat
   * ([a0, b0, a1, b1, ...]) — what the path heatmap counts. A stretch that
   * starts or ends partway along a segment (a slot's join) credits that whole
   * segment in the direction traveled; dropping those had once left a slot
   * busy on the heatmap with no traffic on the corridor that served it.
   */
  hops: number[];
}

function sameJoin(a: Connection, b: Connection): boolean {
  if (a.node !== NO_NODE || b.node !== NO_NODE) return a.node === b.node;
  return a.edge === b.edge && a.t.toFixed(6) === b.t.toFixed(6);
}

/** A way onto the network from a start: the node reached, the heading on reaching it, and what getting there cost. */
interface Departure {
  node: number;
  heading: Direction | null;
  length: number;
  turns: number;
  hop: [number, number] | null;
}

/** A way off the network to a goal: the node left from, the heading leaving it, and what the rest costs. */
interface Arrival {
  node: number;
  onward: Direction | null;
  length: number;
  turns: number;
  hop: [number, number] | null;
}

function departures(graph: PathGraph, from: Point, join: Connection): Departure[] {
  const notch = unit(from, join.point);
  if (join.node !== NO_NODE) return [{ node: join.node, heading: notch, length: 0, turns: 0, hop: null }];
  const e = join.edge;
  const a = graph.edgeA[e];
  const b = graph.edgeB[e];
  const segment = graph.edgeLength[e];
  const ab = graph.direction(2 * e);
  const ba = graph.direction(2 * e + 1);
  return [
    { node: a, heading: ba, length: Math.round(join.t * segment * MICRONS), turns: notch ? turn(notch, ba[0], ba[1]) : 0, hop: [b, a] },
    { node: b, heading: ab, length: Math.round((1 - join.t) * segment * MICRONS), turns: notch ? turn(notch, ab[0], ab[1]) : 0, hop: [a, b] },
  ];
}

function arrivals(graph: PathGraph, to: Point, join: Connection): Arrival[] {
  const out = unit(join.point, to);
  if (join.node !== NO_NODE) return [{ node: join.node, onward: out, length: 0, turns: 0, hop: null }];
  const e = join.edge;
  const a = graph.edgeA[e];
  const b = graph.edgeB[e];
  const segment = graph.edgeLength[e];
  const ab = graph.direction(2 * e);
  const ba = graph.direction(2 * e + 1);
  return [
    { node: a, onward: ab, length: Math.round(join.t * segment * MICRONS), turns: out ? turn(ab, out[0], out[1]) : 0, hop: [a, b] },
    { node: b, onward: ba, length: Math.round((1 - join.t) * segment * MICRONS), turns: out ? turn(ba, out[0], out[1]) : 0, hop: [b, a] },
  ];
}

/**
 * The quickest route between two arbitrary points, riding the path network
 * in between. Always starts and ends with the *exact* input points (not the
 * points they join the network at) — so for a slot's entry position, the
 * returned polyline naturally includes a short notch off the aisle into the
 * slot, with no separate mechanism needed for that.
 *
 * A join partway along a segment can leave by either end, and a goal can be
 * reached from any segment arriving at its node, so the route is the best of
 * those combinations: shortest, then fewest turns — counting turns exactly as
 * the time model does, notches included.
 */
export function routeBetween(
  graph: PathGraph,
  from: Point,
  fromJoin: Connection | null,
  to: Point,
  toJoin: Connection | null,
): Route {
  if (!fromJoin || !toJoin) return { points: [from, to], hops: [] };
  if (sameJoin(fromJoin, toJoin)) return { points: [from, fromJoin.point, to], hops: [] };

  const { edgeA, edgeB } = graph;

  // Both partway along the same segment: straight along it, never out to an
  // end and back (A01 then A04 on one aisle).
  if (fromJoin.edge !== -1 && fromJoin.edge === toJoin.edge) {
    const e = fromJoin.edge;
    return {
      points: [from, fromJoin.point, toJoin.point, to],
      hops: toJoin.t >= fromJoin.t ? [edgeA[e], edgeB[e]] : [edgeB[e], edgeA[e]],
    };
  }

  let best: { length: number; turns: number; departure: Departure; arrival: Arrival; state: number } | null = null;
  const consider = (length: number, turns: number, departure: Departure, arrival: Arrival, state: number) => {
    if (!Number.isFinite(length)) return;
    if (!best || length < best.length - TIE_MICRONS || (length <= best.length + TIE_MICRONS && turns < best.turns)) {
      best = { length, turns, departure, arrival, state };
    }
  };

  for (const departure of departures(graph, from, fromJoin)) {
    let tree: RouteTree | null = null;
    for (const arrival of arrivals(graph, to, toJoin)) {
      if (departure.node === arrival.node) {
        const here = departure.heading && arrival.onward ? turn(departure.heading, arrival.onward[0], arrival.onward[1]) : 0;
        consider(departure.length + arrival.length, departure.turns + here + arrival.turns, departure, arrival, -1);
        continue;
      }
      tree ??= graph.treeFrom(departure.node, departure.heading);
      for (const state of graph.arrivingAt(arrival.node)) {
        const [dx, dy] = graph.direction(state);
        const here = arrival.onward ? (dx * arrival.onward[0] + dy * arrival.onward[1] < TURN_COS_THRESHOLD ? 1 : 0) : 0;
        consider(
          departure.length + tree.length[state] + arrival.length,
          departure.turns + tree.turns[state] + here + arrival.turns,
          departure,
          arrival,
          state,
        );
      }
    }
  }

  const chosen = best as { departure: Departure; arrival: Arrival; state: number } | null;
  if (!chosen) return { points: [from, to], hops: [] }; // unreachable — shouldn't happen with real data, but don't crash

  const { departure, arrival } = chosen;
  const chain = [departure.node];
  const hops: number[] = [];
  if (chosen.state !== -1) {
    const tree = graph.treeFrom(departure.node, departure.heading);
    const states: number[] = [];
    for (let state = chosen.state; state !== -1; state = tree.previous[state]) states.push(state);
    states.reverse();
    for (const state of states) {
      chain.push(graph.head(state));
      hops.push(graph.tail(state), graph.head(state));
    }
  }

  const points: Point[] = [from];
  if (fromJoin.node === NO_NODE) points.push(fromJoin.point);
  for (const node of chain) points.push(graph.point(node));
  if (toJoin.node === NO_NODE) points.push(toJoin.point);
  points.push(to);
  return {
    points,
    hops: [...(departure.hop ?? []), ...hops, ...(arrival.hop ?? [])],
  };
}
