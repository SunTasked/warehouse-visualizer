import type { ThreeEvent } from "@react-three/fiber";
import { useEditor } from "../state/EditorContext";
import { fromSceneXZ } from "../lib/geometry";

/**
 * A large invisible ground-plane mesh, only present in edit mode. It's what
 * makes dragging feel continuous: the object being dragged (a wall corner
 * handle or a slot) isn't what's tracked under the pointer — this plane is,
 * so movement keeps registering even once the pointer has moved off the
 * (small) handle mesh. See src/state/EditorContext.tsx's dragRef.
 *
 * Coordinates aren't snapped here — updateWallPoint/addSlot/updateSlots/
 * applySlotPatches in EditorContext round to whole meters (and rotation to
 * 90°) centrally, so every entry point (drag, inspector fields) enforces it
 * consistently. Likewise, history is committed here (drag end), not per
 * pointermove — see commit()/mutateWarehouse() in EditorContext.
 */
export function DragPlane() {
  const {
    mode,
    addSlotMode,
    dragRef,
    orbitRef,
    updateWallPoint,
    applySlotPatches,
    addSlot,
    clearSelection,
    commit,
  } = useEditor();

  if (mode !== "edit") return null;

  const endDrag = () => {
    const target = dragRef.current;
    dragRef.current = null;
    if (orbitRef.current) orbitRef.current.enabled = true;
    // A plain click (pointerdown immediately followed by pointerup, no
    // intervening pointermove) shouldn't record a no-op "Move..." entry.
    if (target && target.moved) commit(target.label);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const target = dragRef.current;
    if (!target) return;
    target.moved = true;
    const point = fromSceneXZ(e.point.x, e.point.z);
    if (target.type === "wallPoint") {
      updateWallPoint(target.wallId, target.index, point);
      return;
    }
    const dx = point.x - target.anchor.x;
    const dy = point.y - target.anchor.y;
    applySlotPatches(
      target.ids.map((id) => {
        const origin = target.origins[id];
        return { id, x: origin.x + dx, y: origin.y + dy };
      }),
    );
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.button !== 0) return; // left button only — right button is for box-select
    if (!addSlotMode) {
      clearSelection();
      return;
    }
    const point = fromSceneXZ(e.point.x, e.point.z);
    const id = window.prompt("New slot id (location code)");
    if (!id) return;
    const added = addSlot(id, point.x, point.y);
    if (!added) window.alert(`A slot with id "${id}" already exists.`);
  };

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onPointerDown={handlePointerDown}
    >
      <planeGeometry args={[100000, 100000]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}
