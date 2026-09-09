import * as THREE from "three";
import { useMemo } from "react";
import type { Pallet } from "../types/warehouse";

// Visual constants for the pallet-rack + tire-stack representation (schematic,
// not to real-world tire scale — see specs.md §5.1 "Storage subdivision").
const LEVEL_HEIGHT = 1;
const POST_SIZE = 0.06;
const RAIL_THICKNESS = 0.05;
const RACK_COLOR = "#2a52c9";
const TIRE_COLOR = "#171717";
const TIRE_ROUGHNESS = 0.85;

function Rail({ y, halfWidth, halfDepth }: { y: number; halfWidth: number; halfDepth: number }) {
  const geometry = useMemo(
    () => new THREE.BoxGeometry(halfWidth * 2, RAIL_THICKNESS, RAIL_THICKNESS),
    [halfWidth],
  );
  return (
    <>
      <mesh geometry={geometry} position={[0, y, -halfDepth]}>
        <meshStandardMaterial color={RACK_COLOR} />
      </mesh>
      <mesh geometry={geometry} position={[0, y, halfDepth]}>
        <meshStandardMaterial color={RACK_COLOR} />
      </mesh>
    </>
  );
}

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

/**
 * Renders one sub-slot's storage content: a rack frame sized to the cell
 * footprint, with `pallets.length` tiers stacked vertically (bottom-up), each
 * tier showing its items as a row of tires laid side by side along the
 * cell's width. Cell-local coordinates — position the whole group at the
 * sub-slot's center in the parent (see Slots.tsx).
 */
export function Rack({
  cellWidth,
  cellDepth,
  pallets,
}: {
  cellWidth: number;
  cellDepth: number;
  pallets: Pallet[];
}) {
  const halfWidth = (cellWidth / 2) * 0.85;
  const halfDepth = (cellDepth / 2) * 0.85;
  const totalHeight = pallets.length * LEVEL_HEIGHT;
  const postGeometry = useMemo(
    () => new THREE.BoxGeometry(POST_SIZE, totalHeight, POST_SIZE),
    [totalHeight],
  );
  const corners: [number, number][] = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [-halfWidth, halfDepth],
    [halfWidth, halfDepth],
  ];

  if (pallets.length === 0) return null;

  return (
    <group>
      {corners.map(([cx, cz]) => (
        <mesh key={`${cx}-${cz}`} geometry={postGeometry} position={[cx, totalHeight / 2, cz]}>
          <meshStandardMaterial color={RACK_COLOR} />
        </mesh>
      ))}
      {Array.from({ length: pallets.length + 1 }).map((_, level) => (
        <Rail key={level} y={level * LEVEL_HEIGHT} halfWidth={halfWidth} halfDepth={halfDepth} />
      ))}
      {pallets.map((pallet, level) => (
        <TireRow key={pallet.id} y={level * LEVEL_HEIGHT} halfWidth={halfWidth} pallet={pallet} />
      ))}
    </group>
  );
}
