import * as THREE from "three";
import type { Point, Slot, SlotSize, Warehouse } from "../types/warehouse";

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

export interface SlotFootprint {
  /** subSlots.length, defaulting to 1 when absent. */
  depth: number;
  /** One sub-slot's depth-axis extent — always the un-multiplied slotDefaults.height. */
  cellDepth: number;
  /** The whole (possibly depth-multiplied) footprint's depth-axis extent. */
  totalDepth: number;
  /**
   * Local Z (pre-rotation) of the whole footprint's center, relative to the
   * slot group's own position — which is anchored to subSlots[0], not the
   * footprint's center. 0 when depth is 1. See specs.md §5.1 "Storage
   * subdivision" and Slots.tsx for the derivation.
   */
  footprintCenterZ: number;
}

/**
 * Depth-driven footprint math shared by the slot renderer (Slots.tsx) and
 * anything that needs to compute a slot's world extent without rendering it
 * (e.g. src/lib/focusBounds.ts for camera framing).
 */
export function slotFootprint(slot: Slot, defaults: SlotSize): SlotFootprint {
  const depth = slot.subSlots?.length ?? 1;
  const cellDepth = defaults.height;
  return {
    depth,
    cellDepth,
    totalDepth: cellDepth * depth,
    footprintCenterZ: ((depth - 1) * cellDepth) / 2,
  };
}

/**
 * A slot's fixed entry edge, in warehouse (x,y) space — where a forklift
 * would actually stop to load/unload (see specs.md §5.3's picking-list
 * routing). Derived from the exact same rotation convention already
 * verified elsewhere in this codebase (rotationDeg is a warehouse-space CCW
 * angle that maps directly to a Three.js rotation.y with no sign flip — see
 * this file's header comment): the entry point is the slot's local
 * (0, -cellDepth/2) — the front edge center, before depth extends it — put
 * through Three's standard Y-rotation matrix and back out of scene space.
 */
export function slotEntryPoint(slot: Slot, defaults: SlotSize): Point {
  const { cellDepth } = slotFootprint(slot, defaults);
  const halfCellDepth = cellDepth / 2;
  const rotationRad = THREE.MathUtils.degToRad(slot.rotationDeg ?? 0);
  return {
    x: slot.x - halfCellDepth * Math.sin(rotationRad),
    y: slot.y + halfCellDepth * Math.cos(rotationRad),
  };
}
