import { useEditor } from "../state/EditorContext";
import { useViewFocus } from "../state/ViewFocusContext";
import { useSimulation } from "../state/SimulationContext";
import { levelsOf } from "../lib/stock";

/** Small HTML tooltip shown in view mode while hovering a slot (browsing at
 * plant/warehouse level — no card once a specific slot is already focused). */
export function HoverCard() {
  const { warehouse } = useEditor();
  const { hover, focus } = useViewFocus();
  const { planner } = useSimulation();
  if (!hover || (focus.level !== "plant" && focus.level !== "warehouse")) return null;

  const slot = warehouse.slots.find((s) => s.id === hover.slotId);
  if (!slot) return null;
  const join = planner.joinOf({ kind: "slot", id: slot.id });

  const subSlots = slot.subSlots ?? [];
  const depth = subSlots.length || 1;
  const levels = levelsOf(warehouse.slotDefaults);
  // Tallest sub-slot's pallet-tier count — the informal "height" convention
  // (e.g. "depth 3, height 2") already used in the generator script's
  // comments and specs.md — against the stack height the plan allows.
  const height = Math.max(0, ...subSlots.map((ss) => ss.pallets.length));
  const stocked = subSlots.filter((ss) => ss.pallets.length > 0).length;
  const palletCount = subSlots.reduce((sum, ss) => sum + ss.pallets.length, 0);
  const itemCount = subSlots.reduce(
    (sum, ss) => sum + ss.pallets.reduce((s, p) => s + p.items.length, 0),
    0,
  );

  return (
    <div className="hover-card" style={{ left: hover.x + 16, top: hover.y + 16 }}>
      <div className="hover-card__title">{slot.id}</div>
      <div className="hover-card__row">
        <span>Position</span>
        <span>
          {slot.x}m, {slot.y}m
        </span>
      </div>
      {join?.place && (
        <div className="hover-card__row" title={join.explicit ? "As the plan states it" : "Not in the plan: the nearest corridor in front"}>
          <span>Aisle</span>
          <span>
            {join.place.corridor} · {join.place.offset.toFixed(1)} m{join.explicit ? "" : " (nearest)"}
          </span>
        </div>
      )}
      <div className="hover-card__row">
        <span>Depth</span>
        <span>{depth}</span>
      </div>
      <div className="hover-card__row">
        <span>Height</span>
        <span>
          {height} of {levels} levels
        </span>
      </div>
      <div className="hover-card__row">
        <span>Stocked</span>
        <span>
          {stocked}/{depth} sub-slots
        </span>
      </div>
      <div className="hover-card__row" title="Pallets against the slot's capacity (depth × levels), and the items on them">
        <span>Pallets · items</span>
        <span>
          {palletCount}/{depth * levels} · {itemCount}
        </span>
      </div>
      <div className="hover-card__hint">Click to zoom in</div>
    </div>
  );
}
