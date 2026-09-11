// Picking-list simulation types — deliberately separate from warehouse.ts:
// these are ephemeral test/demo constructs (a forklift's work order), never
// saved/loaded through the file system the way the physical layer is. See
// specs.md §5.3 "Warehouse management: forklift picking-list simulation".

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
