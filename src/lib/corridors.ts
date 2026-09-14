import type { Corridor, Door, Junction, LegacyPath, Path, Point } from "../types/warehouse";

/**
 * The corridor network as a plan stores it — named junctions, and corridors
 * listing the junctions they run through (specs.md §5.1) — and the two things
 * done with it when a plan loads: resolving it into polylines to draw and
 * route over, and converting a plan still in the older `paths` format.
 */

/**
 * Each corridor as a polyline through its junctions. A corridor naming a
 * junction the plan doesn't have is resolved without it; the plan checker
 * reports the broken reference.
 */
export function resolvePaths(junctions: Junction[], corridors: Corridor[]): Path[] {
  const byId = new Map(junctions.map((junction) => [junction.id, junction]));
  const paths: Path[] = [];
  for (const corridor of corridors) {
    const along = corridor.junctions
      .map((id) => byId.get(id))
      .filter((junction): junction is Junction => junction !== undefined);
    if (along.length < 2) continue;
    const buildingIds = [...new Set(along.map((j) => j.buildingId).filter((id): id is string => Boolean(id)))];
    const first = along[0].buildingId;
    const last = along[along.length - 1].buildingId;
    paths.push({
      id: corridor.id,
      points: along.map((j) => ({ x: j.x, y: j.y })),
      junctionIds: along.map((j) => j.id),
      width: corridor.width,
      buildingIds,
      ...(first && last && first !== last ? { endpointBuildingIds: [first, last] as [string, string] } : {}),
    });
  }
  return paths;
}

/** Which way a corridor end points, from the point before it: E, W, N or S. */
function compass(from: Point, to: Point): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "E" : "W";
  return dy >= 0 ? "N" : "S";
}

interface Site {
  point: Point;
  paths: LegacyPath[];
  /** The first path found ending here, and the point before its end. */
  end?: { path: LegacyPath; first: boolean; before: Point };
  /** The first path found passing through here, and where along it. */
  bend?: { path: LegacyPath; index: number };
}

/**
 * Converts the older `paths` format — polylines that connected only where
 * two shared an exact coordinate — into junctions and corridors. Each path
 * becomes a corridor of the same id. Junctions are named by the convention
 * the importers use (specs.md §5.7):
 * - a door's position, after the door;
 * - a meeting point, after the corridors meeting there
 *   (`Path-Main+Path-Service`);
 * - a dead end, after its corridor and the way it points (`Path-Annex-Aisle.W`);
 * - a bend, after its corridor and its place along it (`Path-Main.2`).
 */
export function junctionsFromPaths(paths: LegacyPath[], doors: Door[]): { junctions: Junction[]; corridors: Corridor[] } {
  const key = (p: Point) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
  const doorAt = new Map(doors.map((door) => [key(door), door]));

  const sites = new Map<string, Site>();
  for (const path of paths) {
    path.points.forEach((point, index) => {
      const k = key(point);
      let site = sites.get(k);
      if (!site) {
        site = { point, paths: [] };
        sites.set(k, site);
      }
      if (!site.paths.includes(path)) site.paths.push(path);
      const last = path.points.length - 1;
      if ((index === 0 || index === last) && path.points.length > 1) {
        site.end ??= { path, first: index === 0, before: path.points[index === 0 ? 1 : last - 1] };
      } else {
        site.bend ??= { path, index };
      }
    });
  }

  const taken = new Set<string>();
  const idAt = new Map<string, string>();
  const junctions: Junction[] = [];
  for (const [k, site] of sites) {
    const door = doorAt.get(k);
    const name = door
      ? door.id
      : site.paths.length > 1
        ? site.paths.map((path) => path.id).join("+")
        : site.end
          ? `${site.end.path.id}.${compass(site.end.before, site.point)}`
          : `${site.bend!.path.id}.${site.bend!.index}`;
    let id = name;
    for (let n = 2; taken.has(id); n++) id = `${name}~${n}`;
    taken.add(id);
    idAt.set(k, id);

    // A door knows its building; otherwise a path within one building says,
    // and failing that the end of a link between two.
    const within = site.paths.find((path) => path.buildingIds.length === 1);
    const linkEnd = site.end?.path.endpointBuildingIds?.[site.end.first ? 0 : 1];
    const buildingId = door?.buildingId ?? within?.buildingIds[0] ?? linkEnd;
    junctions.push({ id, x: site.point.x, y: site.point.y, ...(buildingId ? { buildingId } : {}) });
  }

  const corridors: Corridor[] = paths.map((path) => {
    const ids: string[] = [];
    for (const point of path.points) {
      const id = idAt.get(key(point))!;
      if (ids[ids.length - 1] !== id) ids.push(id);
    }
    return { id: path.id, junctions: ids, ...(path.width !== undefined ? { width: path.width } : {}) };
  });

  return { junctions, corridors };
}
