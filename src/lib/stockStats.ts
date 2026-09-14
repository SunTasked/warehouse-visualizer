import type { Slot, Warehouse } from "../types/warehouse";
import { findBuildingForSlot, listBuildings } from "./buildings";
import { PALLET_FULL_ITEMS, levelsOf } from "./stock";

/** What a set of slots holds against what it can (the Statistics tab, specs.md §5.6). */
export interface StockFigures {
  slots: number;
  /** Depth positions across those slots. */
  positions: number;
  /** Pallets they can hold: each slot's depth × the plan's levels. */
  capacity: number;
  pallets: number;
  /** Pallets carrying fewer items than a full one. */
  incompletePallets: number;
  items: number;
  emptySlots: number;
  /** Slots with no room for another pallet. */
  fullSlots: number;
  /** Slots holding more than their capacity — only hand-written content can. */
  overfilledSlots: number;
}

export interface BuildingStock extends StockFigures {
  id: string;
}

export interface StockStatistics {
  levels: number;
  plant: StockFigures;
  /** One per building (closed wall loop), in the plan's order. */
  buildings: BuildingStock[];
}

const noStock = (): StockFigures => ({
  slots: 0,
  positions: 0,
  capacity: 0,
  pallets: 0,
  incompletePallets: 0,
  items: 0,
  emptySlots: 0,
  fullSlots: 0,
  overfilledSlots: 0,
});

function addSlot(figures: StockFigures, slot: Slot, levels: number): void {
  const depth = slot.subSlots?.length ?? 1;
  const capacity = depth * levels;
  let pallets = 0;
  for (const subSlot of slot.subSlots ?? []) {
    for (const pallet of subSlot.pallets) {
      pallets += 1;
      figures.items += pallet.items.length;
      if (pallet.items.length < PALLET_FULL_ITEMS) figures.incompletePallets += 1;
    }
  }
  figures.slots += 1;
  figures.positions += depth;
  figures.capacity += capacity;
  figures.pallets += pallets;
  if (pallets === 0) figures.emptySlots += 1;
  if (pallets >= capacity) figures.fullSlots += 1;
  if (pallets > capacity) figures.overfilledSlots += 1;
}

/** The stock on screen, for the whole plant and per building. A slot standing in no building counts towards the plant only. */
export function stockStatistics(warehouse: Warehouse): StockStatistics {
  const levels = levelsOf(warehouse.slotDefaults);
  const plant = noStock();
  const buildings: BuildingStock[] = listBuildings(warehouse.walls).map((building) => ({ id: building.id, ...noStock() }));
  const byId = new Map(buildings.map((building) => [building.id, building]));
  for (const slot of warehouse.slots) {
    addSlot(plant, slot, levels);
    const buildingId = findBuildingForSlot(slot, warehouse.walls);
    const building = buildingId === undefined ? undefined : byId.get(buildingId);
    if (building) addSlot(building, slot, levels);
  }
  return { levels, plant, buildings };
}

/** part / whole, and 0 when there is no whole. */
export const share = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);
