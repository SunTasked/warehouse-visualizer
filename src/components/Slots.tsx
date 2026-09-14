import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { BatchedText, Text as TroikaText } from "troika-three-text";
import { RoundedBoxGeometry } from "three-stdlib";
import type { Slot, SlotSize } from "../types/warehouse";
import { useEditor } from "../state/EditorContext";
import { useViewFocus } from "../state/ViewFocusContext";
import { fromSceneXZ, slotFootprint } from "../lib/geometry";
import { isSlotVisible, isSlotSpaceVisible } from "../lib/visibility";
import { findBuildingForSlot } from "../lib/buildings";
import { PALLET_FULL_ITEMS } from "../lib/stock";
import { useLayers } from "../state/LayerContext";
import {
  LEVEL_HEIGHT,
  PALLET_BLOCK_BEVEL_FACTOR,
  PALLET_BLOCK_HEIGHT_FACTOR,
  PALLET_BLOCK_INSET,
  PALLET_FULL_COLOR,
  PALLET_PARTIAL_COLOR,
  POST_SIZE,
  RACK_COLOR,
  RACK_MARGIN_FACTOR,
  RAIL_THICKNESS,
  Rack,
} from "./Rack";

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
const LABEL_SIZE = 0.5;

const Y_AXIS = new THREE.Vector3(0, 1, 0);

// Shared by the entry markers and the id labels, so a label always sits
// centered on its marker regardless of ENTRY_MARKER_DEPTH.
function entryMarkerCenterZ(cellDepth: number): number {
  return -cellDepth / 2 + ENTRY_MARKER_DEPTH / 2;
}

/**
 * A point given in a slot's own frame — origin at the front sub-slot's
 * centre, mid-height of the pad, +z running back into the rack, turned by the
 * slot's rotation — in world space. Every batched part below is placed with
 * it, so they all agree with the racks, which still render inside a real
 * rotated group (SlotRacks).
 */
function toWorld(slot: Slot, lx: number, ly: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
  const rotationRad = THREE.MathUtils.degToRad(slot.rotationDeg ?? 0);
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  return out.set(slot.x + lx * cos + lz * sin, SLOT_HEIGHT / 2 + ly, -slot.y - lx * sin + lz * cos);
}

// A box's 12 edges as corner pairs; corner index bits: x = 4, y = 2, z = 1.
const BOX_EDGES: [number, number][] = [];
for (let a = 0; a < 8; a++) {
  for (const bit of [4, 2, 1]) if (!(a & bit)) BOX_EDGES.push([a, a | bit]);
}

/** Every slot's outline in one line geometry — one draw call instead of one per slot. */
function buildOutlines(slots: Slot[], defaults: SlotSize): THREE.BufferGeometry {
  const positions = new Float32Array(slots.length * BOX_EDGES.length * 2 * 3);
  const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  let offset = 0;
  for (const slot of slots) {
    const { depth, cellDepth } = slotFootprint(slot, defaults);
    const xs = [-defaults.width / 2, defaults.width / 2];
    const ys = [-SLOT_HEIGHT / 2, SLOT_HEIGHT / 2];
    const zs = [-cellDepth / 2, (depth - 1) * cellDepth + cellDepth / 2];
    for (let i = 0; i < 8; i++) toWorld(slot, xs[(i >> 2) & 1], ys[(i >> 1) & 1], zs[i & 1], corners[i]);
    for (const [a, b] of BOX_EDGES) {
      corners[a].toArray(positions, offset);
      corners[b].toArray(positions, offset + 3);
      offset += 6;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

/**
 * The slot ids, as one BatchedText: a single draw call for every label,
 * where one drei <Text> per slot cost a draw call each — at 3,200 slots that
 * alone held a whole-plant view to single-digit frame rates. Labels are kept
 * per slot id across focus changes (dropped from the batch, not destroyed),
 * so drilling in and back out doesn't re-typeset thousands of them.
 */
function useSlotLabels(allSlots: Slot[], visible: Slot[], defaults: SlotSize): BatchedText {
  const batch = useMemo(() => {
    const text = new BatchedText();
    // depthTest off and drawn last: a tall multi-tier rack standing right
    // behind the entry marker would otherwise hide its label from most
    // camera angles — it should always read as sitting above the scene.
    text.renderOrder = 999;
    text.frustumCulled = false;
    (text.material as THREE.Material).depthTest = false;
    return text;
  }, []);
  const members = useRef(new Map<string, { text: TroikaText; inBatch: boolean }>());

  useLayoutEffect(() => {
    const existing = new Set(allSlots.map((s) => s.id));
    const shown = new Set(visible.map((s) => s.id));
    for (const slot of visible) {
      let member = members.current.get(slot.id);
      if (!member) {
        const text = new TroikaText();
        text.text = slot.id;
        text.fontSize = LABEL_SIZE;
        text.color = LABEL_COLOR;
        text.anchorX = "center";
        text.anchorY = "middle";
        member = { text, inBatch: false };
        members.current.set(slot.id, member);
      }
      const { cellDepth } = slotFootprint(slot, defaults);
      toWorld(slot, 0, SLOT_HEIGHT / 2 + ENTRY_MARKER_HEIGHT + LABEL_CLEARANCE, entryMarkerCenterZ(cellDepth), member.text.position);
      // Flat on the marker, then turned with the slot — the same orientation
      // the label had as a child of the slot's rotated group.
      member.text.rotation.set(-Math.PI / 2, THREE.MathUtils.degToRad(slot.rotationDeg ?? 0), 0, "YXZ");
      if (!member.inBatch) {
        batch.addText(member.text);
        member.inBatch = true;
      }
    }
    for (const [id, member] of members.current) {
      if (shown.has(id)) continue;
      if (member.inBatch) {
        batch.removeText(member.text);
        member.inBatch = false;
      }
      if (!existing.has(id)) {
        member.text.dispose();
        members.current.delete(id);
      }
    }
    batch.sync();
  }, [batch, allSlots, visible, defaults]);

  useEffect(() => {
    const owned = members.current;
    return () => {
      owned.forEach(({ text }) => text.dispose());
      owned.clear();
      batch.dispose();
    };
  }, [batch]);

  return batch;
}

type SlotPointerEvent = ThreeEvent<PointerEvent>;

interface SlotHandlers {
  pointerOver: (e: SlotPointerEvent, slot: Slot) => void;
  pointerOut: () => void;
  click: (e: ThreeEvent<MouseEvent>, slot: Slot) => void;
  pointerDown: (e: SlotPointerEvent, slot: Slot) => void;
}

/**
 * One slot's racks and pallets. Still a real rotated group per slot, and only
 * for slots that hold stock: each rack is interactive in its own right
 * (sub-slot and pallet drill-down, see Rack.tsx). Events its racks don't
 * consume carry on to the slot's own handlers, as they did when the racks sat
 * inside each slot's group.
 */
function SlotRacks({
  slot,
  defaults,
  buildingId,
  handlers,
}: {
  slot: Slot;
  defaults: SlotSize;
  buildingId: string | undefined;
  handlers: SlotHandlers;
}) {
  const { mode } = useEditor();
  const { focus, setHover, focusSlotSpace } = useViewFocus();
  const { cellDepth } = slotFootprint(slot, defaults);
  const rotationRad = THREE.MathUtils.degToRad(slot.rotationDeg ?? 0);

  return (
    <group
      position={[slot.x, SLOT_HEIGHT / 2, -slot.y]}
      rotation={[0, rotationRad, 0]}
      onClick={(e) => handlers.click(e, slot)}
      onPointerDown={(e) => handlers.pointerDown(e, slot)}
      onPointerOver={(e) => handlers.pointerOver(e, slot)}
      onPointerMove={(e) => handlers.pointerOver(e, slot)}
      onPointerOut={handlers.pointerOut}
    >
      {slot.subSlots?.map((subSlot, i) => {
        if (subSlot.pallets.length === 0) return null;
        if (mode === "view" && !isSlotSpaceVisible(focus, slot.id, i)) return null;
        // onClick, not onPointerDown — see the slot click handler in Slots.
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
        const handleSubSlotPointerOver = (e: SlotPointerEvent) => {
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

/** Instance buffers grow in steps, so a batch moving a few pallets doesn't reallocate them. */
const RACK_BATCH_STEP = 1024;
const batchCapacity = (needed: number) => Math.max(RACK_BATCH_STEP, Math.ceil(needed / RACK_BATCH_STEP) * RACK_BATCH_STEP);

/**
 * Every rack and pallet of `slots` as four instanced meshes — posts, the rails
 * along and across, pallet crates — for whenever more than one slot is on
 * screen: plant and building zoom, and edit mode. One Rack component per
 * sub-slot, as for a focused slot, gave CML's 8,817 pallets some 70,000 meshes:
 * 4 fps, and 7 s to switch the layer on. Nothing at those zooms reacts to a
 * rack itself, only to its slot, so a crate hit resolves to its slot and goes
 * to the slot's handlers. Every pallet shows as its block here; tires are for
 * the one pallet drilled into (Rack.tsx).
 */
function RackBatch({ slots, defaults, handlers }: { slots: Slot[]; defaults: SlotSize; handlers: SlotHandlers }) {
  const halfWidth = (defaults.width / 2) * RACK_MARGIN_FACTOR;
  const halfDepth = (defaults.height / 2) * RACK_MARGIN_FACTOR;

  const capacity = useMemo(() => {
    let subSlots = 0;
    let pallets = 0;
    for (const slot of slots) {
      for (const subSlot of slot.subSlots ?? []) {
        if (subSlot.pallets.length === 0) continue;
        subSlots += 1;
        pallets += subSlot.pallets.length;
      }
    }
    // Four posts per rack; two rails each way per level boundary.
    return { posts: batchCapacity(subSlots * 4), rails: batchCapacity((pallets + subSlots) * 2), crates: batchCapacity(pallets) };
  }, [slots]);

  const geometries = useMemo(() => {
    const width = halfWidth * 2 * PALLET_BLOCK_INSET;
    const depth = halfDepth * 2 * PALLET_BLOCK_INSET;
    const height = LEVEL_HEIGHT * PALLET_BLOCK_HEIGHT_FACTOR;
    return {
      post: new THREE.BoxGeometry(POST_SIZE, 1, POST_SIZE),
      along: new THREE.BoxGeometry(halfWidth * 2, RAIL_THICKNESS, RAIL_THICKNESS),
      across: new THREE.BoxGeometry(RAIL_THICKNESS, RAIL_THICKNESS, halfDepth * 2),
      crate: new RoundedBoxGeometry(width, height, depth, 2, Math.min(width, depth, height) * PALLET_BLOCK_BEVEL_FACTOR),
    };
  }, [halfWidth, halfDepth]);
  useEffect(() => () => Object.values(geometries).forEach((geometry) => geometry.dispose()), [geometries]);
  const frameMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: RACK_COLOR }), []);
  // White, so each crate's instance colour is its colour.
  const crateMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ffffff" }), []);

  const postRef = useRef<THREE.InstancedMesh>(null);
  const alongRef = useRef<THREE.InstancedMesh>(null);
  const acrossRef = useRef<THREE.InstancedMesh>(null);
  const crateRef = useRef<THREE.InstancedMesh>(null);
  /** The slot each crate instance belongs to, for pointer events. */
  const crateSlots = useRef<Slot[]>([]);

  useLayoutEffect(() => {
    const posts = postRef.current;
    const along = alongRef.current;
    const across = acrossRef.current;
    const crates = crateRef.current;
    if (!posts || !along || !across || !crates) return;
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const full = new THREE.Color(PALLET_FULL_COLOR);
    const partial = new THREE.Color(PALLET_PARTIAL_COLOR);
    const hadColors = crates.instanceColor !== null;
    // Each Rack stands in a group lifted SLOT_HEIGHT / 2 above its slot's.
    const base = SLOT_HEIGHT / 2;
    const crateHeight = LEVEL_HEIGHT * PALLET_BLOCK_HEIGHT_FACTOR;
    const owners: Slot[] = [];
    let postCount = 0;
    let alongCount = 0;
    let acrossCount = 0;
    let crateCount = 0;

    for (const slot of slots) {
      rotation.setFromAxisAngle(Y_AXIS, THREE.MathUtils.degToRad(slot.rotationDeg ?? 0));
      slot.subSlots?.forEach((subSlot, i) => {
        const levels = subSlot.pallets.length;
        if (levels === 0) return;
        const z = i * defaults.height;
        const height = levels * LEVEL_HEIGHT;
        for (const x of [-halfWidth, halfWidth]) {
          for (const dz of [-halfDepth, halfDepth]) {
            toWorld(slot, x, base + height / 2, z + dz, position);
            posts.setMatrixAt(postCount++, matrix.compose(position, rotation, scale.set(1, height, 1)));
          }
        }
        for (let level = 0; level <= levels; level++) {
          const y = base + level * LEVEL_HEIGHT;
          for (const side of [-1, 1]) {
            toWorld(slot, 0, y, z + side * halfDepth, position);
            along.setMatrixAt(alongCount++, matrix.compose(position, rotation, one));
            toWorld(slot, side * halfWidth, y, z, position);
            across.setMatrixAt(acrossCount++, matrix.compose(position, rotation, one));
          }
        }
        subSlot.pallets.forEach((pallet, level) => {
          toWorld(slot, 0, base + level * LEVEL_HEIGHT + crateHeight / 2 + 0.02, z, position);
          crates.setMatrixAt(crateCount, matrix.compose(position, rotation, one));
          crates.setColorAt(crateCount, pallet.items.length >= PALLET_FULL_ITEMS ? full : partial);
          owners[crateCount++] = slot;
        });
      });
    }

    posts.count = postCount;
    along.count = alongCount;
    across.count = acrossCount;
    crates.count = crateCount;
    for (const mesh of [posts, along, across, crates]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    if (crates.instanceColor) crates.instanceColor.needsUpdate = true;
    if (!hadColors && crates.instanceColor) crateMaterial.needsUpdate = true;
    crateSlots.current = owners;
  }, [slots, defaults, halfWidth, halfDepth, capacity, crateMaterial]);

  const owner = (e: { instanceId?: number }) => (e.instanceId === undefined ? undefined : crateSlots.current[e.instanceId]);

  return (
    <group>
      <instancedMesh key={`posts-${capacity.posts}`} ref={postRef} args={[geometries.post, frameMaterial, capacity.posts]} raycast={() => null} frustumCulled={false} />
      <instancedMesh key={`along-${capacity.rails}`} ref={alongRef} args={[geometries.along, frameMaterial, capacity.rails]} raycast={() => null} frustumCulled={false} />
      <instancedMesh key={`across-${capacity.rails}`} ref={acrossRef} args={[geometries.across, frameMaterial, capacity.rails]} raycast={() => null} frustumCulled={false} />
      <instancedMesh
        key={`crates-${capacity.crates}`}
        ref={crateRef}
        args={[geometries.crate, crateMaterial, capacity.crates]}
        frustumCulled={false}
        onClick={(e) => {
          const slot = owner(e);
          if (slot) handlers.click(e, slot);
        }}
        onPointerDown={(e) => {
          const slot = owner(e);
          if (slot) handlers.pointerDown(e, slot);
        }}
        onPointerOver={(e) => {
          const slot = owner(e);
          if (slot) handlers.pointerOver(e, slot);
        }}
        onPointerMove={(e) => {
          const slot = owner(e);
          if (slot) handlers.pointerOver(e, slot);
        }}
        onPointerOut={handlers.pointerOut}
      />
    </group>
  );
}

/**
 * Every slot in the warehouse. The parts every slot has — pad, outline,
 * entry marker, depth dividers, id label — are batched: one instanced mesh
 * (or merged geometry) each for the whole warehouse, so the draw-call count
 * no longer grows with the number of slots. A plant of 3,200 slots drawn one
 * group per slot took ~15,500 draw calls and ran at 8 fps on a desktop GPU,
 * and every hover re-rendered all 3,200 components. The pad mesh takes the
 * pointer and resolves the slot from the instance hit.
 */
export function Slots({ slots, defaults }: { slots: Slot[]; defaults: SlotSize }) {
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
  const { focus, hover, setHover, focusSlot } = useViewFocus();
  // Racks and their pallets are their own layer — hiding them is what clears
  // the floor so the slot heatmap can be read on the slot pads themselves.
  const showPallets = useLayers().isVisible("pallets");

  const buildingOf = useMemo(
    () => new Map(slots.map((slot) => [slot.id, findBuildingForSlot(slot, warehouse.walls)])),
    [slots, warehouse.walls],
  );
  const visible = useMemo(
    () => (mode === "view" ? slots.filter((slot) => isSlotVisible(focus, slot.id, buildingOf.get(slot.id))) : slots),
    [slots, mode, focus, buildingOf],
  );

  // Instance capacity follows the whole warehouse, so drilling in and out
  // only changes how many instances are drawn, never reallocates the meshes.
  const capacity = Math.max(1, slots.length);
  const dividerCapacity = Math.max(1, slots.reduce((sum, slot) => sum + slotFootprint(slot, defaults).depth - 1, 0));

  const unitBox = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const markerGeometry = useMemo(
    () => new THREE.BoxGeometry(defaults.width * 0.96, ENTRY_MARKER_HEIGHT, ENTRY_MARKER_DEPTH),
    [defaults.width],
  );
  const dividerGeometry = useMemo(() => new THREE.BoxGeometry(defaults.width * 0.96, 0.01, 0.02), [defaults.width]);
  // White, so each pad's instance colour is its colour.
  const padMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ffffff" }), []);
  const markerMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: ENTRY_COLOR }), []);
  const dividerMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: DIVIDER_COLOR }), []);
  const outlines = useMemo(() => buildOutlines(visible, defaults), [visible, defaults]);
  useEffect(() => () => outlines.dispose(), [outlines]);
  const labels = useSlotLabels(slots, visible, defaults);

  const padRef = useRef<THREE.InstancedMesh>(null);
  const markerRef = useRef<THREE.InstancedMesh>(null);
  const dividerRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const pads = padRef.current;
    const markers = markerRef.current;
    const dividers = dividerRef.current;
    if (!pads || !markers || !dividers) return;
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    let dividerCount = 0;
    visible.forEach((slot, i) => {
      // Each sub-slot is a full slotDefaults footprint (not a fraction of
      // one): sub-slot 0 sits where a depth-1 slot's footprint would, and
      // each further one is appended behind it, so slot.x/y stays anchored
      // to the front sub-slot and added depth only extends the far side.
      const { depth, cellDepth, totalDepth, footprintCenterZ } = slotFootprint(slot, defaults);
      rotation.setFromAxisAngle(Y_AXIS, THREE.MathUtils.degToRad(slot.rotationDeg ?? 0));
      toWorld(slot, 0, 0, footprintCenterZ, position);
      pads.setMatrixAt(i, matrix.compose(position, rotation, scale.set(defaults.width, SLOT_HEIGHT, totalDepth)));
      toWorld(slot, 0, SLOT_HEIGHT / 2 + ENTRY_MARKER_HEIGHT / 2, entryMarkerCenterZ(cellDepth), position);
      markers.setMatrixAt(i, matrix.compose(position, rotation, one));
      for (let k = 1; k < depth; k++) {
        toWorld(slot, 0, SLOT_HEIGHT / 2 + 0.005, k * cellDepth - cellDepth / 2, position);
        dividers.setMatrixAt(dividerCount++, matrix.compose(position, rotation, one));
      }
    });
    pads.count = visible.length;
    markers.count = visible.length;
    dividers.count = dividerCount;
    for (const mesh of [pads, markers, dividers]) {
      mesh.instanceMatrix.needsUpdate = true;
      // Raycasting tests this sphere first; left stale, pointer events would
      // miss slots outside wherever the instances first stood.
      mesh.computeBoundingSphere();
    }
  }, [visible, defaults, capacity, dividerCapacity]);

  // Only a "pure" slot-level hover (no deeper target) lights up the pad —
  // hovering one of its sub-slot racks highlights that rack instead.
  const hoveredSlotId = mode === "view" && hover?.slotId && hover.subSlotIndex === undefined ? hover.slotId : null;
  const colors = useMemo(
    () => ({
      base: new THREE.Color(SLOT_COLOR),
      selected: new THREE.Color(SLOT_SELECTED_COLOR),
      hovered: new THREE.Color(SLOT_HOVER_COLOR),
    }),
    [],
  );
  useLayoutEffect(() => {
    const pads = padRef.current;
    if (!pads) return;
    const hadColors = pads.instanceColor !== null;
    visible.forEach((slot, i) => {
      const color = slot.id === hoveredSlotId ? colors.hovered : selectedSlotIds.has(slot.id) ? colors.selected : colors.base;
      pads.setColorAt(i, color);
    });
    if (pads.instanceColor) pads.instanceColor.needsUpdate = true;
    // The shader is compiled with or without per-instance colour; the first
    // setColorAt adds it, so the material must recompile once.
    if (!hadColors && pads.instanceColor) padMaterial.needsUpdate = true;
  }, [visible, hoveredSlotId, selectedSlotIds, colors, padMaterial, capacity]);

  const handlers: SlotHandlers = {
    pointerOver: (e, slot) => {
      if (mode !== "view") return;
      // Without this, the event keeps propagating to whatever's beneath (at
      // "plant" level, the building floor click-catcher — see Walls.tsx's
      // BuildingFloor), whose own setHover(buildingId) call would immediately
      // overwrite this one since both fire within the same event dispatch.
      e.stopPropagation();
      setHover({ slotId: slot.id, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
    },
    pointerOut: () => {
      if (mode !== "view") return;
      setHover(null);
    },
    // View-mode "select this slot" fires on onClick, not onPointerDown —
    // mixing the two event types for competing handlers (this slot vs. the
    // building floor beneath it) caused a real bug: whichever fired later
    // always won, regardless of which object the raycast actually preferred.
    click: (e, slot) => {
      if (mode !== "view" || e.nativeEvent.button !== 0) return;
      e.stopPropagation();
      focusSlot(slot.id, buildingOf.get(slot.id));
    },
    pointerDown: (e, slot) => {
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
    },
  };

  // The pad mesh is hit per instance; instanceId indexes `visible`.
  const slotHit = (e: { instanceId?: number }) => (e.instanceId === undefined ? undefined : visible[e.instanceId]);

  // Memoised, not filtered per render: a new array on every hover would have
  // RackBatch lay out every rack again.
  const stocked = useMemo(
    () => (showPallets ? visible.filter((slot) => slot.subSlots?.some((subSlot) => subSlot.pallets.length > 0)) : []),
    [showPallets, visible],
  );
  // A focused slot keeps its real, interactive racks; any wider view batches them.
  const batchRacks = mode !== "view" || focus.level === "plant" || focus.level === "warehouse";

  return (
    <group>
      <instancedMesh
        key={`pads-${capacity}`}
        ref={padRef}
        args={[unitBox, padMaterial, capacity]}
        frustumCulled={false}
        onClick={(e) => {
          const slot = slotHit(e);
          if (slot) handlers.click(e, slot);
        }}
        onPointerDown={(e) => {
          const slot = slotHit(e);
          if (slot) handlers.pointerDown(e, slot);
        }}
        onPointerOver={(e) => {
          const slot = slotHit(e);
          if (slot) handlers.pointerOver(e, slot);
        }}
        onPointerMove={(e) => {
          const slot = slotHit(e);
          if (slot) handlers.pointerOver(e, slot);
        }}
        onPointerOut={handlers.pointerOut}
      />
      {/* Decorative parts opt out of raycasting: Three.js's default
          line-raycast threshold (1 world unit) makes an un-opted-out
          LineSegments a near-universal click-blocker once zoomed in close,
          stealing clicks meant for the rack behind/above it. */}
      <lineSegments geometry={outlines} raycast={() => null} frustumCulled={false}>
        <lineBasicMaterial color={SLOT_EDGE_COLOR} />
      </lineSegments>
      <instancedMesh
        key={`markers-${capacity}`}
        ref={markerRef}
        args={[markerGeometry, markerMaterial, capacity]}
        raycast={() => null}
        frustumCulled={false}
      />
      <instancedMesh
        key={`dividers-${dividerCapacity}`}
        ref={dividerRef}
        args={[dividerGeometry, dividerMaterial, dividerCapacity]}
        raycast={() => null}
        frustumCulled={false}
      />
      <primitive object={labels} raycast={() => null} />
      {batchRacks ? (
        stocked.length > 0 && <RackBatch slots={stocked} defaults={defaults} handlers={handlers} />
      ) : (
        stocked.map((slot) => (
          <SlotRacks
            key={slot.id}
            slot={slot}
            defaults={defaults}
            buildingId={buildingOf.get(slot.id)}
            handlers={handlers}
          />
        ))
      )}
    </group>
  );
}
