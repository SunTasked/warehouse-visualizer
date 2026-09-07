import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { useMemo } from "react";
import type { Warehouse } from "../types/warehouse";
import { boundsCenter, boundsSpan, computeBounds, toSceneXZ } from "../lib/geometry";
import { Walls } from "./Walls";
import { Slots } from "./Slots";

export function WarehouseScene({ warehouse }: { warehouse: Warehouse }) {
  const bounds = useMemo(() => computeBounds(warehouse), [warehouse]);
  const center = boundsCenter(bounds);
  const span = boundsSpan(bounds) || 20;
  const [centerX, centerZ] = toSceneXZ(center.x, center.y);

  const cameraPosition: [number, number, number] = [
    centerX + span * 0.6,
    span * 0.9,
    centerZ + span * 0.8,
  ];

  return (
    <Canvas camera={{ position: cameraPosition, fov: 45, near: 0.1, far: span * 20 }}>
      <color attach="background" args={["#eef1f6"]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[span, span * 1.5, span]} intensity={0.8} />

      <Grid
        position={[centerX, 0, centerZ]}
        args={[span * 1.5, span * 1.5]}
        cellSize={1}
        cellColor="#c7ccd6"
        sectionSize={5}
        sectionColor="#9aa3b5"
        fadeDistance={span * 3}
        infiniteGrid={false}
      />

      <Walls walls={warehouse.walls} />
      <Slots slots={warehouse.slots} defaults={warehouse.slotDefaults} />

      <OrbitControls target={[centerX, 0, centerZ]} makeDefault />
    </Canvas>
  );
}
