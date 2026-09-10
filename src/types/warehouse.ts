// Mirrors schema/warehouse.schema.json (config) and
// schema/warehouse.content.schema.json (content) — the physical asset layer
// (walls + slots) is split from its storage content across two files that
// are loaded/saved separately and merged in memory. See specs.md §5.1 for
// the format's rationale and conventions, and src/lib/warehouseFiles.ts for
// the merge/split functions.

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
 *   three ways). Depth itself is config (a physical/structural property);
 *   which positions currently hold stock is content.
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

// ---------------------------------------------------------------------------
// Config: the physical layout file (walls, slot positions/footprints, and
// each slot's physical depth). Rarely changes — this is "the building".
// ---------------------------------------------------------------------------

export interface SlotConfig {
  id: string;
  /**
   * Center point when depth is 1. With depth > 1, (x, y) instead anchors the
   * frontmost (depth position 0) sub-slot's footprint specifically —
   * additional sub-slots extend the footprint outward from there, so a
   * slot's depth-1 corner never moves as its depth changes.
   */
  x: number;
  y: number;
  /** Counter-clockwise rotation around the center point, in degrees. Default 0. */
  rotationDeg?: number;
  /**
   * Number of sub-slot depth positions (front-to-back), each occupying its
   * own full slotDefaults footprint. Default 1 (no depth subdivision).
   */
  depth?: number;
}

export interface WarehouseConfig {
  id: string;
  name: string;
  units: "m";
  walls: WallLoop[];
  slotDefaults: SlotSize;
  slots: SlotConfig[];
}

// ---------------------------------------------------------------------------
// Content: the inventory file (what's actually stocked, per slot/sub-slot).
// Changes constantly — this is "what's on the shelves right now". A slot
// absent from `slots`, or a sub-slot with no pallets, is simply empty.
// ---------------------------------------------------------------------------

export interface SubSlotContent {
  /** Stacked bottom-to-top; pallets[0] is the lowest tier. */
  pallets: Pallet[];
}

export interface SlotContent {
  /** References a WarehouseConfig slot id. */
  slotId: string;
  /** One entry per depth position (see SlotConfig.depth), front-to-back. */
  subSlots: SubSlotContent[];
}

export interface WarehouseContent {
  /** References the WarehouseConfig this content belongs to (its id). */
  warehouseId: string;
  slots: SlotContent[];
}

// ---------------------------------------------------------------------------
// Runtime: the merged, in-memory shape everything else in the app (rendering,
// editing, the view-mode drill-down) works with — config and content combined
// via mergeWarehouse(), split back apart via splitWarehouse() on save. See
// src/lib/warehouseFiles.ts.
// ---------------------------------------------------------------------------

export interface SubSlot {
  id: string;
  /** Stacked bottom-to-top; pallets[0] is the lowest tier. */
  pallets: Pallet[];
}

export interface Slot {
  id: string;
  x: number;
  y: number;
  rotationDeg?: number;
  /**
   * Depth subdivision of the slot's footprint (front-to-back). Depth =
   * subSlots.length. Undefined = depth 1, no storage detail merged in.
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
