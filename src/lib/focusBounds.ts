import * as THREE from "three";
import type { Slot, SlotSize, WallLoop } from "../types/warehouse";
import { slotFootprint, toSceneXZ } from "./geometry";
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
