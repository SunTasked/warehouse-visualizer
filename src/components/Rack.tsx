import type { ThreeEvent } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { useMemo } from "react";
import type { Pallet } from "../types/warehouse";
import { useEditor } from "../state/EditorContext";
import { useViewFocus } from "../state/ViewFocusContext";
import { isPalletDetailed } from "../lib/visibility";

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
// Lighter blend of RACK_COLOR — "surbrillance" when hovering this sub-slot's
// rack at "slot" level (see Slots.tsx), mirroring SLOT_HOVER_COLOR's
// treatment of the slot pad itself.
const RACK_HOVER_COLOR = "#7b9bec";
const TIRE_COLOR = "#171717";
const TIRE_ROUGHNESS = 0.85;
const HOVER_LIGHTEN = 0.35;

function lighten(hex: string, amount: number): string {
  return `#${new THREE.Color(hex).lerp(new THREE.Color("#ffffff"), amount).getHexString()}`;
}
// "Block" mode (everywhere except the one pallet actually drilled into):
// a chamfered crate standing in for the real content, colored by fill rate.
// Schema caps items at 10 (warehouse.content.schema.json) — that's "full".
const PALLET_MAX_ITEMS = 10;
const PALLET_FULL_COLOR = "#dc2626";
const PALLET_PARTIAL_COLOR = "#f59e0b";
const PALLET_BLOCK_HEIGHT_FACTOR = 0.7;
const PALLET_BLOCK_INSET = 0.92;
const PALLET_BLOCK_BEVEL_FACTOR = 0.12;

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
function TireRow({ y, halfWidth, pallet }: { y: number; halfWidth: number; pallet: Pallet }) {
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
            <meshStandardMaterial color={TIRE_COLOR} roughness={TIRE_ROUGHNESS} />
          </mesh>
        );
      })}
    </>
  );
}

// Simplified stand-in for a pallet's content, shown everywhere except the
// one pallet actually drilled into (see isPalletDetailed) — a chamfered
// crate colored by fill rate rather than individual tires, so the rest of a
// sub-slot's stock stays legible without the render cost/clutter of full
// detail everywhere at once.
function PalletBlock({
  y,
  halfWidth,
  halfDepth,
  pallet,
  hovered,
}: {
  y: number;
  halfWidth: number;
  halfDepth: number;
  pallet: Pallet;
  hovered: boolean;
}) {
  const width = halfWidth * 2 * PALLET_BLOCK_INSET;
  const depth = halfDepth * 2 * PALLET_BLOCK_INSET;
  const height = LEVEL_HEIGHT * PALLET_BLOCK_HEIGHT_FACTOR;
  const radius = Math.min(width, depth, height) * PALLET_BLOCK_BEVEL_FACTOR;
  const isFull = pallet.items.length >= PALLET_MAX_ITEMS;
  const baseColor = isFull ? PALLET_FULL_COLOR : PALLET_PARTIAL_COLOR;
  const color = hovered ? lighten(baseColor, HOVER_LIGHTEN) : baseColor;
  return (
    <RoundedBox args={[width, height, depth]} radius={radius} smoothness={2} position={[0, y + height / 2 + 0.02, 0]}>
      <meshStandardMaterial color={color} />
    </RoundedBox>
  );
}

/**
 * Renders one sub-slot's storage content: a rack frame sized to the cell
 * footprint, with `pallets.length` tiers stacked vertically (bottom-up).
 * Cell-local coordinates — position the whole group at the sub-slot's
 * center in the parent (see Slots.tsx). The frame (posts/rails) is the
 * shared shelf, not a sibling in the focus hierarchy, so it always renders
 * once this sub-slot itself is visible (checked by the caller). Each tier
 * shows its real content (a row of tires) only once *that exact pallet* is
 * the deepest focus target (view mode) — every other tier renders as a
 * simplified fill-rate-colored block instead of being hidden, so the rest
 * of the sub-slot's stock stays visible for context; edit mode always shows
 * real content. `slotId`/`subSlotIndex`/`buildingId` identify this rack for
 * the view-mode focus drill-down (click a tier to select that pallet, only
 * reachable once this sub-slot itself is focused).
 */
export function Rack({
  slotId,
  subSlotIndex,
  buildingId,
  cellWidth,
  cellDepth,
  pallets,
}: {
  slotId: string;
  subSlotIndex: number;
  buildingId: string | undefined;
  cellWidth: number;
  cellDepth: number;
  pallets: Pallet[];
}) {
  const { mode } = useEditor();
  const { focus, hover, setHover, focusPallet } = useViewFocus();
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

  // Hovering this sub-slot's rack (set by Slots.tsx, only while browsing at
  // "slot" level) highlights the whole frame.
  const rackHovered =
    mode === "view" &&
    focus.level === "slot" &&
    hover?.slotId === slotId &&
    hover.subSlotIndex === subSlotIndex &&
    hover.palletIndex === undefined;
  const frameColor = rackHovered ? RACK_HOVER_COLOR : RACK_COLOR;

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
        // Edit mode always shows real content; in view mode, only the one
        // pallet actually drilled into does — every other pallet in a
        // visible sub-slot renders as a fill-rate-colored block instead of
        // being hidden, so the rest of the stock stays visible for context.
        const detailed = mode !== "view" || isPalletDetailed(focus, slotId, subSlotIndex, level);
        // Hovering a pallet block highlights *it* — only meaningful while
        // browsing this sub-slot's pallets (exactly at "slot-space" level).
        const palletHovered =
          mode === "view" &&
          focus.level === "slot-space" &&
          hover?.slotId === slotId &&
          hover.subSlotIndex === subSlotIndex &&
          hover.palletIndex === level;
        const handlePalletPointerDown = (e: ThreeEvent<PointerEvent>) => {
          // Reachable once this pallet's own sub-slot is focused (at any
          // drill-down level) — mirrors the slot -> sub-slot -> pallet order.
          if (mode !== "view" || focus.slotId !== slotId || focus.subSlotIndex !== subSlotIndex) return;
          e.stopPropagation();
          focusPallet(slotId, subSlotIndex, level, buildingId);
        };
        const handlePalletPointerOver = (e: ThreeEvent<PointerEvent>) => {
          if (mode !== "view" || focus.level !== "slot-space") return;
          if (focus.slotId !== slotId || focus.subSlotIndex !== subSlotIndex) return;
          e.stopPropagation();
          setHover({ slotId, subSlotIndex, palletIndex: level, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
        };
        const handlePalletPointerOut = () => {
          if (mode !== "view" || focus.level !== "slot-space") return;
          if (focus.slotId !== slotId || focus.subSlotIndex !== subSlotIndex) return;
          setHover(null);
        };
        return (
          <group
            key={pallet.id}
            onPointerDown={handlePalletPointerDown}
            onPointerOver={handlePalletPointerOver}
            onPointerMove={handlePalletPointerOver}
            onPointerOut={handlePalletPointerOut}
          >
            {/* Invisible hit target spanning the whole tier — clicking a
                sparse tire row (or the block) shouldn't require pixel-perfect aim. */}
            <mesh geometry={hitBoxGeometry} position={[0, level * LEVEL_HEIGHT + LEVEL_HEIGHT / 2, 0]}>
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            {detailed ? (
              <TireRow y={level * LEVEL_HEIGHT} halfWidth={halfWidth} pallet={pallet} />
            ) : (
              <PalletBlock
                y={level * LEVEL_HEIGHT}
                halfWidth={halfWidth}
                halfDepth={halfDepth}
                pallet={pallet}
                hovered={palletHovered}
              />
            )}
          </group>
        );
      })}
    </group>
  );
}
