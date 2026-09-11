import type { LiftStation } from "../types/warehouse";
import { useViewFocus } from "../state/ViewFocusContext";
import { isBuildingVisible } from "../lib/visibility";
import { FacilityPad } from "./FacilityPad";

// Fixed footprint for now, not a schema field ("let's use the 6x2 dimensions
// for now") — exported in case other code (camera framing, etc.) needs it.
export const LIFT_STATION_WIDTH = 6;
export const LIFT_STATION_DEPTH = 2;
const LIFT_STATION_HEIGHT = 0.06;
const LIFT_STATION_COLOR = "#7c3aed";
const LIFT_STATION_DESCRIPTION = "Carriage lift station";

export function LiftStations({ stations }: { stations: LiftStation[] }) {
  const { focus } = useViewFocus();
  return (
    <group>
      {stations.map((station) => {
        if (!isBuildingVisible(focus, station.buildingId)) return null;
        return (
          <FacilityPad
            key={station.id}
            x={station.x}
            y={station.y}
            rotationDeg={station.rotationDeg}
            width={LIFT_STATION_WIDTH}
            depth={LIFT_STATION_DEPTH}
            height={LIFT_STATION_HEIGHT}
            color={LIFT_STATION_COLOR}
            label={station.id}
            buildingId={station.buildingId}
            description={LIFT_STATION_DESCRIPTION}
          />
        );
      })}
    </group>
  );
}
