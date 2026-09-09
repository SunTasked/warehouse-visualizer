import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useMemo } from "react";
import type { Pallet } from "../types/warehouse";
import { useEditor } from "../state/EditorContext";
import { useViewFocus } from "../state/ViewFocusContext";
import { subSlotEmphasis, palletEmphasis, emphasisColor } from "../lib/emphasis";

// Visual constants for the pallet-rack + tire-stack representation (schematic,
// not to real-world tire scale — see specs.md §5.1 "Storage subdivision").
export const LEVEL_HEIGHT = 1;
// The rack's rendered footprint is inset from the full cell so adjacent
// sub-slots' racks never touch — reused by focusBounds.ts to frame a
// sub-slot/pallet tightly around what's actually drawn.
export const RACK_MARGIN_FACTOR = 0.85;
const POST_SIZE = 0.06;
const RAIL_THICKNESS = 0.05;
const RACK_COLOR = "#2a52c9";
const TIRE_COLOR = "#171717";
const TIRE_ROUGHNESS = 0.85;

// A closed rectangle of rails at one level boundary, connecting all four
// corner posts — reads as one physical, operable shelf rather than two
// floating bars.
function RailFrame({
  y,
  halfWidth,
  halfDepth,
  color,
}: {
  y: number;
  halfWidth: number;
  halfDepth: number;
  color: string;
}) {
  const lengthwise = useMemo(
    () => new THREE.BoxGeometry(halfWidth * 2, RAIL_THICKNESS, RAIL_THICKNESS),
    [halfWidth],
  );
  const crosswise = useMemo(
    () => new THREE.BoxGeometry(RAIL_THICKNESS, RAIL_THICKNESS, halfDepth * 2),
    [halfDepth],
  );
  return (
    <>
      <mesh geometry={lengthwise} position={[0, y, -halfDepth]}>
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh geometry={lengthwise} position={[0, y, halfDepth]}>
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh geometry={crosswise} position={[-halfWidth, y, 0]}>
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh geometry={crosswise} position={[halfWidth, y, 0]}>
        <meshStandardMaterial color={color} />
      </mesh>
    </>
  );
}

// Tires resize to always span the full pallet width, from one edge to the
// other — a partial pallet has fewer, larger-spaced tires rather than a
// half-empty row.
function TireRow({
  y,
  halfWidth,
  pallet,
  color,
}: {
  y: number;
  halfWidth: number;
  pallet: Pallet;
  color: string;
}) {
  const count = pallet.items.length;
  const spacing = (halfWidth * 2) / Math.max(count, 1);
  const tireRadius = Math.min(spacing, LEVEL_HEIGHT) * 0.42;
  const tubeRadius = tireRadius * 0.35;
  const geometry = useMemo(
    () => new THREE.TorusGeometry(tireRadius, tubeRadius, 10, 20),
    [tireRadius, tubeRadius],
  );
  if (count === 0) return null;
  return (
    <>
      {pallet.items.map((item, i) => {
        const x = -halfWidth + spacing * (i + 0.5);
        return (
          <mesh
            key={item.id}
            geometry={geometry}
            position={[x, y + tireRadius + 0.03, 0]}
            rotation={[0, Math.PI / 2, 0]}
          >
            <meshStandardMaterial color={color} roughness={TIRE_ROUGHNESS} />
          </mesh>
        );
      })}
    </>
  );
}

/**
 * Renders one sub-slot's storage content: a rack frame sized to the cell
 * footprint, with `pallets.length` tiers stacked vertically (bottom-up), each
 * tier showing its items as a row of tires laid side by side along the
 * cell's width. Cell-local coordinates — position the whole group at the
 * sub-slot's center in the parent (see Slots.tsx). `slotId`/`subSlotIndex`
 * identify this rack for the view-mode focus drill-down (dimming + click to
 * select a pallet tier, only reachable once this sub-slot itself is focused).
 */
export function Rack({
  slotId,
  subSlotIndex,
  cellWidth,
  cellDepth,
  pallets,
}: {
  slotId: string;
  subSlotIndex: number;
  cellWidth: number;
  cellDepth: number;
  pallets: Pallet[];
}) {
  const { mode } = useEditor();
  const { focus, focusPallet } = useViewFocus();
  const halfWidth = (cellWidth / 2) * RACK_MARGIN_FACTOR;
  const halfDepth = (cellDepth / 2) * RACK_MARGIN_FACTOR;
  const totalHeight = pallets.length * LEVEL_HEIGHT;
  const postGeometry = useMemo(
    () => new THREE.BoxGeometry(POST_SIZE, totalHeight, POST_SIZE),
    [totalHeight],
  );
  const hitBoxGeometry = useMemo(
    () => new THREE.BoxGeometry(halfWidth * 2, LEVEL_HEIGHT, halfDepth * 2),
    [halfWidth, halfDepth],
  );
  const corners: [number, number][] = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [-halfWidth, halfDepth],
    [halfWidth, halfDepth],
  ];

  if (pallets.length === 0) return null;

  const frameColor = emphasisColor(RACK_COLOR, subSlotEmphasis(focus, slotId, subSlotIndex));

  return (
    <group>
      {corners.map(([cx, cz]) => (
        <mesh key={`${cx}-${cz}`} geometry={postGeometry} position={[cx, totalHeight / 2, cz]}>
          <meshStandardMaterial color={frameColor} />
        </mesh>
      ))}
      {Array.from({ length: pallets.length + 1 }).map((_, level) => (
        <RailFrame
          key={level}
          y={level * LEVEL_HEIGHT}
          halfWidth={halfWidth}
          halfDepth={halfDepth}
          color={frameColor}
        />
      ))}
      {pallets.map((pallet, level) => {
        const tireColor = emphasisColor(TIRE_COLOR, palletEmphasis(focus, slotId, subSlotIndex, level));
        const handlePalletPointerDown = (e: ThreeEvent<PointerEvent>) => {
          // Reachable once this pallet's own sub-slot is focused (at any
          // drill-down level) — mirrors the slot -> sub-slot -> pallet order.
          if (mode !== "view" || focus.slotId !== slotId || focus.subSlotIndex !== subSlotIndex) return;
          e.stopPropagation();
          focusPallet(slotId, subSlotIndex, level);
        };
        return (
          <group key={pallet.id} onPointerDown={handlePalletPointerDown}>
            {/* Invisible hit target spanning the whole tier — clicking a
                sparse tire row shouldn't require pixel-perfect aim. */}
            <mesh geometry={hitBoxGeometry} position={[0, level * LEVEL_HEIGHT + LEVEL_HEIGHT / 2, 0]}>
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            <TireRow y={level * LEVEL_HEIGHT} halfWidth={halfWidth} pallet={pallet} color={tireColor} />
          </group>
        );
      })}
    </group>
  );
}
