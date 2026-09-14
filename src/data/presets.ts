import type { Warehouse, WarehouseConfig, WarehouseContent } from "../types/warehouse";
import type { PickingList, PickingListsFile } from "../types/simulation";
import { mergeWarehouse } from "../lib/warehouseFiles";
import { parseStockExtract, stockFromExtract } from "../lib/stockExtract";

/**
 * Plants shipped with the app, loadable from the Overview menu without going
 * through a file picker (specs.md §5.6). A preset is the same three files a
 * plant is always made of — plan, content, picking lists — just bundled. Its
 * content is either content JSON or, like CML's, the stock extract the
 * plant's WMS produces (src/lib/stockExtract.ts).
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

/** A preset's stock, read against its plan: an extract needs the plan to tell which slot each location is, and how much it holds. */
type ContentSource = (config: WarehouseConfig) => Promise<WarehouseContent>;

const contentJson =
  (module: JsonModule): ContentSource =>
  async () =>
    (await module).default as WarehouseContent;

/** One warehouse's rows of a stock extract, as full pallets in the plan's slots. */
const contentExtract =
  (module: Promise<{ default: string }>, warehouseCode: string): ContentSource =>
  async (config) => {
    const { default: text } = await module;
    return stockFromExtract(parseStockExtract(text), mergeWarehouse(config, null), warehouseCode).content;
  };

async function assemble(plan: JsonModule, content: ContentSource, lists: JsonModule): Promise<LoadedPreset> {
  const [p, l] = await Promise.all([plan, lists]);
  const config = p.default as WarehouseConfig;
  return {
    warehouse: mergeWarehouse(config, await content(config)),
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
        contentJson(import("../../schema/warehouse.content.example.json")),
        import("../../schema/warehouse.picking-lists.example.json"),
      ),
  },
  {
    warehouseId: "cml",
    label: "CML",
    description: "Nine buildings from the plant plan, 13A to 16G: 4,910 locations stocked from the pallet extract, 16 picking lists",
    load: () =>
      assemble(
        import("../../schema/CML.plan.json"),
        contentExtract(import("../../schema/CML.stock.csv?raw"), "CML"),
        import("../../schema/CML.picking-lists.json"),
      ),
  },
];
