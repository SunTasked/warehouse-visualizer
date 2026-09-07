import { useMemo } from "react";
import type { WallLoop } from "../types/warehouse";

const WALL_HEIGHT = 3;
const WALL_THICKNESS = 0.2;

interface WallSegment {
  key: string;
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
      position: [midX, WALL_HEIGHT / 2, -midY],
      rotationY: angle,
      length,
    };
  });
}

export function Walls({ walls }: { walls: WallLoop[] }) {
  const segments = useMemo(() => walls.flatMap(segmentsForLoop), [walls]);

  return (
    <group>
      {segments.map((segment) => (
        <mesh
          key={segment.key}
          position={segment.position}
          rotation={[0, segment.rotationY, 0]}
        >
          <boxGeometry args={[segment.length, WALL_HEIGHT, WALL_THICKNESS]} />
          <meshStandardMaterial color="#8a8f98" />
        </mesh>
      ))}
    </group>
  );
}
