import type { DeliverySpace } from "../types/warehouse";
import { useViewFocus } from "../state/ViewFocusContext";
import { isBuildingVisible } from "../lib/visibility";
import { FacilityPad } from "./FacilityPad";

// Same footprint as LiftStation (src/components/LiftStations.tsx) — "same
// dimension as the lift station, for now" — but its own constants, since
// these are separate concepts that just happen to share a size today.
export const DELIVERY_SPACE_WIDTH = 6;
export const DELIVERY_SPACE_DEPTH = 2;
const DELIVERY_SPACE_HEIGHT = 0.06;
const DELIVERY_SPACE_COLOR = "#eab308";

export function DeliverySpaces({ spaces }: { spaces: DeliverySpace[] }) {
  const { focus } = useViewFocus();
  return (
    <group>
      {spaces.map((space) => {
        if (!isBuildingVisible(focus, space.buildingId)) return null;
        return (
          <FacilityPad
            key={space.id}
            x={space.x}
            y={space.y}
            rotationDeg={space.rotationDeg}
            width={DELIVERY_SPACE_WIDTH}
            depth={DELIVERY_SPACE_DEPTH}
            height={DELIVERY_SPACE_HEIGHT}
            color={DELIVERY_SPACE_COLOR}
            label={space.id}
            labelColor="#3f2d00"
          />
        );
      })}
    </group>
  );
}
