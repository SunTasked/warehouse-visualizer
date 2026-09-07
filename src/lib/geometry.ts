import type { Point, Warehouse } from "../types/warehouse";

/**
 * Warehouse coordinates are 2D: meters, origin bottom-left, +X right, +Y up
 * (specs.md §5.1). The scene is 3D with +Y as height, so the floor plane is
 * the scene's XZ plane. We map warehouse Y to scene -Z: increasing warehouse
 * Y ("further from the origin corner") moves away from the camera by
 * default, and — importantly — this mapping preserves the sign of rotation:
 * a warehouse counter-clockwise rotation (rotationDeg, +X toward +Y) equals
 * the same numeric angle applied as a Three.js rotation.y (which takes
 * scene +X toward scene -Z). No sign flip is needed for rotation, only for
 * the Z position component.
 */
export function toSceneXZ(x: number, y: number): [number, number] {
  return [x, -y];
}

/** Inverse of toSceneXZ — used to turn a drag point on the ground plane back into warehouse coordinates. */
export function fromSceneXZ(sceneX: number, sceneZ: number): Point {
  return { x: sceneX, y: -sceneZ };
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function computeBounds(warehouse: Warehouse): Bounds {
  const points: Point[] = warehouse.walls.flatMap((wall) => wall.points);
  if (points.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

export function boundsCenter(bounds: Bounds): { x: number; y: number } {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

export function boundsSpan(bounds: Bounds): number {
  return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}
