import * as THREE from "three";
import type { Slot, SlotSize, WallLoop, Warehouse } from "../types/warehouse";
import { computeBounds, slotFootprint, toSceneXZ } from "./geometry";
import { SLOT_HEIGHT } from "../components/Slots";
import { LEVEL_HEIGHT, RACK_MARGIN_FACTOR } from "../components/Rack";

/**
 * World-space bounding boxes for the view-mode camera drill-down (see
 * src/state/ViewFocusContext.tsx), computed analytically from the warehouse
 * data rather than read off rendered meshes — so a box is available even for
 * geometry that isn't (yet) mounted, and there's no ref-registry to keep in
 * sync. Mirrors the exact local-space math Slots.tsx/Rack.tsx render with;
 * a throwaway Object3D reproduces the slot group's position/rotation so the
 * transform can't drift from what's actually drawn.
 */
function slotTransform(slot: Slot): THREE.Object3D {
  const obj = new THREE.Object3D();
  obj.position.set(slot.x, SLOT_HEIGHT / 2, -slot.y);
  obj.rotation.set(0, THREE.MathUtils.degToRad(slot.rotationDeg ?? 0), 0);
  obj.updateMatrixWorld(true);
  return obj;
}

function boxFromLocalCorners(
  transform: THREE.Object3D,
  xRange: [number, number],
  yRange: [number, number],
  zRange: [number, number],
): THREE.Box3 {
  const box = new THREE.Box3();
  for (const x of xRange) {
    for (const y of yRange) {
      for (const z of zRange) {
        box.expandByPoint(transform.localToWorld(new THREE.Vector3(x, y, z)));
      }
    }
  }
  return box;
}

/** The whole slot's footprint, including the tallest rack among its sub-slots. */
export function slotWorldBox(slot: Slot, defaults: SlotSize): THREE.Box3 {
  const { depth, cellDepth } = slotFootprint(slot, defaults);
  const maxPallets = Math.max(0, ...(slot.subSlots?.map((ss) => ss.pallets.length) ?? [0]));
  const transform = slotTransform(slot);
  return boxFromLocalCorners(
    transform,
    [-defaults.width / 2, defaults.width / 2],
    [0, maxPallets * LEVEL_HEIGHT + SLOT_HEIGHT],
    [-cellDepth / 2, (depth - 1) * cellDepth + cellDepth / 2],
  );
}

/** One sub-slot's cell, sized to its own rack (or just the pad, if empty). */
export function subSlotWorldBox(slot: Slot, defaults: SlotSize, subSlotIndex: number): THREE.Box3 {
  const { cellDepth } = slotFootprint(slot, defaults);
  const subSlot = slot.subSlots?.[subSlotIndex];
  const pallets = subSlot?.pallets.length ?? 0;
  const halfWidth = (defaults.width / 2) * RACK_MARGIN_FACTOR;
  const halfDepth = (cellDepth / 2) * RACK_MARGIN_FACTOR;
  const centerZ = subSlotIndex * cellDepth;
  const transform = slotTransform(slot);
  return boxFromLocalCorners(
    transform,
    [-halfWidth, halfWidth],
    [0, pallets * LEVEL_HEIGHT + SLOT_HEIGHT],
    [centerZ - halfDepth, centerZ + halfDepth],
  );
}

/** The whole loaded site (plant level) — all walls' extent, at floor level. */
export function plantWorldBox(warehouse: Warehouse): THREE.Box3 {
  const bounds = computeBounds(warehouse);
  const box = new THREE.Box3();
  for (const [x, y] of [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY],
  ] as const) {
    const [sx, sz] = toSceneXZ(x, y);
    box.expandByPoint(new THREE.Vector3(sx, 0, sz));
  }
  return box;
}

/** One building (a closed wall loop), from floor to wall height. */
export function buildingWorldBox(loop: WallLoop, wallHeight: number): THREE.Box3 {
  const box = new THREE.Box3();
  for (const p of loop.points) {
    const [sx, sz] = toSceneXZ(p.x, p.y);
    box.expandByPoint(new THREE.Vector3(sx, 0, sz));
    box.expandByPoint(new THREE.Vector3(sx, wallHeight, sz));
  }
  return box;
}

export interface FramedView {
  position: [number, number, number];
  target: [number, number, number];
}

// Camera offset ratios, applied to a box's own (padded) span, relative to
// its own center — not fixed world-space angles — so the same two shots
// work identically regardless of the box's size or floor height:
//   "top": plant/warehouse — nearly straight down, matching a site plan.
//   "iso": slot/slot-space/pallet — a fixed above-and-to-the-side 3/4 view.
// A box's own direction (never the camera's current one) drives the shot,
// so clicking into an element always arrives from the same angle — see the
// "camera angle should always be the same when clicking an element" request.
// x stays 0 (not diagonal like ISO_RATIO) so the grid/walls read axis-aligned
// on screen — a true plan view, not a diamond-rotated iso shot; z is only
// just enough to keep the look direction well-defined at near-vertical pitch.
const TOP_DOWN_RATIO = { x: 0, y: 1.3, z: 0.2 };
const ISO_RATIO = { x: 0.6, y: 0.9, z: 0.8 };
const FRAME_PADDING = 1.6;
// A tighter margin than the iso shots' FRAME_PADDING — since the "top" fit
// below is now an exact aspect-aware solve (not a crude size-only guess), it
// doesn't need as much slack to guarantee nothing clips.
const TOP_FRAME_PADDING = 1.3;
// Must match the Canvas's own camera fov (WarehouseScene.tsx) — the "top"
// fit below needs the real vertical FOV to convert a world-space extent
// into the camera distance that makes it just reach the frustum's edge.
export const CAMERA_FOV_DEG = 45;

/**
 * Computes a fixed-angle camera shot ("top" or "iso") that frames `box`.
 *
 * "top" solves for the exact distance that makes the box's own footprint —
 * both its width (size.x) *and* its depth (size.z) — just reach the
 * frustum's edges, given the viewport's own aspect ratio. Fitting only
 * whichever single dimension happens to be largest (as "iso" below still
 * does — a deliberately cruder heuristic, fine for near-square slot/pallet
 * boxes) ignores the viewport's shape entirely: an elongated building
 * viewed in a viewport whose aspect ratio doesn't match its own left a lot
 * of empty floor on whichever axis wasn't the (arbitrary) one accounted
 * for — this was the "zoom level isn't good" feedback on the building-level
 * view. Solving for both axes and taking whichever is tighter means however
 * the box is shaped, and however wide the window is, it always fills the
 * frame the same way.
 */
export function frameBox(box: THREE.Box3, angle: "top" | "iso", aspect = 16 / 9): FramedView {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const ratio = angle === "top" ? TOP_DOWN_RATIO : ISO_RATIO;

  let span: number;
  if (angle === "top") {
    const cameraDistanceFactor = Math.hypot(ratio.x, ratio.y, ratio.z); // camera sits this many `span`s from the target
    const halfVFov = THREE.MathUtils.degToRad(CAMERA_FOV_DEG) / 2;
    const spanForDepth = ((size.z / 2) * TOP_FRAME_PADDING) / (cameraDistanceFactor * Math.tan(halfVFov));
    const spanForWidth = ((size.x / 2) * TOP_FRAME_PADDING) / (cameraDistanceFactor * Math.tan(halfVFov) * aspect);
    span = Math.max(spanForDepth, spanForWidth, 1);
  } else {
    span = Math.max(size.x, size.y, size.z, 1) * FRAME_PADDING;
  }

  return {
    position: [center.x + span * ratio.x, center.y + span * ratio.y, center.z + span * ratio.z],
    target: [center.x, center.y, center.z],
  };
}

/** One pallet's tier within its sub-slot's rack. */
export function palletWorldBox(
  slot: Slot,
  defaults: SlotSize,
  subSlotIndex: number,
  palletIndex: number,
): THREE.Box3 {
  const { cellDepth } = slotFootprint(slot, defaults);
  const halfWidth = (defaults.width / 2) * RACK_MARGIN_FACTOR;
  const halfDepth = (cellDepth / 2) * RACK_MARGIN_FACTOR;
  const centerZ = subSlotIndex * cellDepth;
  const transform = slotTransform(slot);
  return boxFromLocalCorners(
    transform,
    [-halfWidth, halfWidth],
    [palletIndex * LEVEL_HEIGHT, (palletIndex + 1) * LEVEL_HEIGHT],
    [centerZ - halfDepth, centerZ + halfDepth],
  );
}
