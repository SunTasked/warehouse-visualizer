import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Point } from "../types/warehouse";
import { useEditor } from "../state/EditorContext";
import { useViewFocus } from "../state/ViewFocusContext";
import { useSimulation } from "../state/SimulationContext";
import { findBuildingForSlot } from "../lib/buildings";
import { isBuildingVisible, isSlotVisible } from "../lib/visibility";

// Teal where the plan states the corridor; amber where it doesn't and the
// router has picked the nearest one — the cases worth a second look.
const STATED_COLOR = "#0d9488";
const GUESSED_COLOR = "#f59e0b";
const HOVER_STATED_COLOR = "#115e59";
const HOVER_GUESSED_COLOR = "#b45309";
/** Above corridors (0.04) and heatmap lanes, below route lanes (0.1). */
const ELEVATION = 0.08;
const THICKNESS = 0.012;
const LINK_WIDTH = 0.14;
const HOVER_LINK_WIDTH = 0.34;
const DOT_RADIUS = 0.22;
const HOVER_DOT_RADIUS = 0.4;

interface AccessLink {
  kind: "slot" | "depot";
  id: string;
  /** The slot's entry edge, or the facility's centre. */
  from: Point;
  /** Where it joins its corridor. */
  to: Point;
  explicit: boolean;
}

function linkMatrix(link: AccessLink, width: number, out: THREE.Matrix4): THREE.Matrix4 {
  const dx = link.to.x - link.from.x;
  const dy = link.to.y - link.from.y;
  const length = Math.max(Math.hypot(dx, dy), 0.001);
  return out.compose(
    new THREE.Vector3((link.from.x + link.to.x) / 2, ELEVATION, -(link.from.y + link.to.y) / 2),
    // Warehouse angle maps straight onto rotation.y (see geometry.ts).
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dy, dx)),
    new THREE.Vector3(length, THICKNESS, width),
  );
}

/**
 * The "Slot access" layer: a short bar from every slot's entry edge (and every
 * pad's centre) to the point where it joins its corridor, with a dot there —
 * so which aisle serves a slot, and where along it, can be checked by eye.
 * Teal when the plan states it, amber when the router is picking the nearest
 * corridor instead. The hovered slot's bar is drawn bolder.
 *
 * Batched like the slots themselves: one instanced mesh of bars and one of
 * dots for the whole plant, whatever its size.
 */
export function SlotAccess() {
  const { mode, warehouse } = useEditor();
  const { focus, hover } = useViewFocus();
  const { planner } = useSimulation();

  const links = useMemo(() => {
    const list: AccessLink[] = [];
    const add = (kind: "slot" | "depot", id: string) => {
      const join = planner.joinOf({ kind, id });
      if (join?.connection) list.push({ kind, id, from: join.point, to: join.connection.point, explicit: join.explicit });
    };
    for (const slot of warehouse.slots) {
      if (mode === "view" && !isSlotVisible(focus, slot.id, findBuildingForSlot(slot, warehouse.walls))) continue;
      add("slot", slot.id);
    }
    for (const facility of [...warehouse.liftStations, ...warehouse.deliverySpaces]) {
      if (mode === "view" && (focus.level !== "plant" && focus.level !== "warehouse")) continue;
      if (mode === "view" && !isBuildingVisible(focus, facility.buildingId)) continue;
      add("depot", facility.id);
    }
    return list;
  }, [planner, warehouse.slots, warehouse.walls, warehouse.liftStations, warehouse.deliverySpaces, mode, focus]);

  const capacity = Math.max(1, warehouse.slots.length + warehouse.liftStations.length + warehouse.deliverySpaces.length);
  const bar = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const dot = useMemo(() => new THREE.CylinderGeometry(DOT_RADIUS, DOT_RADIUS, THICKNESS, 12), []);
  const hoverDot = useMemo(() => new THREE.CylinderGeometry(HOVER_DOT_RADIUS, HOVER_DOT_RADIUS, THICKNESS, 16), []);
  // White, so each instance's colour is its colour; unlit, so it reads flat.
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffffff" }), []);
  useEffect(
    () => () => {
      bar.dispose();
      dot.dispose();
      hoverDot.dispose();
      material.dispose();
    },
    [bar, dot, hoverDot, material],
  );

  const barRef = useRef<THREE.InstancedMesh>(null);
  const dotRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const bars = barRef.current;
    const dots = dotRef.current;
    if (!bars || !dots) return;
    const matrix = new THREE.Matrix4();
    const stated = new THREE.Color(STATED_COLOR);
    const guessed = new THREE.Color(GUESSED_COLOR);
    const hadColors = bars.instanceColor !== null;
    links.forEach((link, i) => {
      bars.setMatrixAt(i, linkMatrix(link, LINK_WIDTH, matrix));
      dots.setMatrixAt(i, matrix.makeTranslation(link.to.x, ELEVATION, -link.to.y));
      const color = link.explicit ? stated : guessed;
      bars.setColorAt(i, color);
      dots.setColorAt(i, color);
    });
    for (const mesh of [bars, dots]) {
      mesh.count = links.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    // The shader is compiled with or without per-instance colour; the first
    // setColorAt adds it, so the material has to recompile once.
    if (!hadColors && bars.instanceColor) material.needsUpdate = true;
  }, [links, capacity, material]);

  const hovered =
    mode === "view" && hover?.slotId && hover.subSlotIndex === undefined
      ? links.find((link) => link.kind === "slot" && link.id === hover.slotId)
      : undefined;

  return (
    <group>
      <instancedMesh key={`access-bars-${capacity}`} ref={barRef} args={[bar, material, capacity]} raycast={() => null} frustumCulled={false} />
      <instancedMesh key={`access-dots-${capacity}`} ref={dotRef} args={[dot, material, capacity]} raycast={() => null} frustumCulled={false} />
      {hovered && (
        <group>
          <mesh
            geometry={bar}
            matrixAutoUpdate={false}
            matrix={linkMatrix(hovered, HOVER_LINK_WIDTH, new THREE.Matrix4()).setPosition(
              (hovered.from.x + hovered.to.x) / 2,
              ELEVATION + 0.004,
              -(hovered.from.y + hovered.to.y) / 2,
            )}
            raycast={() => null}
          >
            <meshBasicMaterial color={hovered.explicit ? HOVER_STATED_COLOR : HOVER_GUESSED_COLOR} />
          </mesh>
          <mesh
            geometry={hoverDot}
            position={[hovered.to.x, ELEVATION + 0.004, -hovered.to.y]}
            raycast={() => null}
          >
            <meshBasicMaterial color={hovered.explicit ? HOVER_STATED_COLOR : HOVER_GUESSED_COLOR} />
          </mesh>
        </group>
      )}
    </group>
  );
}
