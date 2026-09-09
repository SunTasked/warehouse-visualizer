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
// Bold/dark: the outer edge of a whole slot (drawn once per slot, around its
// full — possibly depth-extended — footprint). Pale/light: the boundary
// between two sub-slots *within* the same slot. The contrast is what reads as
// "these cells belong together, but that one over there is a different slot".
const SLOT_EDGE_COLOR = "#000000";
const DIVIDER_COLOR = "#b7c6ef";
// How far outside the slot's fixed entry edge (see cellDepth/footprintCenterZ
// below) the id label sits — the operator-access side, assumed to stay clear
// of any other slot's footprint.
const LABEL_OFFSET = 0.4;

// Draws the boundary between two adjacent sub-slots (depth subdivision),
// running across the slot's width at local Z = z.
function DepthDivider({ z, width }: { z: number; width: number }) {
  const geometry = useMemo(() => new THREE.BoxGeometry(width * 0.96, 0.01, 0.02), [width]);
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
  const depth = slot.subSlots?.length ?? 1;
  // Each sub-slot is a full slotDefaults footprint (not a fraction of one) —
  // a depth-3 slot occupies 3x the standard 4x2 space, not the same 4x2
  // split three ways. Sub-slot 0 always sits exactly where a depth-1 slot's
  // footprint would (local Z centered on 0, matching legacy geometry
  // unchanged); each further sub-slot i is appended at local Z = i * cellDepth,
  // so slot.x/y — the group's own position — stays anchored to sub-slot 0
  // regardless of depth, and added depth only extends the far side.
  const cellDepth = defaults.height;
  const totalDepth = cellDepth * depth;
  const footprintCenterZ = ((depth - 1) * cellDepth) / 2;
  const geometry = useMemo(
    () => new THREE.BoxGeometry(defaults.width, SLOT_HEIGHT, totalDepth),
    [defaults.width, totalDepth],
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
      <group position={[0, 0, footprintCenterZ]}>
        <mesh geometry={geometry}>
          <meshStandardMaterial color={selected ? SLOT_SELECTED_COLOR : SLOT_COLOR} />
        </mesh>
        <lineSegments geometry={edges}>
          <lineBasicMaterial color={SLOT_EDGE_COLOR} />
        </lineSegments>
      </group>
      <Text
        position={[0, SLOT_HEIGHT / 2 + 0.05, -cellDepth / 2 - LABEL_OFFSET]}
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
          <DepthDivider key={i} z={(i + 1) * cellDepth - cellDepth / 2} width={defaults.width} />
        ))}
      {slot.subSlots?.map((subSlot, i) => {
        if (subSlot.pallets.length === 0) return null;
        return (
          <group key={subSlot.id} position={[0, SLOT_HEIGHT / 2, i * cellDepth]}>
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
