import { useEditor } from "../state/EditorContext";
import { useViewFocus } from "../state/ViewFocusContext";
import { listBuildings } from "../lib/buildings";
import type { FocusLevel } from "../state/ViewFocusContext";

interface Crumb {
  level: FocusLevel;
  label: string;
  value: string;
  onClick: () => void;
}

/**
 * Left-side widget always showing the current view-mode drill-down path
 * (e.g. "Warehouse: Batiment 13A / Slot: A02") — each crumb before the
 * current (deepest) one is clickable to jump straight back to that level,
 * not just step back one at a time. See src/state/ViewFocusContext.tsx.
 */
export function FocusBreadcrumb() {
  const { mode, warehouse } = useEditor();
  const { focus, reset, focusWarehouse, focusSlot, focusSlotSpace } = useViewFocus();
  if (mode !== "view") return null;

  const buildings = listBuildings(warehouse.walls, warehouse.name);
  const slot = focus.slotId ? warehouse.slots.find((s) => s.id === focus.slotId) : undefined;
  const subSlot = slot && focus.subSlotIndex !== undefined ? slot.subSlots?.[focus.subSlotIndex] : undefined;
  const pallet = subSlot && focus.palletIndex !== undefined ? subSlot.pallets[focus.palletIndex] : undefined;

  const crumbs: Crumb[] = [{ level: "plant", label: "Plant", value: warehouse.name, onClick: reset }];

  if (focus.buildingId) {
    const building = buildings.find((b) => b.id === focus.buildingId);
    crumbs.push({
      level: "warehouse",
      label: "Warehouse",
      value: building?.label ?? focus.buildingId,
      onClick: () => focusWarehouse(focus.buildingId!),
    });
  }
  if (focus.slotId) {
    crumbs.push({
      level: "slot",
      label: "Slot",
      value: focus.slotId,
      onClick: () => focusSlot(focus.slotId!, focus.buildingId),
    });
  }
  if (subSlot) {
    crumbs.push({
      level: "slot-space",
      label: "Slot-space",
      value: subSlot.id,
      onClick: () => focusSlotSpace(focus.slotId!, focus.subSlotIndex!, focus.buildingId),
    });
  }
  if (pallet) {
    crumbs.push({ level: "pallet", label: "Pallet", value: pallet.id, onClick: () => {} });
  }

  return (
    <div className="focus-breadcrumb">
      {crumbs.map((crumb) => {
        const isCurrent = crumb.level === focus.level;
        return (
          <div
            key={crumb.level}
            className={
              isCurrent ? "focus-breadcrumb__crumb focus-breadcrumb__crumb--current" : "focus-breadcrumb__crumb"
            }
            onClick={isCurrent ? undefined : crumb.onClick}
            role={isCurrent ? undefined : "button"}
          >
            <span className="focus-breadcrumb__level">{crumb.label}</span>
            <span className="focus-breadcrumb__value">{crumb.value}</span>
          </div>
        );
      })}
    </div>
  );
}
