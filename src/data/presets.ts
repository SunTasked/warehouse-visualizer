import type { Warehouse, WarehouseConfig, WarehouseContent } from "../types/warehouse";
import type { PickingList, PickingListsFile } from "../types/simulation";
import { mergeWarehouse } from "../lib/warehouseFiles";

/**
 * Plants shipped with the app, loadable from the Overview menu without going
 * through a file picker (specs.md §5.6). A preset is the same three files a
 * plant is always made of — plan, content, picking lists — just bundled.
 *
 * Each preset imports its files lazily, so a large plant only reaches the
 * browser when someone actually opens it.
 */
export interface LoadedPreset {
  warehouse: Warehouse;
  pickingLists: PickingList[];
}

export interface WarehousePreset {
  /** The id the loaded warehouse carries — how the menu tells which preset is on screen. Must be unique across presets: the scene remounts (and reframes its camera) on an id change, so two presets sharing one would keep the previous building's framing. */
  warehouseId: string;
  label: string;
  description: string;
  load: () => Promise<LoadedPreset>;
}

type JsonModule = Promise<{ default: unknown }>;

async function assemble(plan: JsonModule, content: JsonModule, lists: JsonModule): Promise<LoadedPreset> {
  const [p, c, l] = await Promise.all([plan, content, lists]);
  return {
    warehouse: mergeWarehouse(p.default as WarehouseConfig, c.default as WarehouseContent),
    pickingLists: (l.default as PickingListsFile).lists,
  };
}

export const WAREHOUSE_PRESETS: WarehousePreset[] = [
  {
    warehouseId: "bat-13a",
    label: "Test plant",
    description: "Small demo plant: two buildings, 21 slots, 5 picking lists",
    load: () =>
      assemble(
        import("../../schema/warehouse.example.json"),
        import("../../schema/warehouse.content.example.json"),
        import("../../schema/warehouse.picking-lists.example.json"),
      ),
  },
  {
    warehouseId: "cml",
    label: "CML",
    description: "Buildings 13A, 12B, 08C, 07D and 06F from the plant plan: 3,200 locations, 11 picking lists",
    load: () =>
      assemble(
        import("../../schema/CML.plan.json"),
        import("../../schema/CML.content.json"),
        import("../../schema/CML.picking-lists.json"),
      ),
  },
];
