import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Point } from "../types/warehouse";
import { useEditor } from "../state/EditorContext";
import { useSimulation } from "../state/SimulationContext";
import { slotFootprint } from "../lib/geometry";

const BLINK_COLOR = "#facc15";
const BLINK_HEIGHT = 3.2;
// One full pulse per this many seconds — slow enough to read as deliberate
// rather than a flicker.
const BLINK_PERIOD = 0.9;
const MIN_OPACITY = 0.15;
const MAX_OPACITY = 0.65;
const FACILITY_SIZE = 2.5;

interface BlinkTarget {
  center: Point;
  width: number;
  depth: number;
  rotationRad: number;
}

/**
 * Pulses a translucent column over whichever operation row the picking panel
 * is hovering (specs.md §5.4) — the link between "step 3 of this list" in the
 * panel and the actual rack it refers to, which a long list of slot ids
 * otherwise leaves the reader to work out by hand.
 *
 * Drawn as its own overlay rather than by tinting Slots.tsx, so it works
 * identically for slots and facilities, and regardless of which layers are
 * on — hovering a step should point at the place even if the storage layer
 * is currently hidden.
 */
export function StepBlink() {
  const { warehouse } = useEditor();
  const simulation = useSimulation();
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  const target = useMemo<BlinkTarget | null>(() => {
    const stop = simulation.hoveredStep;
    if (!stop) return null;

    if (stop.kind === "slot") {
      const slot = warehouse.slots.find((s) => s.id === stop.id);
      if (!slot) return null;
      const { totalDepth, footprintCenterZ } = slotFootprint(slot, warehouse.slotDefaults);
      const rotationRad = THREE.MathUtils.degToRad(slot.rotationDeg ?? 0);
      // The footprint's center sits ahead of the slot's own anchor once it's
      // depth-extended, so rotate that offset into world space rather than
      // blinking the anchor corner.
      return {
        center: {
          x: slot.x + footprintCenterZ * Math.sin(rotationRad),
          y: slot.y - footprintCenterZ * Math.cos(rotationRad),
        },
        width: warehouse.slotDefaults.width,
        depth: totalDepth,
        rotationRad,
      };
    }

    const lift = warehouse.liftStations.find((l) => l.id === stop.id);
    const delivery = warehouse.deliverySpaces.find((d) => d.id === stop.id);
    const facility = lift ?? delivery;
    if (!facility) return null;
    return {
      center: { x: facility.x, y: facility.y },
      width: FACILITY_SIZE,
      depth: FACILITY_SIZE,
      rotationRad: THREE.MathUtils.degToRad(facility.rotationDeg ?? 0),
    };
  }, [simulation.hoveredStep, warehouse]);

  useFrame(({ clock }) => {
    if (!materialRef.current) return;
    const phase = (Math.sin((clock.elapsedTime / BLINK_PERIOD) * Math.PI * 2) + 1) / 2;
    materialRef.current.opacity = MIN_OPACITY + phase * (MAX_OPACITY - MIN_OPACITY);
  });

  if (!target) return null;

  return (
    <group position={[target.center.x, 0, -target.center.y]} rotation={[0, target.rotationRad, 0]}>
      <mesh position={[0, BLINK_HEIGHT / 2, 0]} raycast={() => null}>
        <boxGeometry args={[target.width, BLINK_HEIGHT, target.depth]} />
        <meshStandardMaterial
          ref={materialRef}
          color={BLINK_COLOR}
          transparent
          opacity={MAX_OPACITY}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
