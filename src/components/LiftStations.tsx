import { Text } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { LiftStation } from "../types/warehouse";
import { useViewFocus } from "../state/ViewFocusContext";
import { isBuildingVisible } from "../lib/visibility";

// Fixed footprint for now, not a schema field ("let's use the 6x2 dimensions
// for now") — exported in case other code (camera framing, etc.) needs it.
export const LIFT_STATION_WIDTH = 6;
export const LIFT_STATION_DEPTH = 2;
const LIFT_STATION_HEIGHT = 0.06;
const LIFT_STATION_COLOR = "#7c3aed";
const LIFT_STATION_EDGE_COLOR = "#000000";

function LiftStationMesh({ station }: { station: LiftStation }) {
  const geometry = useMemo(
    () => new THREE.BoxGeometry(LIFT_STATION_WIDTH, LIFT_STATION_HEIGHT, LIFT_STATION_DEPTH),
    [],
  );
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);
  const rotationRad = THREE.MathUtils.degToRad(station.rotationDeg ?? 0);

  return (
    <group position={[station.x, 0, -station.y]} rotation={[0, rotationRad, 0]}>
      <mesh geometry={geometry} position={[0, LIFT_STATION_HEIGHT / 2, 0]} raycast={() => null}>
        <meshStandardMaterial color={LIFT_STATION_COLOR} />
      </mesh>
      {/* Decorative outline, same raycast opt-out as Slots.tsx's edge outline
          (see that file's comment on the Three.js line-raycast threshold gotcha). */}
      <lineSegments geometry={edges} position={[0, LIFT_STATION_HEIGHT / 2, 0]} raycast={() => null}>
        <lineBasicMaterial color={LIFT_STATION_EDGE_COLOR} />
      </lineSegments>
      <Text
        position={[0, LIFT_STATION_HEIGHT + 0.05, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.5}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
      >
        {station.id}
      </Text>
    </group>
  );
}

export function LiftStations({ stations }: { stations: LiftStation[] }) {
  const { focus } = useViewFocus();
  return (
    <group>
      {stations.map((station) => {
        if (!isBuildingVisible(focus, station.buildingId)) return null;
        return <LiftStationMesh key={station.id} station={station} />;
      })}
    </group>
  );
}
