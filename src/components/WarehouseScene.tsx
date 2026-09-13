import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, CameraControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import CameraControlsImpl from "camera-controls";
import { boundsCenter, boundsSpan, computeBounds, toSceneXZ } from "../lib/geometry";
import {
  slotWorldBox,
  subSlotWorldBox,
  palletWorldBox,
  buildingWorldBox,
  plantWorldBox,
  plantShot,
  frameBox,
  CAMERA_FOV_DEG,
  type ViewportInsets,
} from "../lib/focusBounds";
import { buildingAt } from "../lib/buildings";
import { useEditor } from "../state/EditorContext";
import { useViewFocus } from "../state/ViewFocusContext";
import { useSimulation } from "../state/SimulationContext";
import { Walls, WALL_HEIGHT } from "./Walls";
import { Doors } from "./Doors";
import { Paths } from "./Paths";
import { LiftStations } from "./LiftStations";
import { DeliverySpaces } from "./DeliverySpaces";
import { InaccessibleZones } from "./InaccessibleZones";
import { Slots } from "./Slots";
import { DragPlane } from "./DragPlane";
import { Forklift } from "./Forklift";
import { SlotHeatmap } from "./SlotHeatmap";
import { StepBlink } from "./StepBlink";
import { useLayers } from "../state/LayerContext";

/** Clear space kept between a framed building and the panels beside it. */
const PANEL_CLEARANCE_PX = 16;

/**
 * How far the floating panels reach in from the canvas's left and right
 * edges, measured from the docks App.tsx marks with `data-camera-inset`.
 * Read only when a shot is framed, never continuously: collapsing or
 * expanding a panel afterwards shouldn't make the camera move.
 */
function measurePanelInsets(canvas: HTMLCanvasElement): ViewportInsets {
  const bounds = canvas.getBoundingClientRect();
  let left = 0;
  let right = 0;
  for (const dock of document.querySelectorAll<HTMLElement>("[data-camera-inset]")) {
    const rect = dock.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue; // nothing docked on that side
    if (dock.dataset.cameraInset === "left") left = Math.max(left, rect.right - bounds.left + PANEL_CLEARANCE_PX);
    else right = Math.max(right, bounds.right - rect.left + PANEL_CLEARANCE_PX);
  }
  return { left, right, width: bounds.width };
}

/**
 * The spot on the floor in the middle of the view — what "keep the centre"
 * means to someone looking at the screen. Not the orbit target itself:
 * panning a tilted camera slides the target up or down as well as across,
 * and recentring on a raised target lands metres off what was in the middle.
 */
function viewCentreOnFloor(controls: CameraControlsImpl): THREE.Vector3 {
  const target = controls.getTarget(new THREE.Vector3(), true);
  const position = controls.getPosition(new THREE.Vector3(), true);
  const direction = target.clone().sub(position);
  if (direction.y > -1e-6) return target; // looking level or up: no floor ahead
  return position.addScaledVector(direction, -position.y / direction.y);
}

// Drives the view-mode camera drill-down: whenever `focus` changes, smoothly
// moves the CameraControls to a fixed-angle shot of the relevant box
// (computed analytically by focusBounds.ts) — plant/warehouse from directly
// above, slot/slot-space/pallet from a fixed above-and-to-the-side angle —
// via frameBox(), never `fitToBox` (which dollies along whatever direction
// the camera already happens to be facing, so the angle wouldn't be
// consistent from one click to the next). A no-op in edit mode
// (cameraControlsRef stays null there — see the conditional
// OrbitControls/CameraControls render below).
//
// Only a change of focus moves the camera. The warehouse and the viewport
// are read when a shot is framed, not reacted to: every pick or store a run
// makes changes the warehouse, and reframing on those had yanked the view
// back to the plant at the start of each list.
function FocusCameraDriver() {
  const { warehouse } = useEditor();
  const { focus, cameraControlsRef } = useViewFocus();
  const { setFollow } = useSimulation();
  const { size, gl } = useThree();
  const latest = useRef({ warehouse, aspect: size.width / size.height });
  latest.current = { warehouse, aspect: size.width / size.height };
  const framedRef = useRef(false);

  useEffect(() => {
    const controls = cameraControlsRef.current;
    if (!controls) return;
    const { warehouse, aspect } = latest.current;
    const first = !framedRef.current;
    framedRef.current = true;
    // A run starting reveals the whole plant without asking for a shot.
    if (focus.keepCamera && !first) return;
    // Any shot the user does ask for takes the camera back from Follow.
    if (!first) setFollow(false);

    let view;
    if (focus.level === "plant") {
      // Plant and building shots fit between the side panels, never under them.
      const around = first ? undefined : viewCentreOnFloor(controls);
      view = plantShot(warehouse, aspect, measurePanelInsets(gl.domElement), around);
    } else if (focus.level === "warehouse") {
      const loop = warehouse.walls.find((w) => w.id === focus.buildingId);
      if (!loop) return;
      view = frameBox(buildingWorldBox(loop, WALL_HEIGHT), "top", aspect, measurePanelInsets(gl.domElement));
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
  }, [focus, cameraControlsRef, gl, setFollow]);

  return null;
}

type PanBindings = {
  right: CameraControlsImpl["mouseButtons"]["right"];
  two: CameraControlsImpl["touches"]["two"];
  three: CameraControlsImpl["touches"]["three"];
};

/**
 * Follow (run console): keeps the camera's target on the forklift while it
 * drives. The first time there is a forklift to follow, the shot zooms to the
 * building it is in, as a building click would; from then on only the target
 * moves, so whatever zoom and angle the user picks stick — across legs,
 * buildings and runs. Easing through CameraControls' own smoothing (rather
 * than snapping each frame) is what makes the camera trail the truck instead
 * of jittering with it.
 */
function FollowCameraDriver() {
  const { warehouse } = useEditor();
  const { follow, vehiclePositionRef } = useSimulation();
  const { cameraControlsRef } = useViewFocus();
  const { size, gl } = useThree();
  const framedRef = useRef(false);
  const savedPanRef = useRef<PanBindings | null>(null);

  useEffect(() => {
    framedRef.current = false;
  }, [follow]);

  // Panning while following would only be dragged straight back to the
  // forklift, so the pan bindings are off for as long as there is one to
  // follow — and put back as they were afterwards.
  const setPanLocked = (controls: CameraControlsImpl, locked: boolean) => {
    if (locked && !savedPanRef.current) {
      savedPanRef.current = { right: controls.mouseButtons.right, two: controls.touches.two, three: controls.touches.three };
      controls.mouseButtons.right = CameraControlsImpl.ACTION.NONE;
      controls.touches.two = CameraControlsImpl.ACTION.TOUCH_DOLLY;
      controls.touches.three = CameraControlsImpl.ACTION.NONE;
    } else if (!locked && savedPanRef.current) {
      controls.mouseButtons.right = savedPanRef.current.right;
      controls.touches.two = savedPanRef.current.two;
      controls.touches.three = savedPanRef.current.three;
      savedPanRef.current = null;
    }
  };

  useEffect(
    () => () => {
      const controls = cameraControlsRef.current;
      if (controls) setPanLocked(controls, false);
    },
    [cameraControlsRef],
  );

  useFrame(() => {
    const controls = cameraControlsRef.current;
    if (!controls) return;
    const cart = follow ? vehiclePositionRef.current : null;
    setPanLocked(controls, cart !== null);
    if (!cart) return;

    const [x, z] = toSceneXZ(cart.x, cart.y);
    if (!framedRef.current) {
      framedRef.current = true;
      const loop = buildingAt(cart, warehouse.walls);
      if (loop) {
        const view = frameBox(
          buildingWorldBox(loop, WALL_HEIGHT),
          "top",
          size.width / size.height,
          measurePanelInsets(gl.domElement),
        );
        const [px, py, pz] = view.position;
        const [tx, ty, tz] = view.target;
        void controls.setLookAt(x + px - tx, py - ty, z + pz - tz, x, 0, z, true);
        return;
      }
    }
    void controls.moveTo(x, 0, z, true);
  });

  return null;
}

export interface Overflow {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

const NO_OVERFLOW: Overflow = { top: false, right: false, bottom: false, left: false };

/** How far past the canvas edge (in clip space, where the edge is ±1) the plant has to reach before it counts as cut off — so a building label grazing the edge doesn't flicker a hint on and off. */
const OVERFLOW_SLACK = 0.02;

/**
 * Works out which edges of the view the shown site carries on past: the plant
 * at plant level, the focused building at building level (the others are
 * hidden, so they aren't "more to see"), nothing deeper in. Projects the box's
 * floor corners each frame — a box's extreme screen points are always among
 * its corners — and reports only when the answer changes.
 */
function OverflowProbe({ onChange }: { onChange: (overflow: Overflow) => void }) {
  const { mode, warehouse } = useEditor();
  const { focus } = useViewFocus();
  const box = useMemo(() => {
    if (mode !== "view") return null;
    if (focus.level === "plant") return plantWorldBox(warehouse);
    if (focus.level === "warehouse") {
      const loop = warehouse.walls.find((w) => w.id === focus.buildingId);
      return loop ? buildingWorldBox(loop, 0) : null;
    }
    return null;
  }, [mode, focus, warehouse]);
  const corner = useMemo(() => new THREE.Vector4(), []);
  const viewProjection = useMemo(() => new THREE.Matrix4(), []);
  const lastRef = useRef("0000");

  useFrame(({ camera }) => {
    const next = { ...NO_OVERFLOW };
    if (box) {
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      for (const x of [box.min.x, box.max.x]) {
        for (const z of [box.min.z, box.max.z]) {
          corner.set(x, 0, z, 1).applyMatrix4(viewProjection);
          if (corner.w <= 0) {
            // Behind the camera: only reachable tilted towards the horizon,
            // where what's out of sight lies beyond the top of the view.
            next.top = true;
            continue;
          }
          const nx = corner.x / corner.w;
          const ny = corner.y / corner.w;
          if (nx < -1 - OVERFLOW_SLACK) next.left = true;
          if (nx > 1 + OVERFLOW_SLACK) next.right = true;
          if (ny > 1 + OVERFLOW_SLACK) next.top = true;
          if (ny < -1 - OVERFLOW_SLACK) next.bottom = true;
        }
      }
    }
    const key = `${+next.top}${+next.right}${+next.bottom}${+next.left}`;
    if (key !== lastRef.current) {
      lastRef.current = key;
      onChange(next);
    }
  });

  return null;
}

/** A soft, blurred band along each edge the site carries on past, with a small chevron pointing out — a quiet cue that there is more to pan to. Never catches the pointer. */
function EdgeHints({ overflow }: { overflow: Overflow }) {
  return (
    <div className="edge-hints" aria-hidden="true">
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <div key={side} className={`edge-hint edge-hint--${side}${overflow[side] ? " edge-hint--on" : ""}`}>
          <span className="edge-hint__chevron" />
        </div>
      ))}
    </div>
  );
}

export function WarehouseScene() {
  const { mode, warehouse, orbitRef, cameraRef } = useEditor();
  const { back, cameraControlsRef } = useViewFocus();
  const layers = useLayers();
  const bounds = useMemo(() => computeBounds(warehouse), [warehouse]);
  const center = boundsCenter(bounds);
  const span = boundsSpan(bounds) || 20;
  const [centerX, centerZ] = toSceneXZ(center.x, center.y);
  const [overflow, setOverflow] = useState<Overflow>(NO_OVERFLOW);

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
    <>
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
            <InaccessibleZones zones={warehouse.inaccessibleZones} />
          </>
        )}
        {/* Slots gates the pads/markers/ids here; the racks and pallets inside
            them are their own layer, checked within Slots itself. */}
        {layers.isVisible("slots") && <Slots slots={warehouse.slots} defaults={warehouse.slotDefaults} />}
        <SlotHeatmap />
        <Forklift />
        <StepBlink />
        <DragPlane />
        <OverflowProbe onChange={setOverflow} />

        {mode === "edit" ? (
          <OrbitControls ref={orbitRef} target={initialView.target} makeDefault />
        ) : (
          <>
            <CameraControls ref={cameraControlsRef} makeDefault />
            <FocusCameraDriver />
            <FollowCameraDriver />
          </>
        )}
      </Canvas>
      <EdgeHints overflow={overflow} />
    </>
  );
}
