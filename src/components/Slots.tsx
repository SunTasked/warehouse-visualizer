import { Text } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useMemo } from "react";
import type { Slot, SlotSize } from "../types/warehouse";
import { useEditor } from "../state/EditorContext";
import { fromSceneXZ } from "../lib/geometry";
import { Rack } from "./Rack";

const SLOT_HEIGHT = 0.06;
const SLOT_COLOR = "#4d7cfe";
const SLOT_SELECTED_COLOR = "#ff8c42";
const SLOT_EDGE_COLOR = "#1f3a93";
const DIVIDER_COLOR = "#1f3a93";

// Draws the boundary between two adjacent sub-slots (depth subdivision),
// running across the slot's width at local Z = z.
function DepthDivider({ z, width }: { z: number; width: number }) {
  const geometry = useMemo(() => new THREE.BoxGeometry(width * 0.96, 0.01, 0.03), [width]);
  return (
    <mesh geometry={geometry} position={[0, SLOT_HEIGHT / 2 + 0.005, z]}>
      <meshStandardMaterial color={DIVIDER_COLOR} />
    </mesh>
  );
}

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
  const depth = slot.subSlots?.length ?? 1;
  const cellDepth = defaults.height / depth;

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
      {depth > 1 &&
        Array.from({ length: depth - 1 }).map((_, i) => (
          <DepthDivider key={i} z={-defaults.height / 2 + cellDepth * (i + 1)} width={defaults.width} />
        ))}
      {slot.subSlots?.map((subSlot, i) => {
        if (subSlot.pallets.length === 0) return null;
        const z = -defaults.height / 2 + cellDepth * (i + 0.5);
        return (
          <group key={subSlot.id} position={[0, SLOT_HEIGHT / 2, z]}>
            <Rack cellWidth={defaults.width} cellDepth={cellDepth} pallets={subSlot.pallets} />
          </group>
        );
      })}
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
