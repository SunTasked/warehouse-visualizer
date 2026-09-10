import { useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import type { WallLoop } from "../types/warehouse";
import { useEditor } from "../state/EditorContext";
import { useViewFocus } from "../state/ViewFocusContext";
import { isBuildingVisible } from "../lib/visibility";

export const WALL_HEIGHT = 3;
const WALL_THICKNESS = 0.2;
const HANDLE_RADIUS = 0.35;
const HANDLE_Y = 0.15;
const WALL_COLOR = "#8a8f98";
// A blue accent (matching SLOT_COLOR's family) rather than a lightened gray
// — "surbrillance" when hovering a building's wall while browsing at "plant"
// level. A subtle same-hue lighten (as used for slots/racks/pallets) reads
// too faintly here: at plant zoom a wall is only a few screen pixels thick,
// so the highlight needs real hue contrast against the gray/white floor to
// actually be noticeable, not just a brightness bump.
const WALL_HOVER_COLOR = "#4d7cfe";

interface WallSegment {
  key: string;
  loopId: string;
  /** Only closed loops participate in the plant/warehouse focus level — open polylines (partial/interior walls) are always shown and just step back on click. */
  isBuilding: boolean;
  position: [number, number, number];
  rotationY: number;
  length: number;
}

function segmentsForLoop(wall: WallLoop): WallSegment[] {
  const { points } = wall;
  const pairs: [number, number][] = points.map((_, i) => [i, (i + 1) % points.length]);
  const count = wall.closed ? points.length : points.length - 1;

  return pairs.slice(0, count).map(([i, j]) => {
    const p1 = points[i];
    const p2 = points[j];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    // Warehouse-space angle from +X, CCW positive — see src/lib/geometry.ts
    // for why this maps directly to Three.js rotation.y with no sign flip.
    const angle = Math.atan2(dy, dx);
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;

    return {
      key: `${wall.id}-${i}-${j}`,
      loopId: wall.id,
      isBuilding: wall.closed,
      position: [midX, WALL_HEIGHT / 2, -midY],
      rotationY: angle,
      length,
    };
  });
}

function WallHandles({ wall }: { wall: WallLoop }) {
  const { dragRef, orbitRef } = useEditor();

  const startDrag = (index: number) => (e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.button !== 0) return; // right button is for box-select
    e.stopPropagation();
    dragRef.current = { type: "wallPoint", wallId: wall.id, index, label: "Move wall corner", moved: false };
    if (orbitRef.current) orbitRef.current.enabled = false;
  };

  return (
    <>
      {wall.points.map((point, index) => (
        <mesh
          key={`${wall.id}-handle-${index}`}
          position={[point.x, HANDLE_Y, -point.y]}
          onPointerDown={startDrag(index)}
        >
          <sphereGeometry args={[HANDLE_RADIUS, 16, 16]} />
          <meshStandardMaterial color="#f5a623" />
        </mesh>
      ))}
    </>
  );
}

export function Walls({ walls }: { walls: WallLoop[] }) {
  const { mode } = useEditor();
  const { focus, hover, setHover, back, focusWarehouse } = useViewFocus();
  const segments = useMemo(() => walls.flatMap(segmentsForLoop), [walls]);

  return (
    <group>
      {segments.map((segment) => {
        if (segment.isBuilding && !isBuildingVisible(focus, segment.loopId)) return null;

        const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
          if (mode !== "view") return;
          e.stopPropagation();
          // A different building's wall (or any wall from plant, since
          // focus.buildingId is unset there): jump directly into it. The
          // currently-focused building's own wall (or a non-building, open
          // polyline segment): step back one level, like clicking outside.
          if (segment.isBuilding && focus.buildingId !== segment.loopId) {
            focusWarehouse(segment.loopId);
          } else {
            back();
          }
        };

        // Hovering a building's wall highlights the whole building — only
        // meaningful while choosing among buildings at "plant" level (once
        // inside one, its siblings are hidden and there's nothing to pick).
        const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
          if (mode !== "view" || !segment.isBuilding || focus.level !== "plant") return;
          e.stopPropagation();
          setHover({ buildingId: segment.loopId, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
        };
        const handlePointerOut = () => {
          if (mode !== "view" || !segment.isBuilding || focus.level !== "plant") return;
          setHover(null);
        };
        const wallHovered =
          mode === "view" &&
          focus.level === "plant" &&
          segment.isBuilding &&
          hover?.buildingId === segment.loopId;

        return (
          <mesh
            key={segment.key}
            position={segment.position}
            rotation={[0, segment.rotationY, 0]}
            onPointerDown={handlePointerDown}
            onPointerOver={handlePointerOver}
            onPointerMove={handlePointerOver}
            onPointerOut={handlePointerOut}
          >
            <boxGeometry args={[segment.length, WALL_HEIGHT, WALL_THICKNESS]} />
            <meshStandardMaterial color={wallHovered ? WALL_HOVER_COLOR : WALL_COLOR} />
          </mesh>
        );
      })}
      {mode === "edit" && walls.map((wall) => <WallHandles key={wall.id} wall={wall} />)}
    </group>
  );
}
