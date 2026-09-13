import { Text } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { InaccessibleZone } from "../types/warehouse";
import { useEditor } from "../state/EditorContext";
import { useViewFocus } from "../state/ViewFocusContext";
import { isBuildingVisible } from "../lib/visibility";

const ZONE_FILL = "#d1d5db";
const HATCH_COLOR = "#6b7280";
const EDGE_COLOR = "#4b5563";
const LABEL_COLOR = "#1f2937";
// A floor marking: just above the grid and the building floor click-catcher
// (Walls.tsx, 0.005), below a slot pad's top.
const ZONE_Y = 0.02;
/** One stripe tile, in meters, so the hatching keeps the same spacing whatever the zone's size. */
const HATCH_PERIOD = 1.2;
const DESCRIPTION = "Not accessible to forklifts";

let hatchTile: HTMLCanvasElement | null = null;

/** A seamless 45° stripe tile, drawn once and shared by every zone's texture. */
function hatchCanvas(): HTMLCanvasElement {
  if (hatchTile) return hatchTile;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = ZONE_FILL;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = HATCH_COLOR;
  ctx.lineWidth = 12;
  ctx.beginPath();
  // The diagonal plus its two neighbours, so the stripe wraps across the
  // tile's corners without a seam.
  for (const offset of [-size, 0, size]) {
    ctx.moveTo(offset, size);
    ctx.lineTo(offset + size, 0);
  }
  ctx.stroke();
  hatchTile = canvas;
  return canvas;
}

function ZoneMesh({ zone }: { zone: InaccessibleZone }) {
  const { mode } = useEditor();
  const { focus, setHover, focusWarehouse, back } = useViewFocus();

  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(hatchCanvas());
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(zone.width / HATCH_PERIOD, zone.depth / HATCH_PERIOD);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [zone.width, zone.depth]);
  useEffect(() => () => texture.dispose(), [texture]);

  const outline = useMemo(() => {
    const plane = new THREE.PlaneGeometry(zone.width, zone.depth);
    const edges = new THREE.EdgesGeometry(plane);
    plane.dispose();
    return edges;
  }, [zone.width, zone.depth]);
  useEffect(() => () => outline.dispose(), [outline]);

  // A long, narrow zone (a train lane) reads its name along its length.
  const along = zone.depth > zone.width * 1.5;
  const shortSide = Math.min(zone.width, zone.depth);
  const fontSize = Math.min(2.5, Math.max(0.5, shortSide * 0.45));

  // Hover tooltip and click passthrough, exactly as a facility pad
  // (FacilityPad.tsx): focus the building from plant level, step back deeper.
  const interactive = mode === "view";
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!interactive) return;
    e.stopPropagation();
    if (focus.level === "plant") focusWarehouse(zone.buildingId);
    else back();
  };
  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    if (!interactive) return;
    e.stopPropagation();
    setHover({ facility: { id: zone.label, description: DESCRIPTION }, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
  };
  const handlePointerOut = () => {
    if (interactive) setHover(null);
  };

  return (
    <group position={[zone.x, ZONE_Y, -zone.y]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        raycast={interactive ? undefined : () => null}
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerMove={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <planeGeometry args={[zone.width, zone.depth]} />
        {/* Unlit, so the hatching reads the same from every camera angle. */}
        <meshBasicMaterial map={texture} />
      </mesh>
      <lineSegments geometry={outline} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <lineBasicMaterial color={EDGE_COLOR} />
      </lineSegments>
      <Text
        position={[0, 0.02, 0]}
        rotation={[-Math.PI / 2, 0, along ? Math.PI / 2 : 0]}
        fontSize={fontSize}
        color={LABEL_COLOR}
        outlineWidth={fontSize * 0.08}
        outlineColor="#ffffff"
        anchorX="center"
        anchorY="middle"
        raycast={() => null}
      >
        {zone.label}
      </Text>
    </group>
  );
}

/**
 * Areas of the floor no forklift enters, drawn as grey hatched markings with
 * their plan name. Part of the facilities layer; shown per building like the
 * pads.
 */
export function InaccessibleZones({ zones }: { zones: InaccessibleZone[] }) {
  const { focus } = useViewFocus();
  return (
    <group>
      {zones.map((zone) =>
        isBuildingVisible(focus, zone.buildingId) ? <ZoneMesh key={zone.id} zone={zone} /> : null,
      )}
    </group>
  );
}
