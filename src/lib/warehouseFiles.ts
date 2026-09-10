import type {
  Slot,
  SlotConfig,
  SubSlot,
  Warehouse,
  WarehouseConfig,
  WarehouseContent,
} from "../types/warehouse";

/**
 * Combines a physical-layout config with its (optional) inventory content
 * into the merged runtime `Warehouse` shape the rest of the app renders and
 * edits. `content` may be null (e.g. the user skipped picking a content file)
 * — every slot then just renders its physically-configured depth, all empty.
 *
 * Content is padded up to the config's declared depth (missing positions
 * treated as empty) and never truncated, so a mismatch between the two files
 * never silently drops data.
 */
export function mergeWarehouse(config: WarehouseConfig, content: WarehouseContent | null): Warehouse {
  const contentBySlotId = new Map((content?.slots ?? []).map((s) => [s.slotId, s.subSlots]));

  const slots: Slot[] = config.slots.map((sc: SlotConfig) => {
    const depth = sc.depth ?? 1;
    const fromContent = contentBySlotId.get(sc.id);
    let subSlots: SubSlot[] | undefined;
    if (depth > 1 || fromContent) {
      const length = Math.max(depth, fromContent?.length ?? 0);
      subSlots = Array.from({ length }, (_, i) => ({
        id: `${sc.id}.${i + 1}`,
        pallets: fromContent?.[i]?.pallets ?? [],
      }));
    }
    return { id: sc.id, x: sc.x, y: sc.y, rotationDeg: sc.rotationDeg, subSlots };
  });

  return {
    id: config.id,
    name: config.name,
    units: config.units,
    walls: config.walls,
    doors: config.doors ?? [],
    paths: config.paths ?? [],
    liftStations: config.liftStations ?? [],
    slotDefaults: config.slotDefaults,
    slots,
  };
}

/**
 * Splits the merged runtime `Warehouse` back into its two files for saving:
 * config (physical layout — depth, not content) and content (only slots that
 * actually hold at least one pallet somewhere are included; fully-empty
 * slots don't need a content entry).
 */
export function splitWarehouse(warehouse: Warehouse): {
  config: WarehouseConfig;
  content: WarehouseContent;
} {
  const config: WarehouseConfig = {
    id: warehouse.id,
    name: warehouse.name,
    units: warehouse.units,
    walls: warehouse.walls,
    doors: warehouse.doors,
    paths: warehouse.paths,
    liftStations: warehouse.liftStations,
    slotDefaults: warehouse.slotDefaults,
    slots: warehouse.slots.map((s) => {
      const depth = s.subSlots?.length;
      const base: SlotConfig = { id: s.id, x: s.x, y: s.y };
      if (s.rotationDeg) base.rotationDeg = s.rotationDeg;
      if (depth && depth > 1) base.depth = depth;
      return base;
    }),
  };

  const content: WarehouseContent = {
    warehouseId: warehouse.id,
    slots: warehouse.slots
      .filter((s) => s.subSlots?.some((ss) => ss.pallets.length > 0))
      .map((s) => ({
        slotId: s.id,
        subSlots: s.subSlots!.map((ss) => ({ pallets: ss.pallets })),
      })),
  };

  return { config, content };
}
