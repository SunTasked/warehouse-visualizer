import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { useMemo, useState } from "react";
import { boundsCenter, boundsSpan, computeBounds, toSceneXZ } from "../lib/geometry";
import { useEditor } from "../state/EditorContext";
import { Walls } from "./Walls";
import { Slots } from "./Slots";
import { DragPlane } from "./DragPlane";

export function WarehouseScene() {
  const { warehouse, orbitRef } = useEditor();
  const bounds = useMemo(() => computeBounds(warehouse), [warehouse]);
  const center = boundsCenter(bounds);
  const span = boundsSpan(bounds) || 20;
  const [centerX, centerZ] = toSceneXZ(center.x, center.y);

  // Computed once per mount (not on every warehouse edit) so dragging a wall
  // or slot never yanks the camera/orbit target out from under the user.
  // WarehouseScene is remounted (via a `key` on warehouse.id in App.tsx) when
  // a genuinely different file is loaded, which is when a reframe is wanted.
  const [initialView] = useState(() => ({
    cameraPosition: [centerX + span * 0.6, span * 0.9, centerZ + span * 0.8] as [
      number,
      number,
      number,
    ],
    target: [centerX, 0, centerZ] as [number, number, number],
    far: span * 20,
  }));

  return (
    <Canvas
      camera={{ position: initialView.cameraPosition, fov: 45, near: 0.1, far: initialView.far }}
    >
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
      <DragPlane />

      <OrbitControls ref={orbitRef} target={initialView.target} makeDefault />
    </Canvas>
  );
}
