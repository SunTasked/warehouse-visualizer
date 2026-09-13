// Picking-list simulation types — deliberately separate from warehouse.ts:
// these describe a forklift's work orders rather than the building itself.
// They load from their own file, the third of a plant alongside its plan and
// content (schema/picking-lists.schema.json; specs.md §5.3 and §5.6).

export type StopKind = "slot" | "depot";

export interface PickingStop {
  kind: StopKind;
  /** A Slot id (kind "slot") or a LiftStation/DeliverySpace id (kind "depot"). */
  id: string;
}

export type PickingMode = "picking" | "storing";

/**
 * An ordered work order for the (single, for now) forklift. Reading direction
 * is the same regardless of mode — only what each stop *does* changes:
 * picking removes a real pallet from a slot stop and delivers everything
 * held at a depot stop; storing loads synthetic pallets at a depot stop and
 * places one at each slot stop. Capacity is a hard 3 — an authored list is
 * trusted to respect it (see src/state/SimulationContext.tsx).
 */
export interface PickingList {
  id: string;
  label: string;
  mode: PickingMode;
  stops: PickingStop[];
}

/** A plant's picking lists file. */
export interface PickingListsFile {
  /** The plan (warehouse config) id these orders were written for. */
  warehouseId: string;
  lists: PickingList[];
}
