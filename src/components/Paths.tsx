import { Text } from "@react-three/drei";
import { useMemo } from "react";
import type { Path, Point } from "../types/warehouse";
import { useViewFocus, type Focus } from "../state/ViewFocusContext";
import { useSimulation } from "../state/SimulationContext";
import { useLayers } from "../state/LayerContext";
import { isAnyBuildingVisible } from "../lib/visibility";
import { nodeKey } from "../lib/pathGraph";
import { rightOf } from "../lib/offset";
import { usageColor, usageRange } from "../lib/usageColor";

// Black — reads as a painted floor marking, distinct from the pallet
// fill-rate colors (Rack.tsx's PALLET_FULL_COLOR/PALLET_PARTIAL_COLOR) so a
// corridor never reads as stock.
const PATH_COLOR = "#000000";
const PATH_HEIGHT = 0.04;
const PATH_DEFAULT_WIDTH = 1.0;
// Radius-matching disc rendered at every vertex, so a turn reads as a
// smooth rounded corner instead of the square notch left where two
// perpendicular-cut box segments meet at an angle.
const JOINT_RADIUS_FACTOR = 0.5; // of the path's own width
// How far a cross-building connector's stub reaches into view once the
// building on its far side is hidden (see effectiveView() below).
const STUB_LENGTH = 1.5;
const ARROW_RADIUS = 0.35;
const ARROW_LENGTH = 0.7;

// A segment with any recorded travel (either direction) splits into two
// parallel directional lanes instead of one centered box — the picking-list
// usage heat-map (§5.3). An untraveled segment keeps the original single
// centered look unchanged, so the vast majority of the network (most demo
// runs only ever touch a handful of corridors) isn't visually disrupted by a
// feature that has nothing to show there yet.
const LANE_WIDTH = 0.45;
const LANE_OFFSET = 0.32;
const LANE_JOINT_RADIUS = LANE_WIDTH / 2;
// Heatmap lanes sit above the corridor layer rather than in its plane. A
// measured segment replaces its own corridor, but neighbouring paths still
// cross it (and a crossing path's own box would otherwise z-fight with, or
// simply cover, the coloring) — so the measurement always wins on top.
const LANE_ELEVATION = 0.055;
// A lane whose own direction was never traveled (only the *other* direction
// of that same segment was) — muted gray, not on the green-red scale at
// all, so "never taken this way" reads as visually distinct from "taken the
// fewest times" (green).
const NEUTRAL_LANE_COLOR = "#94a3b8";

// Count labels (the "label with counts" layer option) float just above the
// lane they annotate, depth-test off so a rack never swallows them.
const LABEL_HEIGHT = 0.6;
const LABEL_SIZE = 0.55;
// Shorter than this and the count would overhang the lane it belongs to,
// reading as if it labelled the neighbouring corridor instead.
const MIN_LABEL_SEGMENT_LENGTH = 1.6;

export interface PathSegment {
  position: [number, number, number];
  rotationY: number;
  length: number;
}

// Same length/angle/midpoint math as Walls.tsx's segmentsForLoop — a path is
// just an open (not closed) polyline rendered flat at floor level instead of
// at wall height. Exported (with the height parameterized rather than
// hardcoded) so Forklift.tsx can reuse it for the picking-list route
// highlight at its own height, instead of duplicating this math.
export function segmentsForPath(points: Point[], height: number): PathSegment[] {
  const segments: PathSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    segments.push({
      position: [(p1.x + p2.x) / 2, height / 2, -(p1.y + p2.y) / 2],
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
  /** Set only when `points` is a truncated cross-building stub: which original path.points segment index (into the *untruncated* path) it's standing in for — needed to look up that real edge's usage counts, since the stub's own (synthetic, partial) coordinates aren't real graph nodes. */
  stubOriginalIndex?: number;
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
    stubOriginalIndex: nearIsStart ? 0 : points.length - 2,
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

interface SegmentUsage {
  forward: number;
  backward: number;
}

function segmentUsage(path: Path, originalIndex: number, edgeUsage: Record<string, number>): SegmentUsage {
  const a = path.points[originalIndex];
  const b = path.points[originalIndex + 1];
  return {
    forward: edgeUsage[`${nodeKey(a)}→${nodeKey(b)}`] ?? 0,
    backward: edgeUsage[`${nodeKey(b)}→${nodeKey(a)}`] ?? 0,
  };
}

/** One directional lane's box + its own two end-cap joints, offset a fixed distance from a single (2-point) segment's own centerline. Independent per segment (not blended with neighbors) — simple and robust, at the cost of a small gap/overlap with an adjoining hot segment's own lanes at a turn, an acceptable trade for a heat-map overlay. */
function UsageLane({
  a,
  b,
  offset,
  color,
  count,
  showLabel,
}: {
  a: Point;
  b: Point;
  offset: number;
  color: string;
  count: number;
  showLabel: boolean;
}) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const perp = rightOf(dx / len, dy / len);
  const laneA: Point = { x: a.x + perp.x * offset, y: a.y + perp.y * offset };
  const laneB: Point = { x: b.x + perp.x * offset, y: b.y + perp.y * offset };
  const [segment] = segmentsForPath([laneA, laneB], PATH_HEIGHT);
  // Only a lane that was actually traveled, and is long enough to hold the
  // text without it spilling over the neighbouring corridor, gets a count.
  const labelled = showLabel && count > 0 && segment.length >= MIN_LABEL_SEGMENT_LENGTH;
  return (
    <>
      <mesh
        position={[segment.position[0], LANE_ELEVATION, segment.position[2]]}
        rotation={[0, segment.rotationY, 0]}
        raycast={() => null}
      >
        <boxGeometry args={[segment.length, PATH_HEIGHT, LANE_WIDTH]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {[laneA, laneB].map((p, i) => (
        <mesh key={i} position={[p.x, LANE_ELEVATION, -p.y]} raycast={() => null}>
          <cylinderGeometry args={[LANE_JOINT_RADIUS, LANE_JOINT_RADIUS, PATH_HEIGHT, 16]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ))}
      {labelled && (
        <Text
          position={[(laneA.x + laneB.x) / 2, LABEL_HEIGHT, -(laneA.y + laneB.y) / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={LABEL_SIZE}
          color="#111827"
          outlineWidth={0.05}
          outlineColor="#ffffff"
          anchorX="center"
          anchorY="middle"
          renderOrder={999}
          material-depthTest={false}
        >
          {count}
        </Text>
      )}
    </>
  );
}

function PathMesh({
  path,
  focus,
  edgeUsage,
  range,
  showPaths,
  showHeatmap,
  labelCounts,
}: {
  path: Path;
  focus: Focus;
  edgeUsage: Record<string, number>;
  range: { min: number; max: number } | null;
  showPaths: boolean;
  showHeatmap: boolean;
  labelCounts: boolean;
}) {
  const width = path.width ?? PATH_DEFAULT_WIDTH;
  const view = useMemo(() => effectiveView(path, focus), [path, focus.buildingId]);
  const segments = useMemo(() => segmentsForPath(view.points, PATH_HEIGHT), [view.points]);
  const jointRadius = width * JOINT_RADIUS_FACTOR;

  const originalIndexFor = (i: number) => (view.stubOriginalIndex !== undefined ? view.stubOriginalIndex : i);
  const usageFor = (i: number) => segmentUsage(path, originalIndexFor(i), edgeUsage);
  const laneColor = (count: number) => (count > 0 && range ? usageColor(count, range.min, range.max) : NEUTRAL_LANE_COLOR);

  // A segment renders EITHER as the plain corridor OR as its two directional
  // heatmap lanes — never both. Stacking the lanes on top of the corridor
  // they measure was the single worst source of the "a lot of data on top of
  // another" clutter: one aisle could end up carrying a black centerline,
  // two usage lanes and a route lane at once. With the heatmap layer on, the
  // measured segments *become* the coloring and only untraveled ones keep
  // the plain corridor (as context, and only if the Paths layer is on too).
  const isHot = (i: number) => {
    const usage = usageFor(i);
    return showHeatmap && usage.forward + usage.backward > 0;
  };

  // A classic rounded joint only belongs where plain corridor meets plain
  // corridor — a hot segment draws its own lane end caps instead.
  const plainJointAt = (i: number) => {
    if (!showPaths) return false;
    const prevPlain = i > 0 ? !isHot(i - 1) : true;
    const nextPlain = i < segments.length ? !isHot(i) : true;
    return prevPlain && nextPlain;
  };
  const plainJoints = (view.arrow ? view.points.slice(0, -1) : view.points).filter((_, i) => plainJointAt(i));

  return (
    <>
      {segments.map((segment, i) => {
        if (!isHot(i)) {
          if (!showPaths) return null;
          return (
            <mesh key={i} position={segment.position} rotation={[0, segment.rotationY, 0]} raycast={() => null}>
              <boxGeometry args={[segment.length, PATH_HEIGHT, width]} />
              <meshStandardMaterial color={PATH_COLOR} />
            </mesh>
          );
        }
        const usage = usageFor(i);
        return (
          <group key={i}>
            <UsageLane
              a={view.points[i]}
              b={view.points[i + 1]}
              offset={LANE_OFFSET}
              color={laneColor(usage.forward)}
              count={usage.forward}
              showLabel={labelCounts}
            />
            <UsageLane
              a={view.points[i]}
              b={view.points[i + 1]}
              offset={-LANE_OFFSET}
              color={laneColor(usage.backward)}
              count={usage.backward}
              showLabel={labelCounts}
            />
          </group>
        );
      })}
      {plainJoints.map((p, i) => (
        <mesh key={`joint-${i}`} position={[p.x, PATH_HEIGHT / 2, -p.y]} raycast={() => null}>
          <cylinderGeometry args={[jointRadius, jointRadius, PATH_HEIGHT, 16]} />
          <meshStandardMaterial color={PATH_COLOR} />
        </mesh>
      ))}
      {showPaths && view.arrow && <PathArrow arrow={view.arrow} />}
    </>
  );
}

export function Paths({ paths }: { paths: Path[] }) {
  const { focus } = useViewFocus();
  const simulation = useSimulation();
  const { isVisible, labelCounts } = useLayers();
  const range = useMemo(() => usageRange(simulation.edgeUsage), [simulation.edgeUsage]);

  const showPaths = isVisible("paths");
  const showHeatmap = isVisible("pathHeatmap");
  if (!showPaths && !showHeatmap) return null;

  return (
    <group>
      {paths.map((path) => {
        if (!isAnyBuildingVisible(focus, path.buildingIds)) return null;
        return (
          <PathMesh
            key={path.id}
            path={path}
            focus={focus}
            edgeUsage={simulation.edgeUsage}
            range={range}
            showPaths={showPaths}
            showHeatmap={showHeatmap}
            labelCounts={labelCounts}
          />
        );
      })}
    </group>
  );
}
