import type { Focus } from "../state/ViewFocusContext";

/**
 * View-mode drill-down visibility: once a level has been drilled into,
 * every *sibling* at that level is hidden entirely (not rendered) — only
 * the selected path (its ancestors and descendants) stays visible. Replaces
 * the previous dim/gray-blend approach: "hidden" now really means hidden,
 * so a hidden building/slot/sub-slot also stops being hoverable or
 * clickable for free, since it's simply not in the scene graph. Pallets are
 * the one exception to "sibling hidden" — see isPalletDetailed() below.
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

/**
 * Whether a pallet should render its actual content (a tire row) rather than
 * a simplified fill-rate-colored block — true only for the one pallet
 * that's actually the deepest focus target. Every *other* pallet within a
 * visible sub-slot still renders (as a block, see Rack.tsx) — unlike
 * buildings/slots/sub-slots, siblings here aren't hidden, just simplified,
 * so the rest of the sub-slot's stock stays visible for context while
 * inspecting one pallet closely.
 */
export function isPalletDetailed(
  focus: Focus,
  slotId: string,
  subSlotIndex: number,
  palletIndex: number,
): boolean {
  return (
    focus.level === "pallet" &&
    focus.slotId === slotId &&
    focus.subSlotIndex === subSlotIndex &&
    focus.palletIndex === palletIndex
  );
}
