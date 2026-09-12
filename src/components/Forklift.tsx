import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { Point } from "../types/warehouse";
import { useEditor } from "../state/EditorContext";
import { useSimulation, heldPalletsAt, type Leg } from "../state/SimulationContext";
import { useLayers } from "../state/LayerContext";
import { offsetPolyline } from "../lib/offset";
import { segmentsForPath, type PathSegment } from "./Paths";

// Orange — a distinct accent from the black infrastructure paths (Paths.tsx)
// so a picking-list route reads as a temporary overlay, not fixed layout.
const ROUTE_COLOR = "#f97316";
// Above PATH_HEIGHT (0.04) so the route overlay never z-fights with the
// infrastructure paths it often runs alongside or directly over.
const ROUTE_HEIGHT = 0.1;
const ROUTE_WIDTH = 0.28;
const JOINT_RADIUS = ROUTE_WIDTH / 2;
// How far a lane is shifted off the path's true centerline, perpendicular to
// its own travel direction — so a leg traveled one way and a later leg
// backtracking over the same corridor render as two separate parallel
// lanes instead of one merged line (per user feedback). Offsetting is
// always applied (every lane sits a little off-center, even one traveled
// only once) so the rule is uniform rather than conditional on detecting an
// actual overlap.
const LANE_OFFSET = 0.55;
// Caps how far a corner's offset point can be pushed out along the miter
// bisector, as a multiple of LANE_OFFSET. Without a cap, a joint between a
// short segment (e.g. a slot notch) and a long one — or any near-reversal
// turn — can push the miter point well past the corridor's true footprint,
// which is exactly the "extends past the strict minimum" artifact from
// user feedback. Past the cap, the join falls back to the incoming
// segment's own perpendicular (a bevel-ish join) instead of a sharp miter.
const MITER_LIMIT = 2;

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

// Deliberately blocky: a handful of boxes and cylinders, no bevels or
// detail meshes. At the zoom levels this is read from, silhouette is all
// that survives anyway, and the twin is about layout and flow rather than
// vehicle modelling. Local axes: +X is forward (travel direction), +Y up,
// Z across.
const BODY_COLOR = "#facc15"; // yellow — distinct from the amber "partial pallet" fill
const METAL_COLOR = "#94a3b8";
const WHEEL_COLOR = "#1f2937";

const BODY_LENGTH = 0.85;
const BODY_HEIGHT = 0.5;
const BODY_WIDTH = 0.8;
const BODY_CENTER_X = -0.2;
const BODY_CENTER_Y = 0.46;

const CAB_HEIGHT = 0.42;

const MAST_X = 0.32;
const MAST_HEIGHT = 1.05;
const MAST_THICKNESS = 0.09;
const MAST_WIDTH = 0.62;

const FORK_LENGTH = 0.62;
const FORK_THICKNESS = 0.05;
const FORK_WIDTH = 0.13;
const FORK_Y = 0.12;
const FORK_SPACING = 0.2; // half-distance between the two forks
const FORK_TIP_X = MAST_X + FORK_LENGTH / 2 + MAST_THICKNESS / 2;

const WHEEL_RADIUS = 0.17;
const WHEEL_THICKNESS = 0.12;
const WHEEL_X = 0.3;
const WHEEL_Z = 0.37;

// Carried pallets ride the forks, stacked upward in the order picked.
const CARRIED_PALLET_COLOR = "#dc2626";
const CARRIED_PALLET_SIZE: [number, number, number] = [0.5, 0.18, 0.5];
const CARRIED_PALLET_GAP = 0.04;

// Exhaust puffs behind the rear wheels — only while actually driving.
const SMOKE_COUNT = 3;
const SMOKE_PERIOD = 0.75; // seconds for one puff to rise and fade
const SMOKE_COLOR = "#cbd5e1";
const SMOKE_START_X = -0.62;

// Hover highlight for the leg arriving at the operations row under the
// cursor — wider than the lane it traces and sitting just above it, so it
// reads as a halo around that ribbon rather than replacing it.
const BLINK_COLOR = "#facc15";
const BLINK_WIDTH = ROUTE_WIDTH * 2.4;
const BLINK_ELEVATION = ROUTE_HEIGHT + 0.02;
const BLINK_PERIOD = 0.9; // seconds per pulse — matches StepBlink's column

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
  const offsetPoints = useMemo(() => offsetPolyline(points, LANE_OFFSET, MITER_LIMIT), [points]);
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

/**
 * Pulses the leg that arrives at whichever operations row is hovered — the
 * path counterpart to StepBlink's column over the place itself, so a row
 * answers both "where" and "how it got there". Rides the same offset lane
 * the route draws (so it highlights the actual drawn ribbon), sits just
 * above it, and renders regardless of the Route layer: it's a transient
 * hover affordance, not part of the layer model.
 */
function HoveredLegBlink() {
  const simulation = useSimulation();
  const materialRefs = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const run = simulation.activeRun;
  const legIndex = simulation.hoveredStep?.legIndex ?? null;

  const segments = useMemo(() => {
    if (!run || legIndex === null || legIndex < 0 || legIndex >= run.legs.length) return null;
    const offset = offsetPolyline(run.legs[legIndex].points, LANE_OFFSET, MITER_LIMIT);
    return segmentsForPath(offset, ROUTE_HEIGHT);
  }, [run, legIndex]);

  useFrame(({ clock }) => {
    const phase = (Math.sin((clock.elapsedTime / BLINK_PERIOD) * Math.PI * 2) + 1) / 2;
    const opacity = 0.3 + phase * 0.7;
    // Every segment of the leg carries its own material instance, so they
    // all have to be written for the leg to pulse as one ribbon.
    for (const material of materialRefs.current) {
      if (material) material.opacity = opacity;
    }
  });

  if (!segments) return null;

  return (
    <group>
      {segments.map((segment, i) => (
        <mesh
          key={i}
          position={[segment.position[0], BLINK_ELEVATION, segment.position[2]]}
          rotation={[0, segment.rotationY, 0]}
          raycast={() => null}
        >
          <boxGeometry args={[segment.length, ROUTE_HEIGHT, BLINK_WIDTH]} />
          <meshStandardMaterial
            ref={(el) => {
              materialRefs.current[i] = el;
            }}
            color={BLINK_COLOR}
            transparent
            opacity={0.8}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
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

/**
 * `visible` hides the vehicle's meshes without unmounting the component,
 * because its useFrame is what actually advances the run — a hidden
 * forklift still has to drive, or turning the Route layer off mid-queue
 * would silently freeze the simulation instead of just hiding it.
 */
function Vehicle({ visible }: { visible: boolean }) {
  const simulation = useSimulation();
  const groupRef = useRef<THREE.Group>(null);
  // Whether the truck actually advanced this frame — drives the exhaust
  // puffs. A ref, not state: it changes every frame and nothing but the
  // smoke's own useFrame needs to read it.
  const movingRef = useRef(false);
  const run = simulation.activeRun;
  // Recomputed only when the run itself changes (every leg transition
  // produces a new activeRun object already, via setActiveRun), not every
  // frame — the vehicle rides the same offset lane the route highlight
  // draws.
  const offsetLegPoints = useMemo(() => {
    if (!run || run.mode !== "animated" || run.currentLegIndex >= run.legs.length) return null;
    return offsetPolyline(run.legs[run.currentLegIndex].points, LANE_OFFSET, MITER_LIMIT);
  }, [run]);

  useFrame((_, delta) => {
    const run = simulation.activeRun;
    if (!run || run.mode !== "animated" || run.currentLegIndex >= run.legs.length) {
      movingRef.current = false;
      return;
    }
    const leg: Leg = run.legs[run.currentLegIndex];

    if (run.isPaused) {
      movingRef.current = false;
    } else {
      movingRef.current = true;
      // A Next-step fast-forward overrides the run's own speed until the leg
      // it was fired on completes (see SimulationContext.nextStep) — goToStep
      // clears the ref on arrival, so the following leg is back to normal.
      const speed = simulation.fastForwardSpeedRef.current ?? simulation.speed;
      simulation.progressRef.current += speed * delta;
      if (simulation.progressRef.current >= leg.length) {
        simulation.goToStep(run.currentLegIndex + 1);
        return; // next frame picks up the new leg (or stops) fresh
      }
    }

    // Positioning happens even while paused: jumping to a step (from the
    // operations list or the transport bar) only changes which leg and how
    // far along it we are, and the vehicle has to follow that immediately —
    // otherwise it sits wherever it was last drawn until playback resumes.
    if (!offsetLegPoints) return;
    const { point, angleRad } = pointAtDistance(offsetLegPoints, simulation.progressRef.current);
    groupRef.current?.position.set(point.x, 0, -point.y);
    groupRef.current?.rotation.set(0, angleRad, 0);
  });

  if (!visible || !run || run.mode !== "animated" || run.currentLegIndex >= run.legs.length) return null;

  const carried = heldPalletsAt(run, run.currentLegIndex);

  return (
    <group ref={groupRef}>
      <ForkliftModel carried={carried} />
      <Smoke movingRef={movingRef} />
    </group>
  );
}

/** The vehicle itself — see the constants above for the deliberately blocky construction. */
function ForkliftModel({ carried }: { carried: number }) {
  return (
    <group>
      {/* Counterweight body + the cab block stacked on its rear half. */}
      <mesh position={[BODY_CENTER_X, BODY_CENTER_Y, 0]} raycast={() => null}>
        <boxGeometry args={[BODY_LENGTH, BODY_HEIGHT, BODY_WIDTH]} />
        <meshStandardMaterial color={BODY_COLOR} />
      </mesh>
      <mesh
        position={[BODY_CENTER_X - 0.12, BODY_CENTER_Y + BODY_HEIGHT / 2 + CAB_HEIGHT / 2, 0]}
        raycast={() => null}
      >
        <boxGeometry args={[BODY_LENGTH * 0.55, CAB_HEIGHT, BODY_WIDTH * 0.8]} />
        <meshStandardMaterial color={BODY_COLOR} />
      </mesh>

      {/* Mast: the upright the forks hang off. */}
      <mesh position={[MAST_X, MAST_HEIGHT / 2, 0]} raycast={() => null}>
        <boxGeometry args={[MAST_THICKNESS, MAST_HEIGHT, MAST_WIDTH]} />
        <meshStandardMaterial color={METAL_COLOR} metalness={0.6} roughness={0.4} />
      </mesh>

      {/* The two forks. */}
      {[-FORK_SPACING, FORK_SPACING].map((z) => (
        <mesh key={z} position={[FORK_TIP_X, FORK_Y, z]} raycast={() => null}>
          <boxGeometry args={[FORK_LENGTH, FORK_THICKNESS, FORK_WIDTH]} />
          <meshStandardMaterial color={METAL_COLOR} metalness={0.6} roughness={0.4} />
        </mesh>
      ))}

      {/* Four wheels — cylinders laid on their side (their own axis is Y, so
          a quarter turn about X points it across the vehicle). */}
      {[
        [WHEEL_X, WHEEL_Z],
        [WHEEL_X, -WHEEL_Z],
        [-WHEEL_X, WHEEL_Z],
        [-WHEEL_X, -WHEEL_Z],
      ].map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x, WHEEL_RADIUS, z]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
          <cylinderGeometry args={[WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_THICKNESS, 8]} />
          <meshStandardMaterial color={WHEEL_COLOR} />
        </mesh>
      ))}

      {/* Whatever it's currently hauling, stacked on the forks. */}
      {Array.from({ length: carried }, (_, i) => (
        <mesh
          key={i}
          position={[
            FORK_TIP_X,
            FORK_Y + FORK_THICKNESS / 2 + CARRIED_PALLET_SIZE[1] / 2 + i * (CARRIED_PALLET_SIZE[1] + CARRIED_PALLET_GAP),
            0,
          ]}
          raycast={() => null}
        >
          <boxGeometry args={CARRIED_PALLET_SIZE} />
          <meshStandardMaterial color={CARRIED_PALLET_COLOR} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Cartoon exhaust behind the rear wheels. Each puff runs the same rise-and-
 * fade cycle on its own offset phase, and the whole thing is hidden the
 * moment the forklift stops — so it reads as a motion cue rather than
 * decoration, and a truck paused at a slot isn't left idling smoke.
 */
function Smoke({ movingRef }: { movingRef: MutableRefObject<boolean> }) {
  const groupRef = useRef<THREE.Group>(null);
  const puffRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    group.visible = movingRef.current;
    if (!group.visible) return;

    puffRefs.current.forEach((puff, i) => {
      if (!puff) return;
      const phase = ((clock.elapsedTime + (i * SMOKE_PERIOD) / SMOKE_COUNT) % SMOKE_PERIOD) / SMOKE_PERIOD;
      puff.position.set(SMOKE_START_X - phase * 0.5, 0.22 + phase * 0.35, 0);
      const scale = 0.06 + phase * 0.16;
      puff.scale.setScalar(scale);
      const material = puff.material as THREE.MeshStandardMaterial;
      material.opacity = (1 - phase) * 0.45;
    });
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: SMOKE_COUNT }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            puffRefs.current[i] = el;
          }}
          raycast={() => null}
        >
          {/* An 8-sided sphere: round enough to read as a puff, blocky
              enough to match the rest of the vehicle. */}
          <sphereGeometry args={[1, 6, 4]} />
          <meshStandardMaterial color={SMOKE_COLOR} transparent opacity={0.4} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

export function Forklift() {
  const { mode } = useEditor();
  const simulation = useSimulation();
  const { isVisible } = useLayers();
  const run = simulation.activeRun;
  // View-mode only — this is simulation overlay, not part of the physical
  // layout being edited. Unmounting (rather than just hiding) also pauses
  // an in-progress animated run: Vehicle's useFrame stops advancing
  // progressRef entirely while unmounted, so switching back to view mode
  // resumes exactly where it left off instead of having silently kept
  // ticking in the background.
  if (mode !== "view" || !run || run.legs.length === 0) return null;

  // The Route layer hides the drawn route, not the run itself — Vehicle
  // stays mounted either way (see its doc comment).
  const showRoute = isVisible("route");
  const stopPoints: Point[] = [run.legs[0].points[0], ...run.legs.map((leg) => leg.points[leg.points.length - 1])];

  return (
    <group>
      {showRoute &&
        run.legs.map((leg, i) => <LegLane key={i} points={leg.points} />)}
      {showRoute && <StopMarkers points={stopPoints} />}
      <HoveredLegBlink />
      <Vehicle visible={showRoute} />
    </group>
  );
}
