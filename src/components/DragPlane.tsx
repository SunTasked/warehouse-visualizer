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
 * Coordinates aren't snapped here — updateWallPoint/updateSlot/addSlot in
 * EditorContext round to whole meters (and rotation to 90°) centrally, so
 * every entry point (drag, inspector fields) enforces it consistently.
 */
export function DragPlane() {
  const { mode, addSlotMode, dragRef, orbitRef, updateWallPoint, updateSlot, addSlot, setSelectedSlotId } =
    useEditor();

  if (mode !== "edit") return null;

  const endDrag = () => {
    dragRef.current = null;
    if (orbitRef.current) orbitRef.current.enabled = true;
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const target = dragRef.current;
    if (!target) return;
    const point = fromSceneXZ(e.point.x, e.point.z);
    if (target.type === "wallPoint") {
      updateWallPoint(target.wallId, target.index, point);
    } else {
      updateSlot(target.slotId, point);
    }
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!addSlotMode) {
      setSelectedSlotId(null);
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
