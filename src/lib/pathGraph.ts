import type { Path, Point } from "../types/warehouse";

/**
 * Turns the warehouse's `paths` (§5.1's physical/visual corridor markings)
 * into a routable graph for the forklift picking-list simulation (§5.3).
 * Works because of the graph-readiness authoring convention already
 * established when paths were added: any point shared between two paths, or
 * between a path and a door, is an *exact* coincident coordinate, not just a
 * visual overlap — so deduping identical (x,y) into node ids is safe and
 * needs no fuzzy matching. Spans every building already, since a
 * cross-building connector (e.g. "Path-Bridge") is just another path in the
 * same array.
 */
export interface PathGraph {
  nodes: Map<string, Point>;
  adjacency: Map<string, { to: string; distance: number }[]>;
}

/** Exported so callers outside this module (Paths.tsx's usage-count coloring) can derive the same node id for a raw (x,y) — e.g. to key a directed edge's usage count the same way buildPathGraph keys its own nodes. */
export function nodeKey(p: Point): string {
  return `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
}

/** A directed edge's usage-count map key — `nodeKey(a)→nodeKey(b)`, order-sensitive by design (see RouteEdge/Route). */
export function edgeKey(a: Point, b: Point): string {
  return `${nodeKey(a)}→${nodeKey(b)}`;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function addEdge(
  adjacency: Map<string, { to: string; distance: number }[]>,
  a: string,
  b: string,
  dist: number,
): void {
  if (!adjacency.has(a)) adjacency.set(a, []);
  if (!adjacency.has(b)) adjacency.set(b, []);
  adjacency.get(a)!.push({ to: b, distance: dist });
  adjacency.get(b)!.push({ to: a, distance: dist });
}

export function buildPathGraph(paths: Path[]): PathGraph {
  const nodes = new Map<string, Point>();
  const adjacency = new Map<string, { to: string; distance: number }[]>();

  const ensureNode = (p: Point): string => {
    const key = nodeKey(p);
    if (!nodes.has(key)) nodes.set(key, p);
    return key;
  };

  for (const path of paths) {
    for (let i = 0; i < path.points.length - 1; i++) {
      const a = path.points[i];
      const b = path.points[i + 1];
      addEdge(adjacency, ensureNode(a), ensureNode(b), distance(a, b));
    }
  }

  return { nodes, adjacency };
}

interface Connection {
  /** A real graph node id if the point snapped exactly onto one, otherwise a synthetic id scoped to one routeBetween() call. */
  nodeId: string;
  /** This connection's actual (x,y) — the projected point on the network for a synthetic node, or the graph node's own position otherwise. */
  point: Point;
  /** Edges to overlay on a *copy* of the graph's adjacency for this one query — the shared graph itself is never mutated. */
  extraEdges: Array<[string, { to: string; distance: number }]>;
}

// How close a projection has to be to an edge's own endpoint to just reuse
// that node instead of inserting a new one a hair's width away.
const SNAP_EPSILON = 0.01;

/**
 * Projects an arbitrary point (a slot's entry, a facility's center) onto the
 * *nearest point along any edge* of the graph — not just onto existing
 * nodes. Using only nodes would route a slot to the nearest aisle *end*
 * instead of the nearest aisle *point*, which would send every slot along a
 * long aisle through the same corner. Point-to-segment projection, clamped
 * to the segment's own span, checked against every edge.
 */
function connectPoint(graph: PathGraph, point: Point): Connection {
  let best: { a: string; b: string; t: number; distToLine: number } | null = null;

  for (const [a, edges] of graph.adjacency) {
    const pa = graph.nodes.get(a)!;
    for (const { to: b } of edges) {
      const pb = graph.nodes.get(b)!;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq === 0 ? 0 : ((point.x - pa.x) * dx + (point.y - pa.y) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const projX = pa.x + t * dx;
      const projY = pa.y + t * dy;
      const distToLine = Math.hypot(point.x - projX, point.y - projY);
      if (!best || distToLine < best.distToLine) {
        best = { a, b, t, distToLine };
      }
    }
  }

  if (!best) {
    // No paths at all in the graph — degenerate, but don't crash.
    return { nodeId: nodeKey(point), point, extraEdges: [] };
  }
  if (best.t <= SNAP_EPSILON) {
    return { nodeId: best.a, point: graph.nodes.get(best.a)!, extraEdges: [] };
  }
  if (best.t >= 1 - SNAP_EPSILON) {
    return { nodeId: best.b, point: graph.nodes.get(best.b)!, extraEdges: [] };
  }

  const pa = graph.nodes.get(best.a)!;
  const pb = graph.nodes.get(best.b)!;
  const projected: Point = { x: pa.x + best.t * (pb.x - pa.x), y: pa.y + best.t * (pb.y - pa.y) };
  const tempId = `~conn~${best.a}~${best.b}~${best.t.toFixed(6)}`;
  const distA = distance(pa, projected);
  const distB = distance(pb, projected);
  return {
    nodeId: tempId,
    point: projected,
    extraEdges: [
      [tempId, { to: best.a, distance: distA }],
      [tempId, { to: best.b, distance: distB }],
      [best.a, { to: tempId, distance: distA }],
      [best.b, { to: tempId, distance: distB }],
    ],
  };
}

/** Plain Dijkstra (not BFS — edges have real, unequal lengths, so only Dijkstra actually minimizes travel distance). O(V^2) selection, fine at this graph's size (dozens of nodes). */
function dijkstra(
  adjacency: Map<string, { to: string; distance: number }[]>,
  startId: string,
  endId: string,
): string[] | null {
  const dist = new Map<string, number>([[startId, 0]]);
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  const unvisited = new Set(adjacency.keys());
  unvisited.add(startId);
  unvisited.add(endId);

  while (unvisited.size > 0) {
    let current: string | null = null;
    let currentDist = Infinity;
    for (const id of unvisited) {
      const d = dist.get(id) ?? Infinity;
      if (d < currentDist) {
        currentDist = d;
        current = id;
      }
    }
    if (current === null) break; // everything left is unreachable
    unvisited.delete(current);
    visited.add(current);
    if (current === endId) break;

    for (const edge of adjacency.get(current) ?? []) {
      if (visited.has(edge.to)) continue;
      const alt = currentDist + edge.distance;
      if (alt < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, alt);
        prev.set(edge.to, current);
      }
    }
  }

  if (!dist.has(endId)) return null;
  const path: string[] = [endId];
  let cur = endId;
  while (cur !== startId) {
    const p = prev.get(cur);
    if (!p) return null;
    path.push(p);
    cur = p;
  }
  path.reverse();
  return path;
}

/** A directed hop between two *real* graph nodes (§5.3's usage-count coloring keys on these — not on the synthetic connector points a route's ends snap through, which aren't persistent path segments). */
export interface RouteEdge {
  a: string;
  b: string;
}

export interface Route {
  /** [from, ...network points..., to] — always starts/ends with the exact input points, see below. */
  points: Point[];
  /** Every real-node-to-real-node hop traveled, in order, for usage-count tracking. Excludes the notch legs at either end (from/to a synthetic connector point), since those aren't part of the persistent path network. */
  edges: RouteEdge[];
}

/**
 * The quickest route between two arbitrary points, riding the path network
 * in between. Always starts and ends with the *exact* input points (not the
 * snapped network points they connect through) — so for a slot's entry
 * position, the returned polyline naturally includes a short notch off the
 * aisle into the slot, with no separate mechanism needed for that.
 */
export function routeBetween(graph: PathGraph, from: Point, to: Point): Route {
  const fromConn = connectPoint(graph, from);
  const toConn = connectPoint(graph, to);

  const adjacency = new Map(graph.adjacency);
  for (const [nodeId, edge] of [...fromConn.extraEdges, ...toConn.extraEdges]) {
    adjacency.set(nodeId, [...(adjacency.get(nodeId) ?? []), edge]);
  }

  const pointOf = (id: string): Point => {
    if (id === fromConn.nodeId) return fromConn.point;
    if (id === toConn.nodeId) return toConn.point;
    return graph.nodes.get(id)!;
  };

  const edgesAlong = (ids: string[]): RouteEdge[] => {
    const edges: RouteEdge[] = [];
    for (let i = 0; i < ids.length - 1; i++) {
      const a = ids[i];
      const b = ids[i + 1];
      if (graph.nodes.has(a) && graph.nodes.has(b)) edges.push({ a, b });
    }
    return edges;
  };

  if (fromConn.nodeId === toConn.nodeId) {
    return { points: [from, fromConn.point, to], edges: [] };
  }

  const nodeIds = dijkstra(adjacency, fromConn.nodeId, toConn.nodeId);
  if (!nodeIds) return { points: [from, to], edges: [] }; // unreachable — shouldn't happen with real data, but don't crash

  return { points: [from, ...nodeIds.map(pointOf), to], edges: edgesAlong(nodeIds) };
}
