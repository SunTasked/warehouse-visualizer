import type { Point, Slot, WallLoop } from "../types/warehouse";

/**
 * A "warehouse" in the new 5-level focus hierarchy (plant -> warehouse ->
 * slot -> slot-space -> pallet) is one closed wall loop — a building.
 * Deliberately no schema field for this: it's derived from the existing
 * walls array so older files keep working unchanged.
 */
export interface Building {
  id: string;
  label: string;
  loop: WallLoop;
}

function closedLoops(walls: WallLoop[]): WallLoop[] {
  return walls.filter((w) => w.closed && w.points.length >= 3);
}

// Standard ray-casting point-in-polygon test.
function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * One entry per closed wall loop, labeled with the loop's own id — which is
 * the building's name ("Main warehouse", "13A"). A lone building used to
 * borrow the warehouse's name instead, which labelled a plant's only building
 * with the plant's own name (CML) rather than its own (13A).
 */
export function listBuildings(walls: WallLoop[]): Building[] {
  return closedLoops(walls).map((loop) => ({ id: loop.id, label: loop.id, loop }));
}

/** Clear floor between a building's outer north wall face and its name. */
const LABEL_GAP = 0.6;

export interface BuildingLabelPlacement {
  text: string;
  /** Warehouse-space anchor: the name's bottom-left corner. */
  x: number;
  y: number;
  fontSize: number;
  /** Approximate extent, for camera framing only — the real glyph metrics exist only once rendered. */
  width: number;
  height: number;
}

/**
 * Where a building's name goes: outside its north-west corner (top-left on
 * the plan), left edge flush with the west wall's outer face, sitting just
 * past the north wall. Sized to the building so a 98 m hall and a 12 m annex
 * both stay legible at plant zoom without the small one's name swamping it.
 * One function for both the renderer and the camera framing, so the two
 * can't disagree about where the name is.
 */
export function buildingLabel(loop: WallLoop, wallThickness: number): BuildingLabelPlacement {
  const xs = loop.points.map((p) => p.x);
  const ys = loop.points.map((p) => p.y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const fontSize = Math.min(3.5, Math.max(0.8, span * 0.035));
  return {
    text: loop.id,
    x: Math.min(...xs) - wallThickness / 2,
    y: Math.max(...ys) + wallThickness / 2 + LABEL_GAP,
    fontSize,
    width: loop.id.length * fontSize * 0.62,
    height: fontSize * 1.2,
  };
}

/** The building a point stands in — or, for a point between buildings (a forklift crossing to the next one), the nearest. */
export function buildingAt(point: Point, walls: WallLoop[]): WallLoop | undefined {
  const loops = closedLoops(walls);
  const hit = loops.find((loop) => pointInPolygon(point, loop.points));
  if (hit) return hit;
  let nearest: WallLoop | undefined;
  let nearestDistance = Infinity;
  for (const loop of loops) {
    const xs = loop.points.map((p) => p.x);
    const ys = loop.points.map((p) => p.y);
    const dx = Math.max(Math.min(...xs) - point.x, 0, point.x - Math.max(...xs));
    const dy = Math.max(Math.min(...ys) - point.y, 0, point.y - Math.max(...ys));
    const distance = Math.hypot(dx, dy);
    if (distance < nearestDistance) {
      nearest = loop;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * Which building a slot belongs to, by testing its center point against
 * each closed loop. Falls back to the sole building (if there's only one)
 * when the point tests as technically outside — a slot right at/near a wall
 * shouldn't end up orphaned from its obvious building over rounding.
 */
export function findBuildingForSlot(slot: Slot, walls: WallLoop[]): string | undefined {
  const loops = closedLoops(walls);
  if (loops.length === 0) return undefined;
  const hit = loops.find((loop) => pointInPolygon({ x: slot.x, y: slot.y }, loop.points));
  if (hit) return hit.id;
  return loops.length === 1 ? loops[0].id : undefined;
}
