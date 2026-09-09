// Mirrors schema/warehouse.schema.json — the physical asset layer (walls + slots).
// See specs.md §5.1 for the format's rationale and conventions.

export interface Point {
  x: number;
  y: number;
}

export interface WallLoop {
  id: string;
  closed: boolean;
  points: Point[];
}

export interface SlotSize {
  width: number;
  height: number;
}

/**
 * Storage hierarchy within a slot (see specs.md §5.1 "Storage subdivision"):
 *   Slot → Sub-slot → Pallet → Item
 * - Sub-slot: one of a slot's `depth` positions, each occupying a *full*
 *   slotDefaults-sized footprint of its own (a depth-3 slot spans 3x the
 *   standard footprint, front-to-back — not the standard footprint split
 *   three ways).
 * - Pallet: a unit load; multiple pallets stack vertically within one
 *   sub-slot (rack tiers/levels).
 * - Item: an individual unit stored on a pallet (e.g. a tire, currently
 *   always rendered at a fixed "tourism" size regardless of count), 1-10 per
 *   pallet.
 */
export interface Item {
  id: string;
}

export interface Pallet {
  id: string;
  /** 1-10 items. */
  items: Item[];
}

export interface SubSlot {
  id: string;
  /** Stacked bottom-to-top; pallets[0] is the lowest tier. */
  pallets: Pallet[];
}

export interface Slot {
  id: string;
  /**
   * Center point when depth is 1 (no subSlots, or a single sub-slot). With
   * depth > 1, (x, y) instead anchors subSlots[0]'s footprint specifically —
   * additional sub-slots extend the footprint outward from there, so a
   * slot's depth-1 corner never moves as its depth changes.
   */
  x: number;
  y: number;
  /** Counter-clockwise rotation around the center point, in degrees. Default 0. */
  rotationDeg?: number;
  /**
   * Depth subdivision of the slot's footprint (front-to-back), each entry a
   * sub-slot occupying its own full slotDefaults footprint. Depth =
   * subSlots.length. Omitted/empty = depth 1, no storage detail authored yet.
   */
  subSlots?: SubSlot[];
}

export interface Warehouse {
  id: string;
  name: string;
  units: "m";
  walls: WallLoop[];
  slotDefaults: SlotSize;
  slots: Slot[];
}
