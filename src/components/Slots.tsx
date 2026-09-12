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
import { useLayers } from "../state/LayerContext";
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
// Deep enough to comfortably hold the id label on top of it (see below) —
// previously just a thin 0.25m threshold stripe. Extends inward from the
// slot's own entry edge, not outward past it: past the edge is the aisle,
// where a Path may now run (see specs.md §5.1) — routing every path clear of
// every slot keeps that side free for good, but a label sitting out there
// isn't just barely above a path's own low floor-level box height (~0.04m);
// from the fixed 3/4 camera angle used at every zoom level, that's enough
// for the path's silhouette to occlude a flat label at nearly the same
// elevation, the same way a low curb can hide something just behind it when
// viewed nearly edge-on. Sitting inward instead sidesteps that regardless of
// how close a path ever runs to a slot's edge.
const ENTRY_MARKER_DEPTH = 0.6;
// Raised like a real painted threshold bar (taller than the slot pad itself)
// so it still reads clearly even where a rack's corner posts stand on it.
const ENTRY_MARKER_HEIGHT = 0.14;
// Label clearance above the entry marker's own top surface.
const LABEL_CLEARANCE = 0.03;
const LABEL_COLOR = "#000000";

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

// Shared by EntryMarker and the id label (Text) below, so the label always
// sits centered on the marker regardless of ENTRY_MARKER_DEPTH.
function entryMarkerCenterZ(cellDepth: number): number {
  return -cellDepth / 2 + ENTRY_MARKER_DEPTH / 2;
}

// A painted strip on the pad surface at the slot's fixed entry edge —
// materializes where an operator accesses the slot, and doubles as the
// label's background (see the id Text below, positioned on top of it).
function EntryMarker({ cellDepth, width }: { cellDepth: number; width: number }) {
  const geometry = useMemo(
    () => new THREE.BoxGeometry(width * 0.96, ENTRY_MARKER_HEIGHT, ENTRY_MARKER_DEPTH),
    [width],
  );
  const z = entryMarkerCenterZ(cellDepth);
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
  // Racks and their pallets are their own layer — hiding them is what clears
  // the floor so the slot heatmap can be read on the slot pads themselves.
  const showPallets = useLayers().isVisible("pallets");
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
    // Without this, the event keeps propagating to whatever's beneath (at
    // "plant" level, the building floor click-catcher — see Walls.tsx's
    // BuildingFloor), whose own setHover(buildingId) call would immediately
    // overwrite this one since both fire within the same event dispatch.
    e.stopPropagation();
    setHover({ slotId: slot.id, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (mode !== "view") return;
    e.stopPropagation();
    setHover({ slotId: slot.id, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
  };

  const handlePointerOut = () => {
    if (mode !== "view") return;
    setHover(null);
  };

  // View-mode "select this slot" fires on onClick, not onPointerDown — see
  // handlePointerDown's comment below for why mixing the two event types
  // for competing handlers (this slot vs. the building floor beneath it)
  // caused a real bug: whichever fired later always won, regardless of which
  // object the raycast actually preferred.
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (mode !== "view" || e.nativeEvent.button !== 0) return;
    e.stopPropagation();
    focusSlot(slot.id, buildingId);
  };

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
      onClick={handleClick}
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
      {/* depthTest disabled: a tall multi-tier rack standing right behind
          the entry marker (see Rack.tsx) would otherwise hide this label
          from most camera angles — it should always read as sitting above
          the scene, not be occluded by whatever's stacked on the slot. */}
      <Text
        position={[
          0,
          SLOT_HEIGHT / 2 + ENTRY_MARKER_HEIGHT + LABEL_CLEARANCE,
          entryMarkerCenterZ(cellDepth),
        ]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.5}
        color={LABEL_COLOR}
        anchorX="center"
        anchorY="middle"
        renderOrder={999}
        material-depthTest={false}
      >
        {slot.id}
      </Text>
      {depth > 1 &&
        Array.from({ length: depth - 1 }).map((_, i) => (
          <DepthDivider key={i} z={(i + 1) * cellDepth - cellDepth / 2} width={defaults.width} />
        ))}
      {showPallets &&
        slot.subSlots?.map((subSlot, i) => {
        if (subSlot.pallets.length === 0) return null;
        if (mode === "view" && !isSlotSpaceVisible(focus, slot.id, i)) return null;
        // onClick, not onPointerDown — see SlotMesh's handleClick comment.
        const handleSubSlotClick = (e: ThreeEvent<MouseEvent>) => {
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
            onClick={handleSubSlotClick}
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
