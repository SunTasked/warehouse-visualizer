import { Text } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useMemo } from "react";
import type { Slot, SlotSize } from "../types/warehouse";
import { useEditor } from "../state/EditorContext";
import { useViewFocus } from "../state/ViewFocusContext";
import { fromSceneXZ, slotFootprint } from "../lib/geometry";
import { isSlotVisible, isSlotSpaceVisible } from "../lib/visibility";
import { findBuildingForSlot } from "../lib/buildings";
import { Rack } from "./Rack";

export const SLOT_HEIGHT = 0.06;
const SLOT_COLOR = "#4d7cfe";
const SLOT_SELECTED_COLOR = "#ff8c42";
// A lighter blend of SLOT_COLOR — "surbrillance" when the pointer hovers a
// slot in view mode, distinct from edit-mode's orange selection.
const SLOT_HOVER_COLOR = "#a9c2ff";
// Bold/dark: the outer edge of a whole slot (drawn once per slot, around its
// full — possibly depth-extended — footprint). Pale/light: the boundary
// between two sub-slots *within* the same slot. The contrast is what reads as
// "these cells belong together, but that one over there is a different slot".
const SLOT_EDGE_COLOR = "#000000";
const DIVIDER_COLOR = "#b7c6ef";
// The entry marker: a painted-looking strip on the slot's own floor surface,
// at its fixed entry edge — where an operator accesses the slot to load/
// unload. Green reads as "access point" and is distinct from every other
// color already in use (slot fill, black edge, pale divider, orange
// selection, hover highlight).
const ENTRY_COLOR = "#22c55e";
const ENTRY_MARKER_DEPTH = 0.25;
// Raised like a real painted threshold bar (taller than the slot pad itself)
// so it still reads clearly even where a rack's corner posts stand on it.
const ENTRY_MARKER_HEIGHT = 0.14;
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

// A painted strip on the pad surface at the slot's fixed entry edge —
// materializes where an operator accesses the slot, right on the slot
// itself (as opposed to the id label, which sits just outside it).
function EntryMarker({ cellDepth, width }: { cellDepth: number; width: number }) {
  const geometry = useMemo(
    () => new THREE.BoxGeometry(width * 0.96, ENTRY_MARKER_HEIGHT, ENTRY_MARKER_DEPTH),
    [width],
  );
  const z = -cellDepth / 2 + ENTRY_MARKER_DEPTH / 2;
  return (
    <mesh geometry={geometry} position={[0, SLOT_HEIGHT / 2 + ENTRY_MARKER_HEIGHT / 2, z]}>
      <meshStandardMaterial color={ENTRY_COLOR} />
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
  const { focus, hover, setHover, focusSlot, focusSlotSpace } = useViewFocus();
  const buildingId = useMemo(() => findBuildingForSlot(slot, warehouse.walls), [slot, warehouse.walls]);
  // Each sub-slot is a full slotDefaults footprint (not a fraction of one) —
  // a depth-3 slot occupies 3x the standard 4x2 space, not the same 4x2
  // split three ways. Sub-slot 0 always sits exactly where a depth-1 slot's
  // footprint would (local Z centered on 0, matching legacy geometry
  // unchanged); each further sub-slot i is appended at local Z = i * cellDepth,
  // so slot.x/y — the group's own position — stays anchored to sub-slot 0
  // regardless of depth, and added depth only extends the far side.
  const { depth, cellDepth, totalDepth, footprintCenterZ } = slotFootprint(slot, defaults);
  const geometry = useMemo(
    () => new THREE.BoxGeometry(defaults.width, SLOT_HEIGHT, totalDepth),
    [defaults.width, totalDepth],
  );
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);

  // All hooks above run unconditionally every render (rules of hooks) — the
  // visibility check itself is a plain early return, below them.
  if (mode === "view" && !isSlotVisible(focus, slot.id, buildingId)) return null;

  const selected = selectedSlotIds.has(slot.id);
  // Only a "pure" slot-level hover (no deeper target) lights up the pad —
  // hovering one of its sub-slot racks highlights that rack instead (see
  // the sub-slot group below / Rack.tsx), not the whole slot.
  const hovered = mode === "view" && hover?.slotId === slot.id && hover.subSlotIndex === undefined;
  const padColor = hovered ? SLOT_HOVER_COLOR : selected ? SLOT_SELECTED_COLOR : SLOT_COLOR;
  const rotationRad = THREE.MathUtils.degToRad(slot.rotationDeg ?? 0);

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    if (mode !== "view") return;
    setHover({ slotId: slot.id, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (mode !== "view") return;
    setHover({ slotId: slot.id, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
  };

  const handlePointerOut = () => {
    if (mode !== "view") return;
    setHover(null);
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (mode === "view") {
      if (e.nativeEvent.button !== 0) return;
      e.stopPropagation();
      focusSlot(slot.id, buildingId);
      return;
    }
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
      onPointerOver={handlePointerOver}
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
    >
      <group position={[0, 0, footprintCenterZ]}>
        <mesh geometry={geometry}>
          <meshStandardMaterial color={padColor} />
        </mesh>
        {/* Purely decorative — Three.js's default line-raycast threshold (1
            world unit) makes an un-opted-out LineSegments a near-universal
            click-blocker once zoomed in close (a whole focused slot may only
            be a few meters across), stealing clicks meant for the rack
            behind/above it. raycast={() => null} opts it out entirely. */}
        <lineSegments geometry={edges} raycast={() => null}>
          <lineBasicMaterial color={SLOT_EDGE_COLOR} />
        </lineSegments>
      </group>
      <EntryMarker cellDepth={cellDepth} width={defaults.width} />
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
        if (mode === "view" && !isSlotSpaceVisible(focus, slot.id, i)) return null;
        const handleSubSlotPointerDown = (e: ThreeEvent<PointerEvent>) => {
          // Reachable once this slot is focused at any drill-down level —
          // mirrors "select a slot space only if pallets are on it" (empty
          // sub-slots render no Rack at all, so there's nothing to click).
          if (mode !== "view" || focus.slotId !== slot.id) return;
          e.stopPropagation();
          focusSlotSpace(slot.id, i, buildingId);
        };
        // Hovering a sub-slot's rack highlights *it* (Rack.tsx) rather than
        // the whole slot pad — only meaningful while browsing this slot's
        // sub-slots (i.e. exactly at "slot" level for this slot).
        const handleSubSlotPointerOver = (e: ThreeEvent<PointerEvent>) => {
          if (mode !== "view" || focus.level !== "slot" || focus.slotId !== slot.id) return;
          e.stopPropagation();
          setHover({ slotId: slot.id, subSlotIndex: i, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
        };
        const handleSubSlotPointerOut = () => {
          if (mode !== "view" || focus.level !== "slot" || focus.slotId !== slot.id) return;
          setHover(null);
        };
        return (
          <group
            key={subSlot.id}
            position={[0, SLOT_HEIGHT / 2, i * cellDepth]}
            onPointerDown={handleSubSlotPointerDown}
            onPointerOver={handleSubSlotPointerOver}
            onPointerMove={handleSubSlotPointerOver}
            onPointerOut={handleSubSlotPointerOut}
          >
            <Rack
              slotId={slot.id}
              subSlotIndex={i}
              buildingId={buildingId}
              cellWidth={defaults.width}
              cellDepth={cellDepth}
              pallets={subSlot.pallets}
            />
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
