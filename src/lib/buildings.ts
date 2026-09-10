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
 * One entry per closed wall loop. Labeled with the warehouse's own name when
 * there's only one (the common case today), otherwise the loop's own id —
 * there's no dedicated "building name" field in the schema.
 */
export function listBuildings(walls: WallLoop[], warehouseName: string): Building[] {
  const loops = closedLoops(walls);
  return loops.map((loop) => ({
    id: loop.id,
    label: loops.length === 1 ? warehouseName : loop.id,
    loop,
  }));
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
