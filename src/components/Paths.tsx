import { useMemo } from "react";
import type { Path } from "../types/warehouse";
import { useViewFocus } from "../state/ViewFocusContext";
import { isBuildingVisible } from "../lib/visibility";

// A muted red/maroon, deliberately distinct from the pallet fill-rate colors
// (Rack.tsx's PALLET_FULL_COLOR/PALLET_PARTIAL_COLOR) so a corridor marking on
// the floor never reads as stock.
const PATH_COLOR = "#b91c1c";
const PATH_HEIGHT = 0.04;
const PATH_DEFAULT_WIDTH = 1.5;

interface PathSegment {
  position: [number, number, number];
  rotationY: number;
  length: number;
}

// Same length/angle/midpoint math as Walls.tsx's segmentsForLoop — a path is
// just an open (not closed) polyline rendered flat at floor level instead of
// at wall height.
function segmentsForPath(points: Path["points"]): PathSegment[] {
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

function PathMesh({ path }: { path: Path }) {
  const width = path.width ?? PATH_DEFAULT_WIDTH;
  const segments = useMemo(() => segmentsForPath(path.points), [path.points]);

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
    </>
  );
}

export function Paths({ paths }: { paths: Path[] }) {
  const { focus } = useViewFocus();
  return (
    <group>
      {paths.map((path) => {
        if (!isBuildingVisible(focus, path.buildingId)) return null;
        return <PathMesh key={path.id} path={path} />;
      })}
    </group>
  );
}
