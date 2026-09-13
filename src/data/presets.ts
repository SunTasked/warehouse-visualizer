import type { Warehouse, WarehouseConfig, WarehouseContent } from "../types/warehouse";
import { mergeWarehouse } from "../lib/warehouseFiles";

/**
 * Warehouses shipped with the app, loadable from the Overview menu without
 * going through a file picker (specs.md §5.6).
 *
 * Each preset imports its files lazily, so a large plant only reaches the
 * browser when someone actually opens it.
 */
export interface WarehousePreset {
  /** The id the loaded warehouse carries — how the menu tells which preset is on screen. Must be unique across presets: the scene remounts (and reframes its camera) on an id change, so two presets sharing one would keep the previous building's framing. */
  warehouseId: string;
  label: string;
  description: string;
  load: () => Promise<Warehouse>;
}

export const WAREHOUSE_PRESETS: WarehousePreset[] = [
  {
    warehouseId: "bat-13a",
    label: "Test plant",
    description: "Small demo plant: two buildings, 21 slots",
    load: async () => {
      const [config, content] = await Promise.all([
        import("../../schema/warehouse.example.json"),
        import("../../schema/warehouse.content.example.json"),
      ]);
      return mergeWarehouse(
        config.default as unknown as WarehouseConfig,
        content.default as unknown as WarehouseContent,
      );
    },
  },
  {
    warehouseId: "cml",
    label: "CML",
    description: "Batiment 13A, imported from the plant plan: 453 locations",
    load: async () => {
      const [config, content] = await Promise.all([
        import("../../schema/CML.plan.json"),
        import("../../schema/CML.content.json"),
      ]);
      return mergeWarehouse(
        config.default as unknown as WarehouseConfig,
        content.default as unknown as WarehouseContent,
      );
    },
  },
];
