import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, CameraControls } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import { boundsCenter, boundsSpan, computeBounds, toSceneXZ } from "../lib/geometry";
import {
  slotWorldBox,
  subSlotWorldBox,
  palletWorldBox,
  buildingWorldBox,
  plantWorldBox,
  frameBox,
  CAMERA_FOV_DEG,
} from "../lib/focusBounds";
import { useEditor } from "../state/EditorContext";
import { useViewFocus } from "../state/ViewFocusContext";
import { Walls, WALL_HEIGHT } from "./Walls";
import { Doors } from "./Doors";
import { Paths } from "./Paths";
import { LiftStations } from "./LiftStations";
import { DeliverySpaces } from "./DeliverySpaces";
import { Slots } from "./Slots";
import { DragPlane } from "./DragPlane";
import { Forklift } from "./Forklift";
import { SlotHeatmap } from "./SlotHeatmap";
import { StepBlink } from "./StepBlink";
import { useLayers } from "../state/LayerContext";

// Drives the view-mode camera drill-down: whenever `focus` changes, smoothly
// moves the CameraControls to a fixed-angle shot of the relevant box
// (computed analytically by focusBounds.ts) — plant/warehouse from directly
// above, slot/slot-space/pallet from a fixed above-and-to-the-side angle —
// via frameBox(), never `fitToBox` (which dollies along whatever direction
// the camera already happens to be facing, so the angle wouldn't be
// consistent from one click to the next). A no-op in edit mode
// (cameraControlsRef stays null there — see the conditional
// OrbitControls/CameraControls render below).
function FocusCameraDriver() {
  const { warehouse } = useEditor();
  const { focus, cameraControlsRef } = useViewFocus();
  const { size } = useThree();
  const aspect = size.width / size.height;

  useEffect(() => {
    const controls = cameraControlsRef.current;
    if (!controls) return;

    let view;
    if (focus.level === "plant") {
      view = frameBox(plantWorldBox(warehouse), "top", aspect);
    } else if (focus.level === "warehouse") {
      const loop = warehouse.walls.find((w) => w.id === focus.buildingId);
      if (!loop) return;
      view = frameBox(buildingWorldBox(loop, WALL_HEIGHT), "top", aspect);
    } else {
      const slot = warehouse.slots.find((s) => s.id === focus.slotId);
      if (!slot) return;
      const box =
        focus.level === "slot"
          ? slotWorldBox(slot, warehouse.slotDefaults)
          : focus.level === "slot-space"
            ? subSlotWorldBox(slot, warehouse.slotDefaults, focus.subSlotIndex!)
            : palletWorldBox(slot, warehouse.slotDefaults, focus.subSlotIndex!, focus.palletIndex!);
      view = frameBox(box, "iso");
    }

    const [px, py, pz] = view.position;
    const [tx, ty, tz] = view.target;
    void controls.setLookAt(px, py, pz, tx, ty, tz, true);
  }, [focus, warehouse, cameraControlsRef, aspect]);

  return null;
}

export function WarehouseScene() {
  const { mode, warehouse, orbitRef, cameraRef } = useEditor();
  const { back, cameraControlsRef } = useViewFocus();
  const layers = useLayers();
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
      camera={{ position: initialView.cameraPosition, fov: CAMERA_FOV_DEG, near: 0.1, far: initialView.far }}
      onCreated={({ camera }) => {
        cameraRef.current = camera;
      }}
      onPointerMissed={() => {
        if (mode === "view") back();
      }}
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

      {/* Layer gating lives here rather than inside each component, so the
          layer model stays readable as one list (see LayerContext). Paths
          and Forklift are the exceptions: each needs to know *which* of its
          own layers is on to decide what to draw (Paths swaps corridors for
          heatmap lanes; Forklift keeps its animation driver mounted while
          hidden), so they read the layer state themselves. */}
      {layers.isVisible("structure") && (
        <>
          <Walls walls={warehouse.walls} doors={warehouse.doors} />
          <Doors doors={warehouse.doors} />
        </>
      )}
      <Paths paths={warehouse.paths} />
      {layers.isVisible("facilities") && (
        <>
          <LiftStations stations={warehouse.liftStations} />
          <DeliverySpaces spaces={warehouse.deliverySpaces} />
        </>
      )}
      {/* Slots gates the pads/markers/ids here; the racks and pallets inside
          them are their own layer, checked within Slots itself. */}
      {layers.isVisible("slots") && <Slots slots={warehouse.slots} defaults={warehouse.slotDefaults} />}
      <SlotHeatmap />
      <Forklift />
      <StepBlink />
      <DragPlane />

      {mode === "edit" ? (
        <OrbitControls ref={orbitRef} target={initialView.target} makeDefault />
      ) : (
        <>
          <CameraControls ref={cameraControlsRef} makeDefault />
          <FocusCameraDriver />
        </>
      )}
    </Canvas>
  );
}
