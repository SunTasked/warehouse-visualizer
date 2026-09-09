import { useEditor } from "../state/EditorContext";
import { useViewFocus } from "../state/ViewFocusContext";

/** Small HTML tooltip shown in view mode while hovering a slot (no card mid-drill-down). */
export function HoverCard() {
  const { warehouse } = useEditor();
  const { hover, focus } = useViewFocus();
  if (!hover || focus.level !== "overview") return null;

  const slot = warehouse.slots.find((s) => s.id === hover.slotId);
  if (!slot) return null;

  const subSlots = slot.subSlots ?? [];
  const depth = subSlots.length || 1;
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
      <div className="hover-card__row">
        <span>Depth</span>
        <span>{depth}</span>
      </div>
      <div className="hover-card__row">
        <span>Stocked</span>
        <span>
          {stocked}/{depth} sub-slots
        </span>
      </div>
      <div className="hover-card__row">
        <span>Pallets · items</span>
        <span>
          {palletCount} · {itemCount}
        </span>
      </div>
      <div className="hover-card__hint">Click to zoom in</div>
    </div>
  );
}
