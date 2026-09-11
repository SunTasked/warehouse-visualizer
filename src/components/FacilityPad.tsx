import { Text } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { useEditor } from "../state/EditorContext";
import { useViewFocus } from "../state/ViewFocusContext";

const PAD_EDGE_COLOR = "#000000";

/**
 * Shared box+edges+label rendering for a fixed-footprint facility element
 * (lift station, delivery space, ...) — same visual pattern as Slots.tsx's
 * pad+edges+Text, just without an entry marker or sub-slots. Kept as one
 * shared component (rather than duplicated per element type) since the only
 * difference between a lift station and a delivery space is color/label —
 * each still gets its own top-level type/component/file per the project's
 * one-concept-per-file convention, this is just their shared innards.
 */
export function FacilityPad({
  x,
  y,
  rotationDeg,
  width,
  depth,
  height,
  color,
  label,
  labelColor = "#ffffff",
  buildingId,
  description,
}: {
  x: number;
  y: number;
  rotationDeg?: number;
  width: number;
  depth: number;
  height: number;
  color: string;
  label: string;
  labelColor?: string;
  buildingId: string;
  /** Shown in an HTML tooltip on hover (view mode only) — see FacilityTooltip.tsx. */
  description: string;
}) {
  const { mode } = useEditor();
  const { focus, setHover, focusWarehouse, back } = useViewFocus();
  const geometry = useMemo(() => new THREE.BoxGeometry(width, height, depth), [width, depth, height]);
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);
  const rotationRad = THREE.MathUtils.degToRad(rotationDeg ?? 0);

  // Hoverable (tooltip) and click-passthrough in view mode; otherwise inert,
  // same as every other physical-layer decoration. Passthrough mirrors what
  // clicking *through* this pad to whatever's beneath would have done before
  // hover made it raycastable: focus this building at "plant" level (like
  // the floor beneath it — see Walls.tsx's BuildingFloor), or back() out at
  // any deeper level (like empty floor). Needed because once a mesh is
  // raycastable, being "hit" (even with no handler) is enough to suppress
  // the Canvas's onPointerMissed, so without this the pad would silently
  // swallow clicks that used to fall through.
  const interactive = mode === "view";
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!interactive) return;
    e.stopPropagation();
    if (focus.level === "plant") focusWarehouse(buildingId);
    else back();
  };
  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    if (!interactive) return;
    e.stopPropagation();
    setHover({ facility: { id: label, description }, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
  };
  const handlePointerOut = () => {
    if (interactive) setHover(null);
  };

  return (
    <group position={[x, 0, -y]} rotation={[0, rotationRad, 0]}>
      <mesh
        geometry={geometry}
        position={[0, height / 2, 0]}
        raycast={interactive ? undefined : () => null}
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerMove={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <meshStandardMaterial color={color} />
      </mesh>
      {/* Decorative outline, same raycast opt-out as Slots.tsx's edge outline
          (see that file's comment on the Three.js line-raycast threshold gotcha). */}
      <lineSegments geometry={edges} position={[0, height / 2, 0]} raycast={() => null}>
        <lineBasicMaterial color={PAD_EDGE_COLOR} />
      </lineSegments>
      <Text
        position={[0, height + 0.05, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.5}
        color={labelColor}
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
    </group>
  );
}
