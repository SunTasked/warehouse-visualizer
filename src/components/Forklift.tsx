import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Point } from "../types/warehouse";
import { useEditor } from "../state/EditorContext";
import { useSimulation, type Leg } from "../state/SimulationContext";
import { segmentsForPath } from "./Paths";

// Orange — a distinct accent from the black infrastructure paths (Paths.tsx)
// so a picking-list route reads as a temporary overlay, not fixed layout.
const ROUTE_COLOR = "#f97316";
// Above PATH_HEIGHT (0.04) so the route overlay never z-fights with the
// infrastructure paths it often runs alongside or directly over.
const ROUTE_HEIGHT = 0.1;
const ROUTE_WIDTH = 0.6;
const JOINT_RADIUS = ROUTE_WIDTH / 2;

const MARKER_RADIUS = 0.4;
const MARKER_HEIGHT = 0.16;
const MARKER_COLOR = "#1d4ed8";

const FORKLIFT_LENGTH = 1.4; // along travel direction (local X)
const FORKLIFT_WIDTH = 1.0; // across (local Z)
const FORKLIFT_HEIGHT = 0.9;
const FORKLIFT_COLOR = "#f59e0b";

function RouteHighlight({ points }: { points: Point[] }) {
  const segments = useMemo(() => segmentsForPath(points, ROUTE_HEIGHT), [points]);
  return (
    <>
      {segments.map((segment, i) => (
        <mesh key={i} position={segment.position} rotation={[0, segment.rotationY, 0]} raycast={() => null}>
          <boxGeometry args={[segment.length, ROUTE_HEIGHT, ROUTE_WIDTH]} />
          <meshStandardMaterial color={ROUTE_COLOR} />
        </mesh>
      ))}
      {/* Rounded joints at every vertex — same treatment as Paths.tsx's turns. */}
      {points.map((p, i) => (
        <mesh key={`joint-${i}`} position={[p.x, ROUTE_HEIGHT / 2, -p.y]} raycast={() => null}>
          <cylinderGeometry args={[JOINT_RADIUS, JOINT_RADIUS, ROUTE_HEIGHT, 16]} />
          <meshStandardMaterial color={ROUTE_COLOR} />
        </mesh>
      ))}
    </>
  );
}

// Numbered so the visit order is legible even in static mode, where nothing
// actually moves.
function StopMarkers({ points }: { points: Point[] }) {
  return (
    <>
      {points.map((p, i) => (
        <group key={i} position={[p.x, 0, -p.y]}>
          <mesh position={[0, MARKER_HEIGHT / 2, 0]} raycast={() => null}>
            <cylinderGeometry args={[MARKER_RADIUS, MARKER_RADIUS, MARKER_HEIGHT, 20]} />
            <meshStandardMaterial color={MARKER_COLOR} />
          </mesh>
          <Text
            position={[0, MARKER_HEIGHT + 0.05, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.4}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
          >
            {i + 1}
          </Text>
        </group>
      ))}
    </>
  );
}

/** Walks a leg's polyline to the point `distance` meters along it, and the travel-direction angle there (for facing the vehicle). */
function pointAtDistance(points: Point[], distance: number): { point: Point; angleRad: number } {
  let remaining = distance;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const angleRad = Math.atan2(b.y - a.y, b.x - a.x);
    if (remaining <= segLen || i === points.length - 2) {
      const t = segLen === 0 ? 0 : Math.min(1, Math.max(0, remaining / segLen));
      return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, angleRad };
    }
    remaining -= segLen;
  }
  return { point: points[points.length - 1], angleRad: 0 };
}

function Vehicle() {
  const simulation = useSimulation();
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const run = simulation.activeRun;
    if (!run || run.mode !== "animated" || run.currentLegIndex >= run.legs.length) return;
    const leg: Leg = run.legs[run.currentLegIndex];
    simulation.progressRef.current += simulation.speed * delta;
    if (simulation.progressRef.current >= leg.length) {
      simulation.advanceLeg();
      return; // next frame picks up the new leg (or stops) fresh
    }
    const { point, angleRad } = pointAtDistance(leg.points, simulation.progressRef.current);
    groupRef.current?.position.set(point.x, 0, -point.y);
    groupRef.current?.rotation.set(0, angleRad, 0);
  });

  const run = simulation.activeRun;
  if (!run || run.mode !== "animated" || run.currentLegIndex >= run.legs.length) return null;

  return (
    <group ref={groupRef}>
      <mesh position={[0, FORKLIFT_HEIGHT / 2, 0]} raycast={() => null}>
        <boxGeometry args={[FORKLIFT_LENGTH, FORKLIFT_HEIGHT, FORKLIFT_WIDTH]} />
        <meshStandardMaterial color={FORKLIFT_COLOR} />
      </mesh>
      {/* Forward-facing indicator — same two-step rotation trick as Paths.tsx's directional arrow (rotate to point along local +X, then rely on the group's own heading). */}
      <mesh
        position={[FORKLIFT_LENGTH / 2 + 0.15, FORKLIFT_HEIGHT / 2, 0]}
        rotation={[0, 0, -Math.PI / 2]}
        raycast={() => null}
      >
        <coneGeometry args={[0.22, 0.45, 8]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>
    </group>
  );
}

export function Forklift() {
  const { mode } = useEditor();
  const simulation = useSimulation();
  const run = simulation.activeRun;
  // View-mode only — this is simulation overlay, not part of the physical
  // layout being edited. Unmounting (rather than just hiding) also pauses
  // an in-progress animated run: Vehicle's useFrame stops advancing
  // progressRef entirely while unmounted, so switching back to view mode
  // resumes exactly where it left off instead of having silently kept
  // ticking in the background.
  if (mode !== "view" || !run || run.legs.length === 0) return null;

  const stopPoints: Point[] = [run.legs[0].points[0], ...run.legs.map((leg) => leg.points[leg.points.length - 1])];

  return (
    <group>
      <RouteHighlight points={run.route} />
      <StopMarkers points={stopPoints} />
      <Vehicle />
    </group>
  );
}
