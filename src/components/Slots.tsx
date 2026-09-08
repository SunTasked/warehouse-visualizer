import { Text } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useMemo } from "react";
import type { Slot, SlotSize } from "../types/warehouse";
import { useEditor } from "../state/EditorContext";
import { fromSceneXZ } from "../lib/geometry";

const SLOT_HEIGHT = 0.06;
const SLOT_COLOR = "#4d7cfe";
const SLOT_SELECTED_COLOR = "#ff8c42";
const SLOT_EDGE_COLOR = "#1f3a93";

function SlotMesh({ slot, defaults }: { slot: Slot; defaults: SlotSize }) {
  const {
    mode,
    addSlotMode,
    warehouse,
    selectedSlotIds,
    toggleSlotSelection,
    selectOnly,
    dragRef,
    orbitRef,
  } = useEditor();
  const selected = selectedSlotIds.has(slot.id);
  const rotationRad = THREE.MathUtils.degToRad(slot.rotationDeg ?? 0);
  const geometry = useMemo(
    () => new THREE.BoxGeometry(defaults.width, SLOT_HEIGHT, defaults.height),
    [defaults.width, defaults.height],
  );
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (mode !== "edit" || addSlotMode) return; // let the event fall through to the drag plane
    if (e.nativeEvent.button !== 0) return; // right button is for box-select
    e.stopPropagation();

    const additive = e.nativeEvent.ctrlKey || e.nativeEvent.metaKey;
    if (additive) {
      toggleSlotSelection(slot.id);
      return; // Ctrl+click only builds the selection, it doesn't start a drag
    }

    // Dragging a slot that's already part of a multi-selection moves the
    // whole group; otherwise this click selects just this one slot.
    const dragIds =
      selectedSlotIds.has(slot.id) && selectedSlotIds.size > 1 ? Array.from(selectedSlotIds) : [slot.id];
    if (dragIds.length === 1) selectOnly(slot.id);

    const anchor = fromSceneXZ(e.point.x, e.point.z);
    const origins: Record<string, { x: number; y: number }> = {};
    for (const id of dragIds) {
      const s = warehouse.slots.find((s) => s.id === id);
      if (s) origins[id] = { x: s.x, y: s.y };
    }
    const label = dragIds.length === 1 ? `Move slot ${dragIds[0]}` : `Move ${dragIds.length} slots`;
    dragRef.current = { type: "slots", ids: dragIds, anchor, origins, label, moved: false };
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
