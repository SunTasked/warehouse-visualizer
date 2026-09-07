import { Text } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useMemo } from "react";
import type { Slot, SlotSize } from "../types/warehouse";
import { useEditor } from "../state/EditorContext";

const SLOT_HEIGHT = 0.06;
const SLOT_COLOR = "#4d7cfe";
const SLOT_SELECTED_COLOR = "#ff8c42";
const SLOT_EDGE_COLOR = "#1f3a93";

function SlotMesh({ slot, defaults }: { slot: Slot; defaults: SlotSize }) {
  const { mode, addSlotMode, selectedSlotId, setSelectedSlotId, dragRef, orbitRef, beginChange } = useEditor();
  const selected = selectedSlotId === slot.id;
  const rotationRad = THREE.MathUtils.degToRad(slot.rotationDeg ?? 0);
  const geometry = useMemo(
    () => new THREE.BoxGeometry(defaults.width, SLOT_HEIGHT, defaults.height),
    [defaults.width, defaults.height],
  );
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (mode !== "edit" || addSlotMode) return; // let the event fall through to the drag plane
    e.stopPropagation();
    setSelectedSlotId(slot.id);
    beginChange();
    dragRef.current = { type: "slot", slotId: slot.id };
    if (orbitRef.current) orbitRef.current.enabled = false;
  };

  return (
    <group
      position={[slot.x, SLOT_HEIGHT / 2, -slot.y]}
      rotation={[0, rotationRad, 0]}
      onPointerDown={handlePointerDown}
    >
      <mesh geometry={geometry}>
        <meshStandardMaterial color={selected ? SLOT_SELECTED_COLOR : SLOT_COLOR} />
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
