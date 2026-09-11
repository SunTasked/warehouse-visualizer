import { Text } from "@react-three/drei";
import * as THREE from "three";
import { useMemo } from "react";
import type { Slot, SlotSize } from "../types/warehouse";
import { useEditor } from "../state/EditorContext";
import { useViewFocus } from "../state/ViewFocusContext";
import { useSimulation } from "../state/SimulationContext";
import { useLayers } from "../state/LayerContext";
import { slotFootprint } from "../lib/geometry";
import { isSlotVisible } from "../lib/visibility";
import { findBuildingForSlot } from "../lib/buildings";
import { usageColor, usageRange } from "../lib/usageColor";

// Sits above the slot pad (SLOT_HEIGHT 0.06) and the path network, so the
// heatmap reads as a wash laid over the slot rather than fighting it for the
// same plane — and so it works whether or not the Storage layer is drawing
// the slot underneath it.
const PAD_HEIGHT = 0.02;
const PAD_ELEVATION = 0.1;
const PAD_INSET = 0.85; // a margin, so neighbouring slots' patches stay visually separate
const LABEL_ELEVATION = 0.7;
const LABEL_SIZE = 0.7;

/**
 * Per-slot activity coloring (specs.md §5.4): one tally per forklift
 * interaction — a pick or a store — so the question "is the workload spread
 * evenly across the racks, or is one aisle carrying everything" has a direct
 * visual answer. Deliberately its own layer and its own flat patch rather
 * than a tint applied inside Slots.tsx: the two answer different questions
 * (what's stored here vs. how busy is it), and a measurement should still be
 * readable with the storage layer turned off entirely.
 *
 * A slot with no recorded activity draws nothing at all — absence is the
 * signal there, and painting every untouched slot a "zero" color would bury
 * the handful that matter.
 */
function SlotPatch({
  slot,
  defaults,
  count,
  range,
  showLabel,
}: {
  slot: Slot;
  defaults: SlotSize;
  count: number;
  range: { min: number; max: number };
  showLabel: boolean;
}) {
  const { totalDepth, footprintCenterZ } = slotFootprint(slot, defaults);
  const rotationRad = THREE.MathUtils.degToRad(slot.rotationDeg ?? 0);
  const color = usageColor(count, range.min, range.max);

  return (
    <group position={[slot.x, 0, -slot.y]} rotation={[0, rotationRad, 0]}>
      <mesh position={[0, PAD_ELEVATION, footprintCenterZ]} raycast={() => null}>
        <boxGeometry args={[defaults.width * PAD_INSET, PAD_HEIGHT, totalDepth * PAD_INSET]} />
        <meshStandardMaterial color={color} transparent opacity={0.85} />
      </mesh>
      {showLabel && (
        <Text
          position={[0, LABEL_ELEVATION, footprintCenterZ]}
          // Counter-rotated so the number reads upright from the fixed camera
          // angle regardless of which way its slot faces.
          rotation={[-Math.PI / 2, 0, -rotationRad]}
          fontSize={LABEL_SIZE}
          color="#111827"
          outlineWidth={0.06}
          outlineColor="#ffffff"
          anchorX="center"
          anchorY="middle"
          renderOrder={999}
          material-depthTest={false}
        >
          {count}
        </Text>
      )}
    </group>
  );
}

export function SlotHeatmap() {
  const { warehouse } = useEditor();
  const { focus } = useViewFocus();
  const simulation = useSimulation();
  const { isVisible, labelCounts } = useLayers();
  const range = useMemo(() => usageRange(simulation.slotUsage), [simulation.slotUsage]);

  if (!isVisible("slotHeatmap") || !range) return null;

  return (
    <group>
      {warehouse.slots.map((slot) => {
        const count = simulation.slotUsage[slot.id] ?? 0;
        if (count <= 0) return null;
        if (!isSlotVisible(focus, slot.id, findBuildingForSlot(slot, warehouse.walls))) return null;
        return (
          <SlotPatch
            key={slot.id}
            slot={slot}
            defaults={warehouse.slotDefaults}
            count={count}
            range={range}
            showLabel={labelCounts}
          />
        );
      })}
    </group>
  );
}
