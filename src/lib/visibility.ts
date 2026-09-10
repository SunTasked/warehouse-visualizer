import type { Focus } from "../state/ViewFocusContext";

/**
 * View-mode drill-down visibility: once a level has been drilled into,
 * every *sibling* at that level is hidden entirely (not rendered) — only
 * the selected path (its ancestors and descendants) stays visible. Replaces
 * the previous dim/gray-blend approach: "hidden" now really means hidden,
 * so a hidden slot/building/pallet also stops being hoverable or clickable
 * for free, since it's simply not in the scene graph.
 */

export function isBuildingVisible(focus: Focus, buildingId: string): boolean {
  if (focus.level === "plant") return true;
  return focus.buildingId === buildingId;
}

export function isSlotVisible(focus: Focus, slotId: string, buildingId: string | undefined): boolean {
  if (!isBuildingVisible(focus, buildingId ?? "")) return false;
  if (focus.level === "plant" || focus.level === "warehouse") return true;
  return focus.slotId === slotId;
}

export function isSlotSpaceVisible(focus: Focus, slotId: string, subSlotIndex: number): boolean {
  if (focus.level === "plant" || focus.level === "warehouse") return true;
  if (focus.slotId !== slotId) return false;
  if (focus.level === "slot") return true;
  return focus.subSlotIndex === subSlotIndex;
}

export function isPalletVisible(
  focus: Focus,
  slotId: string,
  subSlotIndex: number,
  palletIndex: number,
): boolean {
  if (focus.level === "plant" || focus.level === "warehouse") return true;
  if (focus.slotId !== slotId) return false;
  if (focus.level === "slot") return true;
  if (focus.subSlotIndex !== subSlotIndex) return false;
  if (focus.level === "slot-space") return true;
  return focus.palletIndex === palletIndex;
}
