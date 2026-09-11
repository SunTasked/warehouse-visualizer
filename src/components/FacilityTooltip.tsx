import { useViewFocus } from "../state/ViewFocusContext";

/** Small HTML tooltip shown while hovering a lift station or delivery space
 * pad (see FacilityPad.tsx) — mirrors HoverCard.tsx's positioning/styling. */
export function FacilityTooltip() {
  const { hover } = useViewFocus();
  if (!hover?.facility) return null;

  return (
    <div className="hover-card" style={{ left: hover.x + 16, top: hover.y + 16 }}>
      <div className="hover-card__title">{hover.facility.id}</div>
      <div className="hover-card__row">
        <span>{hover.facility.description}</span>
      </div>
    </div>
  );
}
