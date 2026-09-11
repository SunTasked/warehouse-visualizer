import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Point } from "../types/warehouse";
import { useEditor } from "../state/EditorContext";
import { useSimulation, type Leg } from "../state/SimulationContext";
import { segmentsForPath, type PathSegment } from "./Paths";

// Orange — a distinct accent from the black infrastructure paths (Paths.tsx)
// so a picking-list route reads as a temporary overlay, not fixed layout.
const ROUTE_COLOR = "#f97316";
// Above PATH_HEIGHT (0.04) so the route overlay never z-fights with the
// infrastructure paths it often runs alongside or directly over.
const ROUTE_HEIGHT = 0.1;
const ROUTE_WIDTH = 0.5;
const JOINT_RADIUS = ROUTE_WIDTH / 2;
// How far a lane is shifted off the path's true centerline, perpendicular to
// its own travel direction — so a leg traveled one way and a later leg
// backtracking over the same corridor render as two separate parallel
// lanes instead of one merged line (per user feedback). Offsetting is
// always applied (every lane sits a little off-center, even one traveled
// only once) so the rule is uniform rather than conditional on detecting an
// actual overlap.
const LANE_OFFSET = 0.3;

const ARROW_COLOR = "#facc15";
const ARROW_SPACING = 3; // meters between direction arrows along a lane
const ARROW_RADIUS = 0.22;
const ARROW_LENGTH = 0.55;
// Below this, a lane segment (e.g. a short notch into a slot) is too short
// to bother placing a direction arrow on.
const MIN_ARROW_SEGMENT_LENGTH = 1.2;

const MARKER_RADIUS = 0.4;
const MARKER_HEIGHT = 0.16;
const MARKER_COLOR = "#1d4ed8";
// Stop-number labels render with depth testing off (see StopMarkers below)
// so they're never hidden behind a tall pallet stack or another lane —
// "above everything else," per user feedback — but are still placed well
// above typical rack height too, so they read as sitting *above* the scene
// rather than floating awkwardly through it from most camera angles.
const MARKER_LABEL_HEIGHT = 2.2;

const FORKLIFT_LENGTH = 1.4; // along travel direction (local X)
const FORKLIFT_WIDTH = 1.0; // across (local Z)
const FORKLIFT_HEIGHT = 0.9;
const FORKLIFT_COLOR = "#f59e0b";

/**
 * Shifts every point of a polyline perpendicular to its own local travel
 * direction (the average of its incoming/outgoing segment directions, so
 * turns still read as one continuous offset line rather than two disjoint
 * ones) by a fixed distance. Two legs riding the same physical corridor in
 * opposite directions end up offset to *opposite* sides of the true
 * centerline — rotating a direction vector by a fixed 90° always points to
 * its "right," and "right of forward" for one direction is "left of
 * forward" for the reverse of it — so this one rule is enough to separate
 * outbound/inbound lanes with no explicit overlap detection.
 */
function offsetPolyline(points: Point[], offset: number): Point[] {
  return points.map((p, i) => {
    const prev = points[i - 1];
    const next = points[i + 1];
    let dx = 0;
    let dy = 0;
    if (prev) {
      dx += p.x - prev.x;
      dy += p.y - prev.y;
    }
    if (next) {
      dx += next.x - p.x;
      dy += next.y - p.y;
    }
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return p;
    const ux = dx / len;
    const uy = dy / len;
    // Rotate travel direction -90° (x,y) -> (y,-x) — a fixed "always the
    // right side of travel" convention, not a per-case choice.
    return { x: p.x + uy * offset, y: p.y - ux * offset };
  });
}

function ArrowMarker({ position, angleRad }: { position: Point; angleRad: number }) {
  return (
    <group position={[position.x, ROUTE_HEIGHT + 0.05, -position.y]} rotation={[0, angleRad, 0]}>
      {/* Cone's own axis defaults to Y (apex up) — rotate -90° around Z so it
          points along local +X, then the group's own rotation above turns
          that into the lane's actual travel direction (same two-step
          pattern as PathArrow in Paths.tsx). */}
      <mesh rotation={[0, 0, -Math.PI / 2]} raycast={() => null}>
        <coneGeometry args={[ARROW_RADIUS, ARROW_LENGTH, 8]} />
        <meshStandardMaterial color={ARROW_COLOR} />
      </mesh>
    </group>
  );
}

function LaneArrows({ segments }: { segments: PathSegment[] }) {
  const arrows: { position: Point; angleRad: number }[] = [];
  for (const segment of segments) {
    if (segment.length < MIN_ARROW_SEGMENT_LENGTH) continue;
    const dx = Math.cos(segment.rotationY);
    const dy = Math.sin(segment.rotationY);
    const startX = segment.position[0] - (dx * segment.length) / 2;
    const startY = -segment.position[2] - (dy * segment.length) / 2;
    const count = Math.max(1, Math.floor(segment.length / ARROW_SPACING));
    for (let i = 0; i < count; i++) {
      const dist = (i + 0.5) * (segment.length / count);
      arrows.push({ position: { x: startX + dx * dist, y: startY + dy * dist }, angleRad: segment.rotationY });
    }
  }
  return (
    <>
      {arrows.map((arrow, i) => (
        <ArrowMarker key={i} position={arrow.position} angleRad={arrow.angleRad} />
      ))}
    </>
  );
}

/** One leg's lane: its own offset polyline (see offsetPolyline), rendered with Paths.tsx's segment/joint treatment plus periodic direction arrows. */
function LegLane({ points }: { points: Point[] }) {
  const offsetPoints = useMemo(() => offsetPolyline(points, LANE_OFFSET), [points]);
  const segments = useMemo(() => segmentsForPath(offsetPoints, ROUTE_HEIGHT), [offsetPoints]);

  return (
    <>
      {segments.map((segment, i) => (
        <mesh key={i} position={segment.position} rotation={[0, segment.rotationY, 0]} raycast={() => null}>
          <boxGeometry args={[segment.length, ROUTE_HEIGHT, ROUTE_WIDTH]} />
          <meshStandardMaterial color={ROUTE_COLOR} />
        </mesh>
      ))}
      {offsetPoints.map((p, i) => (
        <mesh key={`joint-${i}`} position={[p.x, ROUTE_HEIGHT / 2, -p.y]} raycast={() => null}>
          <cylinderGeometry args={[JOINT_RADIUS, JOINT_RADIUS, ROUTE_HEIGHT, 16]} />
          <meshStandardMaterial color={ROUTE_COLOR} />
        </mesh>
      ))}
      <LaneArrows segments={segments} />
    </>
  );
}

// Numbered so the visit order is legible even in static mode, where nothing
// actually moves. depthTest disabled so a number is never hidden behind a
// tall pallet stack or another lane — "above everything else."
function StopMarkers({ points }: { points: Point[] }) {
  return (
    <>
      {points.map((p, i) => (
        <group key={i} position={[p.x, 0, -p.y]}>
          <mesh position={[0, MARKER_HEIGHT / 2, 0]} raycast={() => null}>
            <cylinderGeometry args={[MARKER_RADIUS, MARKER_RADIUS, MARKER_HEIGHT, 20]} />
            <meshStandardMaterial color={MARKER_COLOR} depthTest={false} />
          </mesh>
          <Text
            position={[0, MARKER_LABEL_HEIGHT, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.5}
            color="#ffffff"
            outlineWidth={0.03}
            outlineColor="#1d4ed8"
            anchorX="center"
            anchorY="middle"
            renderOrder={999}
            material-depthTest={false}
          >
            {i + 1}
          </Text>
        </group>
      ))}
    </>
  );
}

/** Walks a leg's (offset) polyline to the point `distance` meters along it, and the travel-direction angle there (for facing the vehicle). */
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
  const run = simulation.activeRun;
  // Recomputed only when the run itself changes (every leg transition
  // produces a new activeRun object already, via setActiveRun), not every
  // frame — the vehicle rides the same offset lane the route highlight
  // draws.
  const offsetLegPoints = useMemo(() => {
    if (!run || run.mode !== "animated" || run.currentLegIndex >= run.legs.length) return null;
    return offsetPolyline(run.legs[run.currentLegIndex].points, LANE_OFFSET);
  }, [run]);

  useFrame((_, delta) => {
    const run = simulation.activeRun;
    if (!run || run.mode !== "animated" || run.isPaused || run.currentLegIndex >= run.legs.length) return;
    const leg: Leg = run.legs[run.currentLegIndex];
    simulation.progressRef.current += simulation.speed * delta;
    if (simulation.progressRef.current >= leg.length) {
      simulation.goToStep(run.currentLegIndex + 1);
      return; // next frame picks up the new leg (or stops) fresh
    }
    if (!offsetLegPoints) return;
    const { point, angleRad } = pointAtDistance(offsetLegPoints, simulation.progressRef.current);
    groupRef.current?.position.set(point.x, 0, -point.y);
    groupRef.current?.rotation.set(0, angleRad, 0);
  });

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
      {run.legs.map((leg, i) => (
        <LegLane key={i} points={leg.points} />
      ))}
      <StopMarkers points={stopPoints} />
      <Vehicle />
    </group>
  );
}
