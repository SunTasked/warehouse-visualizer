import { useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Door, WallLoop } from "../types/warehouse";
import { useEditor } from "../state/EditorContext";
import { useViewFocus } from "../state/ViewFocusContext";
import { isBuildingVisible } from "../lib/visibility";
import { DOOR_DEFAULT_WIDTH } from "./Doors";

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
// How far a door's (x,y) may sit off a segment's line and still be treated
// as "on" it — real doors sit exactly on the line, this just tolerates
// floating-point authoring.
const COLLINEAR_EPSILON = 0.05;
// Floor click-catcher sits just above the Grid (y=0) so it doesn't z-fight,
// but still well below a slot pad (SLOT_HEIGHT/2) so slot clicks win.
const FLOOR_Y = 0.005;

interface WallSegment {
  key: string;
  loopId: string;
  /** Only closed loops participate in the plant/warehouse focus level — open polylines (partial/interior walls) are always shown and just step back on click. */
  isBuilding: boolean;
  position: [number, number, number];
  rotationY: number;
  length: number;
}

/**
 * One corner-to-corner edge of a wall loop, split into sub-pieces around any
 * door that sits on it — so the wall renders with an actual gap where a door
 * is, rather than a solid box with a decorative marker layered on top.
 */
function segmentsForEdge(
  wallId: string,
  edgeIndex: number,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  doorsOnLoop: Door[],
): WallSegment[] {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  if (length === 0) return [];
  const ux = dx / length;
  const uy = dy / length;

  // Gaps (as [start, end] distances along this edge) cut by any door whose
  // point is collinear with it and within its span.
  const gaps: [number, number][] = [];
  for (const door of doorsOnLoop) {
    const relX = door.x - p1.x;
    const relY = door.y - p1.y;
    const cross = dx * relY - dy * relX; // 0 if collinear with the edge's line
    const distanceFromLine = Math.abs(cross) / length;
    if (distanceFromLine > COLLINEAR_EPSILON) continue;
    const along = relX * ux + relY * uy; // distance from p1 along the edge
    if (along < 0 || along > length) continue; // door belongs to a different edge
    const halfWidth = (door.width ?? DOOR_DEFAULT_WIDTH) / 2;
    gaps.push([Math.max(0, along - halfWidth), Math.min(length, along + halfWidth)]);
  }
  gaps.sort((a, b) => a[0] - b[0]);

  const pieces: [number, number][] = [];
  let cursor = 0;
  for (const [gapStart, gapEnd] of gaps) {
    if (gapStart > cursor) pieces.push([cursor, gapStart]);
    cursor = Math.max(cursor, gapEnd);
  }
  if (cursor < length) pieces.push([cursor, length]);

  return pieces
    .filter(([a, b]) => b - a > 0.01)
    .map(([a, b], pieceIndex) => {
      const midAlong = (a + b) / 2;
      const midX = p1.x + ux * midAlong;
      const midY = p1.y + uy * midAlong;
      return {
        key: `${wallId}-${edgeIndex}-${pieceIndex}`,
        loopId: wallId,
        isBuilding: true, // only closed loops (buildings) have doors
        position: [midX, WALL_HEIGHT / 2, -midY],
        rotationY: angle,
        length: b - a,
      };
    });
}

function segmentsForLoop(wall: WallLoop, doors: Door[]): WallSegment[] {
  const { points } = wall;
  const pairs: [number, number][] = points.map((_, i) => [i, (i + 1) % points.length]);
  const count = wall.closed ? points.length : points.length - 1;
  const doorsOnLoop = wall.closed ? doors.filter((d) => d.buildingId === wall.id) : [];

  return pairs.slice(0, count).flatMap(([i, j], edgeIndex) => {
    if (!wall.closed) {
      // Open polylines (partial/interior walls) don't participate in the
      // building/door system — render as a single solid segment, unchanged.
      const p1 = points[i];
      const p2 = points[j];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      return [
        {
          key: `${wall.id}-${i}-${j}`,
          loopId: wall.id,
          isBuilding: false,
          position: [(p1.x + p2.x) / 2, WALL_HEIGHT / 2, -((p1.y + p2.y) / 2)] as [number, number, number],
          rotationY: angle,
          length,
        },
      ];
    }
    return segmentsForEdge(wall.id, edgeIndex, points[i], points[j], doorsOnLoop);
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

/**
 * An invisible click/hover catcher spanning one closed loop's whole interior
 * — lets a user click anywhere on a building's floor at "plant" level to
 * focus it, not just its wall outline (which can be visually thin/fiddly to
 * hit). Shares the same hover state (in-scene wall highlight) and click
 * routing (focusWarehouse) as clicking the wall itself. Only rendered at
 * "plant" — once inside a building there's nothing else to pick.
 */
function BuildingFloor({ loop }: { loop: WallLoop }) {
  const { mode } = useEditor();
  const { setHover, focusWarehouse } = useViewFocus();

  // Shape built directly from warehouse-space (x,y) points, then rotated flat
  // -90 deg around X — that rotation maps local (x,y,0) to world (x,0,-y),
  // i.e. exactly toSceneXZ(x,y), so no separate coordinate conversion needed.
  const geometry = useMemo(() => {
    const shape = new THREE.Shape(loop.points.map((p) => new THREE.Vector2(p.x, p.y)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [loop.points]);

  if (mode !== "view") return null;

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    focusWarehouse(loop.id);
  };
  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover({ buildingId: loop.id, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
  };
  const handlePointerOut = () => setHover(null);

  return (
    <mesh
      geometry={geometry}
      position={[0, FLOOR_Y, 0]}
      onPointerDown={handlePointerDown}
      onPointerOver={handlePointerOver}
      onPointerMove={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

export function Walls({ walls, doors }: { walls: WallLoop[]; doors: Door[] }) {
  const { mode } = useEditor();
  const { focus, hover, setHover, back, focusWarehouse } = useViewFocus();
  const segments = useMemo(() => walls.flatMap((wall) => segmentsForLoop(wall, doors)), [walls, doors]);

  return (
    <group>
      {focus.level === "plant" &&
        walls
          .filter((w) => w.closed && w.points.length >= 3)
          .map((loop) => <BuildingFloor key={loop.id} loop={loop} />)}
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
