import { useMemo } from "react";
import * as THREE from "three";
import type { Door } from "../types/warehouse";
import { useViewFocus } from "../state/ViewFocusContext";
import { isBuildingVisible } from "../lib/visibility";

// Green, matching Slots.tsx's ENTRY_COLOR — same "access point" meaning, just
// at the building's wall rather than a slot's own pad.
const DOOR_COLOR = "#22c55e";
const DOOR_HEIGHT = 0.1;
const DOOR_THICKNESS = 0.5;
const DOOR_DEFAULT_WIDTH = 3;

function DoorMesh({ door }: { door: Door }) {
  const width = door.width ?? DOOR_DEFAULT_WIDTH;
  const geometry = useMemo(
    () => new THREE.BoxGeometry(width, DOOR_HEIGHT, DOOR_THICKNESS),
    [width],
  );
  const rotationRad = THREE.MathUtils.degToRad(door.rotationDeg ?? 0);

  return (
    // Purely a visual marker (like the slot entry marker) — opts out of
    // raycasting so clicking through it in view mode still falls through to
    // the "click empty floor -> back()" handler on the Canvas.
    <mesh
      geometry={geometry}
      position={[door.x, DOOR_HEIGHT / 2, -door.y]}
      rotation={[0, rotationRad, 0]}
      raycast={() => null}
    >
      <meshStandardMaterial color={DOOR_COLOR} />
    </mesh>
  );
}

export function Doors({ doors }: { doors: Door[] }) {
  const { focus } = useViewFocus();
  return (
    <group>
      {doors.map((door) => {
        if (!isBuildingVisible(focus, door.buildingId)) return null;
        return <DoorMesh key={door.id} door={door} />;
      })}
    </group>
  );
}
