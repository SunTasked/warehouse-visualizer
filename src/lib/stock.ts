import type { SlotDefaults, SubSlotContent } from "../types/warehouse";

/**
 * How much a slot holds (specs.md §5.1): each of its depth positions stacks
 * pallets up to the plan's `slotDefaults.levels`, so a slot's capacity is
 * depth × levels. Shared by everything that puts pallets into a slot — the
 * editor's "+ Pallet", a simulated store, a stock extract being loaded — so
 * none of them fills a slot past what the others think it holds.
 */

/** Pallet tiers per depth position when a plan doesn't say: what the CML importer has always assumed. */
export const DEFAULT_LEVELS = 3;

/** Items on a full pallet — the content schema's cap. */
export const PALLET_FULL_ITEMS = 10;

export function levelsOf(defaults: Pick<SlotDefaults, "levels">): number {
  return defaults.levels && defaults.levels >= 1 ? Math.floor(defaults.levels) : DEFAULT_LEVELS;
}

/**
 * Which sub-slot the next pallet goes to: among those with room, the one with
 * the fewest pallets, ties toward the deepest — so a slot fills tier 1 of
 * every position back to front before starting tier 2. -1 when it is full.
 */
export function storeTarget(subSlots: { pallets: unknown[] }[], levels: number): number {
  let target = -1;
  let fewest = Infinity;
  subSlots.forEach((subSlot, i) => {
    const count = subSlot.pallets.length;
    if (count < levels && count <= fewest) {
      fewest = count;
      target = i; // later (deeper) indices win ties
    }
  });
  return target;
}

/** A slot's sub-slots holding `count` full pallets, stacked by storeTarget — for stock known only as a count per slot. Stops at capacity. */
export function stackFullPallets(slotId: string, depth: number, count: number, levels: number): SubSlotContent[] {
  const subSlots: SubSlotContent[] = Array.from({ length: depth }, () => ({ pallets: [] }));
  for (let n = 0; n < count; n++) {
    const target = storeTarget(subSlots, levels);
    if (target === -1) break;
    const pallets = subSlots[target].pallets;
    const id = `${slotId}.${target + 1}-P${pallets.length + 1}`;
    pallets.push({ id, items: Array.from({ length: PALLET_FULL_ITEMS }, (_, i) => ({ id: `${id}-I${i + 1}` })) });
  }
  return subSlots;
}
