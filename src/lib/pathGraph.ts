import type { Path, Point } from "../types/warehouse";

/**
 * Turns the warehouse's `paths` (§5.1's physical/visual corridor markings)
 * into a routable graph for the forklift picking-list simulation (§5.3).
 * Works because of the graph-readiness authoring convention already
 * established when paths were added: any point shared between two paths, or
 * between a path and a door, is an *exact* coincident coordinate, not just a
 * visual overlap — so deduping identical (x,y) into node ids is safe and
 * needs no fuzzy matching. Spans every building already, since a
 * cross-building connector is just another path in the same array.
 *
 * Compiled for batches of thousands of lists: nodes are integer indices with
 * their coordinates in typed arrays, each corridor segment is stored once,
 * and the shortest-path tree from a node is computed the first time a route
 * leaves from it and then kept. A plan's graph is small (CML: 271 nodes, 285
 * segments), so after a handful of trees a leg costs a table lookup and a
 * walk back along its own path.
 */

/** Exported so callers outside this module (Paths.tsx's usage-count coloring) can derive the same node id for a raw (x,y) — e.g. to key a directed edge's usage count the same way the graph keys its own nodes. */
export function nodeKey(p: Point): string {
  return `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
}

export const NO_NODE = -1;

export interface ShortestPathTree {
  /** Distance from the tree's source to every node; Infinity where unreachable. */
  distance: Float64Array;
  /** The node before each one on its shortest path from the source; NO_NODE at the source and where unreachable. */
  previous: Int32Array;
}

/** A binary min-heap of node indices, keyed by distance. Stale entries are skipped by the caller rather than updated in place. */
class MinHeap {
  private readonly nodes: Int32Array;
  private readonly keys: Float64Array;
  length = 0;

  constructor(capacity: number) {
    this.nodes = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }

  push(node: number, key: number): void {
    let i = this.length++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.nodes[i] = this.nodes[parent];
      this.keys[i] = this.keys[parent];
      i = parent;
    }
    this.nodes[i] = node;
    this.keys[i] = key;
  }

  pop(): number {
    const top = this.nodes[0];
    const last = --this.length;
    const node = this.nodes[last];
    const key = this.keys[last];
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= last) break;
      const right = left + 1;
      const child = right < last && this.keys[right] < this.keys[left] ? right : left;
      if (this.keys[child] >= key) break;
      this.nodes[i] = this.nodes[child];
      this.keys[i] = this.keys[child];
      i = child;
    }
    this.nodes[i] = node;
    this.keys[i] = key;
    return top;
  }
}

export class PathGraph {
  readonly size: number;
  /** nodeKey of each node, by index — what the path heatmap is keyed on. */
  readonly keys: string[];
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  /** Corridor segments, each stored once: the node at either end and the segment's length. */
  readonly edgeA: Int32Array;
  readonly edgeB: Int32Array;
  readonly edgeLength: Float64Array;
  // Adjacency in compressed rows: node i's neighbours are
  // neighbours[offsets[i]] .. neighbours[offsets[i + 1] - 1].
  private readonly offsets: Int32Array;
  private readonly neighbours: Int32Array;
  private readonly neighbourDistance: Float64Array;
  private readonly trees: (ShortestPathTree | undefined)[];

  constructor(paths: Path[]) {
    const index = new Map<string, number>();
    const keys: string[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    const nodeOf = (p: Point): number => {
      const key = nodeKey(p);
      let i = index.get(key);
      if (i === undefined) {
        i = keys.length;
        index.set(key, i);
        keys.push(key);
        xs.push(p.x);
        ys.push(p.y);
      }
      return i;
    };

    const segmentOf = new Map<string, number>();
    const edgeA: number[] = [];
    const edgeB: number[] = [];
    const edgeLength: number[] = [];
    for (const path of paths) {
      for (let i = 0; i < path.points.length - 1; i++) {
        const p = path.points[i];
        const q = path.points[i + 1];
        const a = nodeOf(p);
        const b = nodeOf(q);
        if (a === b) continue;
        const length = Math.hypot(q.x - p.x, q.y - p.y);
        // Two paths drawn over the same segment are one corridor.
        const pair = a < b ? `${a}:${b}` : `${b}:${a}`;
        const existing = segmentOf.get(pair);
        if (existing !== undefined) {
          edgeLength[existing] = Math.min(edgeLength[existing], length);
          continue;
        }
        segmentOf.set(pair, edgeA.length);
        edgeA.push(a);
        edgeB.push(b);
        edgeLength.push(length);
      }
    }

    this.size = keys.length;
    this.keys = keys;
    this.xs = Float64Array.from(xs);
    this.ys = Float64Array.from(ys);
    this.edgeA = Int32Array.from(edgeA);
    this.edgeB = Int32Array.from(edgeB);
    this.edgeLength = Float64Array.from(edgeLength);

    const offsets = new Int32Array(this.size + 1);
    for (let e = 0; e < edgeA.length; e++) {
      offsets[edgeA[e] + 1] += 1;
      offsets[edgeB[e] + 1] += 1;
    }
    for (let i = 0; i < this.size; i++) offsets[i + 1] += offsets[i];
    const fill = offsets.slice(0, this.size);
    const neighbours = new Int32Array(edgeA.length * 2);
    const neighbourDistance = new Float64Array(edgeA.length * 2);
    for (let e = 0; e < edgeA.length; e++) {
      neighbours[fill[edgeA[e]]] = edgeB[e];
      neighbourDistance[fill[edgeA[e]]++] = edgeLength[e];
      neighbours[fill[edgeB[e]]] = edgeA[e];
      neighbourDistance[fill[edgeB[e]]++] = edgeLength[e];
    }
    this.offsets = offsets;
    this.neighbours = neighbours;
    this.neighbourDistance = neighbourDistance;
    this.trees = new Array(this.size);
  }

  point(node: number): Point {
    return { x: this.xs[node], y: this.ys[node] };
  }

  /** Shortest paths from `source` to everywhere — Dijkstra on a binary heap, computed once per source and kept. */
  tree(source: number): ShortestPathTree {
    const cached = this.trees[source];
    if (cached) return cached;

    const distance = new Float64Array(this.size).fill(Infinity);
    const previous = new Int32Array(this.size).fill(NO_NODE);
    const settled = new Uint8Array(this.size);
    const heap = new MinHeap(this.neighbours.length + 1);
    distance[source] = 0;
    heap.push(source, 0);
    while (heap.length > 0) {
      const node = heap.pop();
      if (settled[node]) continue;
      settled[node] = 1;
      const base = distance[node];
      for (let k = this.offsets[node]; k < this.offsets[node + 1]; k++) {
        const next = this.neighbours[k];
        if (settled[next]) continue;
        const alt = base + this.neighbourDistance[k];
        if (alt < distance[next]) {
          distance[next] = alt;
          previous[next] = node;
          heap.push(next, alt);
        }
      }
    }

    const tree = { distance, previous };
    this.trees[source] = tree;
    return tree;
  }
}

/** Where a point (a slot's entry, a facility's centre) joins the corridor network. */
export interface Connection {
  /** The point on the network it joins at. */
  point: Point;
  /** The node it joins at, when it lands on (or within a hair of) one; NO_NODE otherwise. */
  node: number;
  /** Otherwise the corridor segment it joins partway along... */
  edge: number;
  /** ...and how far along it, 0..1 from edgeA to edgeB. */
  t: number;
}

// How close a projection has to be to a segment's own end to just reuse that
// node instead of joining a hair's width away from it.
const SNAP_EPSILON = 0.01;
// A corridor exactly level with a slot's entry edge still counts as in front.
const FACING_EPSILON = 1e-6;

/**
 * Projects an arbitrary point (a slot's entry, a facility's center) onto the
 * *nearest point along any segment* of the graph — not just onto existing
 * nodes. Using only nodes would route a slot to the nearest aisle *end*
 * instead of the nearest aisle *point*, which would send every slot along a
 * long aisle through the same corner. Point-to-segment projection, clamped
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
  if (bestT <= SNAP_EPSILON) return { point: graph.point(a), node: a, edge: -1, t: 0 };
  if (bestT >= 1 - SNAP_EPSILON) return { point: graph.point(b), node: b, edge: -1, t: 0 };
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

/**
 * The quickest route between two arbitrary points, riding the path network
 * in between. Always starts and ends with the *exact* input points (not the
 * points they join the network at) — so for a slot's entry position, the
 * returned polyline naturally includes a short notch off the aisle into the
 * slot, with no separate mechanism needed for that.
 *
 * A join partway along a segment can leave it by either end, so the route is
 * the best of (at most) four: each end of the start's segment, through the
 * kept shortest-path tree, to each end of the goal's.
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

  const exits = ends(graph, fromJoin);
  const entries = ends(graph, toJoin);
  let bestCost = Infinity;
  let start = NO_NODE;
  let goal = NO_NODE;
  for (let i = 0; i < exits.length; i += 2) {
    const tree = graph.tree(exits[i]);
    for (let j = 0; j < entries.length; j += 2) {
      const cost = exits[i + 1] + tree.distance[entries[j]] + entries[j + 1];
      if (cost < bestCost) {
        bestCost = cost;
        start = exits[i];
        goal = entries[j];
      }
    }
  }
  if (start === NO_NODE) return { points: [from, to], hops: [] }; // unreachable — shouldn't happen with real data, but don't crash

  const previous = graph.tree(start).previous;
  const chain: number[] = [];
  for (let node = goal; node !== start; node = previous[node]) chain.push(node);
  chain.push(start);
  chain.reverse();

  const points: Point[] = [from];
  const hops: number[] = [];
  if (fromJoin.node === NO_NODE) {
    points.push(fromJoin.point);
    const e = fromJoin.edge;
    // Leaving the segment towards `start`.
    if (start === edgeA[e]) hops.push(edgeB[e], edgeA[e]);
    else hops.push(edgeA[e], edgeB[e]);
  }
  for (let i = 0; i < chain.length; i++) {
    points.push(graph.point(chain[i]));
    if (i > 0) hops.push(chain[i - 1], chain[i]);
  }
  if (toJoin.node === NO_NODE) {
    points.push(toJoin.point);
    const e = toJoin.edge;
    // Entering the segment from `goal`.
    if (goal === edgeA[e]) hops.push(edgeA[e], edgeB[e]);
    else hops.push(edgeB[e], edgeA[e]);
  }
  points.push(to);
  return { points, hops };
}

/** The nodes a join can reach the network through, with the distance to each, laid flat: [node, distance, ...]. */
function ends(graph: PathGraph, join: Connection): number[] {
  if (join.node !== NO_NODE) return [join.node, 0];
  const e = join.edge;
  const length = graph.edgeLength[e];
  return [graph.edgeA[e], join.t * length, graph.edgeB[e], (1 - join.t) * length];
}
