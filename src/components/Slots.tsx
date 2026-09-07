import { Text } from "@react-three/drei";
import * as THREE from "three";
import { useMemo } from "react";
import type { Slot, SlotSize } from "../types/warehouse";

const SLOT_HEIGHT = 0.06;
const SLOT_COLOR = "#4d7cfe";
const SLOT_EDGE_COLOR = "#1f3a93";

function SlotMesh({ slot, defaults }: { slot: Slot; defaults: SlotSize }) {
  const rotationRad = THREE.MathUtils.degToRad(slot.rotationDeg ?? 0);
  const geometry = useMemo(
    () => new THREE.BoxGeometry(defaults.width, SLOT_HEIGHT, defaults.height),
    [defaults.width, defaults.height],
  );
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);

  return (
    <group position={[slot.x, SLOT_HEIGHT / 2, -slot.y]} rotation={[0, rotationRad, 0]}>
      <mesh geometry={geometry}>
        <meshStandardMaterial color={SLOT_COLOR} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={SLOT_EDGE_COLOR} />
      </lineSegments>
      <Text
        position={[0, SLOT_HEIGHT / 2 + 0.05, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.5}
        color="#0b1330"
        anchorX="center"
        anchorY="middle"
      >
        {slot.id}
      </Text>
    </group>
  );
}

export function Slots({ slots, defaults }: { slots: Slot[]; defaults: SlotSize }) {
  return (
    <group>
      {slots.map((slot) => (
        <SlotMesh key={slot.id} slot={slot} defaults={defaults} />
      ))}
    </group>
  );
}
