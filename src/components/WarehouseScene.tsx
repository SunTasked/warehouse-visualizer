import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls, CameraControls } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import { boundsCenter, boundsSpan, computeBounds, toSceneXZ } from "../lib/geometry";
import { slotWorldBox, subSlotWorldBox, palletWorldBox } from "../lib/focusBounds";
import { useEditor } from "../state/EditorContext";
import { useViewFocus } from "../state/ViewFocusContext";
import { Walls } from "./Walls";
import { Slots } from "./Slots";
import { DragPlane } from "./DragPlane";

const FIT_PADDING = { paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1 };

// Drives the view-mode camera drill-down: whenever `focus` changes, smoothly
// fits the CameraControls to the relevant slot/sub-slot/pallet box (computed
// analytically by focusBounds.ts), or back out to the original overview
// framing. A no-op in edit mode (cameraControlsRef stays null there — see
// the conditional OrbitControls/CameraControls render below).
function FocusCameraDriver({
  initialView,
}: {
  initialView: { cameraPosition: [number, number, number]; target: [number, number, number] };
}) {
  const { warehouse } = useEditor();
  const { focus, cameraControlsRef } = useViewFocus();

  useEffect(() => {
    const controls = cameraControlsRef.current;
    if (!controls) return;

    if (focus.level === "overview") {
      const [px, py, pz] = initialView.cameraPosition;
      const [tx, ty, tz] = initialView.target;
      void controls.setLookAt(px, py, pz, tx, ty, tz, true);
      return;
    }

    const slot = warehouse.slots.find((s) => s.id === focus.slotId);
    if (!slot) return;

    const box =
      focus.level === "slot"
        ? slotWorldBox(slot, warehouse.slotDefaults)
        : focus.level === "subslot"
          ? subSlotWorldBox(slot, warehouse.slotDefaults, focus.subSlotIndex!)
          : palletWorldBox(slot, warehouse.slotDefaults, focus.subSlotIndex!, focus.palletIndex!);
    void controls.fitToBox(box, true, FIT_PADDING);
  }, [focus, warehouse, initialView, cameraControlsRef]);

  return null;
}

export function WarehouseScene() {
  const { mode, warehouse, orbitRef, cameraRef } = useEditor();
  const { back, cameraControlsRef } = useViewFocus();
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

      <Walls walls={warehouse.walls} />
      <Slots slots={warehouse.slots} defaults={warehouse.slotDefaults} />
      <DragPlane />

      {mode === "edit" ? (
        <OrbitControls ref={orbitRef} target={initialView.target} makeDefault />
      ) : (
        <>
          <CameraControls ref={cameraControlsRef} makeDefault />
          <FocusCameraDriver initialView={initialView} />
        </>
      )}
    </Canvas>
  );
}
