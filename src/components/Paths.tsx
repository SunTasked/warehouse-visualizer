import { useMemo } from "react";
import type { Path, Point } from "../types/warehouse";
import { useViewFocus, type Focus } from "../state/ViewFocusContext";
import { isAnyBuildingVisible } from "../lib/visibility";

// Black — reads as a painted floor marking, distinct from the pallet
// fill-rate colors (Rack.tsx's PALLET_FULL_COLOR/PALLET_PARTIAL_COLOR) so a
// corridor never reads as stock.
const PATH_COLOR = "#000000";
const PATH_HEIGHT = 0.04;
const PATH_DEFAULT_WIDTH = 1.5;
// Radius-matching disc rendered at every vertex, so a turn reads as a
// smooth rounded corner instead of the square notch left where two
// perpendicular-cut box segments meet at an angle.
const JOINT_RADIUS_FACTOR = 0.5; // of the path's own width
// How far a cross-building connector's stub reaches into view once the
// building on its far side is hidden (see effectiveView() below).
const STUB_LENGTH = 1.5;
const ARROW_RADIUS = 0.35;
const ARROW_LENGTH = 0.7;

interface PathSegment {
  position: [number, number, number];
  rotationY: number;
  length: number;
}

// Same length/angle/midpoint math as Walls.tsx's segmentsForLoop — a path is
// just an open (not closed) polyline rendered flat at floor level instead of
// at wall height.
function segmentsForPath(points: Point[]): PathSegment[] {
  const segments: PathSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    segments.push({
      position: [(p1.x + p2.x) / 2, PATH_HEIGHT / 2, -(p1.y + p2.y) / 2],
      rotationY: angle,
      length,
    });
  }
  return segments;
}

interface ArrowMarker {
  position: Point;
  /** Warehouse-space direction angle (atan2(dy,dx)) — maps directly to a Three.js rotation.y, same convention used throughout (see Walls.tsx). */
  angleRad: number;
}

interface RenderedPath {
  points: Point[];
  arrow?: ArrowMarker;
}

/**
 * For a plain (single-building) path, or when neither end's building is the
 * one currently focused, the path renders in full. For a cross-building
 * connector (`endpointBuildingIds` set) whose focused-building end is the one
 * currently visible, it renders only as a short stub reaching in from that
 * end (the rest would run into a building that's hidden at this focus
 * level), capped by an arrow pointing further, toward the hidden building.
 */
function effectiveView(path: Path, focus: Focus): RenderedPath {
  if (!path.endpointBuildingIds || !focus.buildingId) return { points: path.points };
  const [startBuildingId, endBuildingId] = path.endpointBuildingIds;
  if (focus.buildingId !== startBuildingId && focus.buildingId !== endBuildingId) {
    return { points: path.points };
  }

  const points = path.points;
  const nearIsStart = focus.buildingId === startBuildingId;
  const near = nearIsStart ? points[0] : points[points.length - 1];
  const adjacent = nearIsStart ? points[1] : points[points.length - 2];
  const dx = adjacent.x - near.x;
  const dy = adjacent.y - near.y;
  const dist = Math.hypot(dx, dy) || 1;
  const stubLen = Math.min(STUB_LENGTH, dist);
  const ux = dx / dist;
  const uy = dy / dist;
  const tip: Point = { x: near.x + ux * stubLen, y: near.y + uy * stubLen };

  return {
    points: nearIsStart ? [near, tip] : [tip, near],
    arrow: { position: tip, angleRad: Math.atan2(dy, dx) },
  };
}

function PathArrow({ arrow }: { arrow: ArrowMarker }) {
  return (
    <group
      position={[arrow.position.x, PATH_HEIGHT + 0.08, -arrow.position.y]}
      rotation={[0, arrow.angleRad, 0]}
    >
      {/* Cone's own axis defaults to Y (apex up) — rotate -90 deg around Z so
          it points along local +X, then the outer group rotation above turns
          that into the path's actual travel direction, same two-step pattern
          the box segments use via their un-rotated length axis. */}
      <mesh rotation={[0, 0, -Math.PI / 2]} raycast={() => null}>
        <coneGeometry args={[ARROW_RADIUS, ARROW_LENGTH, 8]} />
        <meshStandardMaterial color={PATH_COLOR} />
      </mesh>
    </group>
  );
}

function PathMesh({ path, focus }: { path: Path; focus: Focus }) {
  const width = path.width ?? PATH_DEFAULT_WIDTH;
  const view = useMemo(() => effectiveView(path, focus), [path, focus.buildingId]);
  const segments = useMemo(() => segmentsForPath(view.points), [view.points]);
  // A joint at every vertex, except the very last one when it's capped by an
  // arrow instead (the cone already reads as the path's end there).
  const joints = view.arrow ? view.points.slice(0, -1) : view.points;
  const jointRadius = width * JOINT_RADIUS_FACTOR;

  return (
    <>
      {segments.map((segment, i) => (
        <mesh
          key={i}
          position={segment.position}
          rotation={[0, segment.rotationY, 0]}
          raycast={() => null}
        >
          <boxGeometry args={[segment.length, PATH_HEIGHT, width]} />
          <meshStandardMaterial color={PATH_COLOR} />
        </mesh>
      ))}
      {joints.map((p, i) => (
        <mesh key={`joint-${i}`} position={[p.x, PATH_HEIGHT / 2, -p.y]} raycast={() => null}>
          <cylinderGeometry args={[jointRadius, jointRadius, PATH_HEIGHT, 16]} />
          <meshStandardMaterial color={PATH_COLOR} />
        </mesh>
      ))}
      {view.arrow && <PathArrow arrow={view.arrow} />}
    </>
  );
}

export function Paths({ paths }: { paths: Path[] }) {
  const { focus } = useViewFocus();
  return (
    <group>
      {paths.map((path) => {
        if (!isAnyBuildingVisible(focus, path.buildingIds)) return null;
        return <PathMesh key={path.id} path={path} focus={focus} />;
      })}
    </group>
  );
}
