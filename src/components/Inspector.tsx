import type { FocusEvent } from "react";
import { useEditor } from "../state/EditorContext";

export function Inspector() {
  const { mode, warehouse, selectedSlotId, updateSlot, deleteSlot, setSelectedSlotId, beginChange } = useEditor();
  if (mode !== "edit" || !selectedSlotId) return null;

  const slot = warehouse.slots.find((s) => s.id === selectedSlotId);
  if (!slot) return null;

  const handleIdBlur = (e: FocusEvent<HTMLInputElement>) => {
    const nextId = e.target.value.trim();
    if (!nextId || nextId === slot.id) {
      e.target.value = slot.id;
      return;
    }
    const ok = updateSlot(slot.id, { id: nextId });
    if (!ok) {
      window.alert(`A slot with id "${nextId}" already exists.`);
      e.target.value = slot.id;
    }
  };

  return (
    <div className="inspector">
      <div className="inspector__header">
        <h2>Slot</h2>
        <button className="inspector__close" onClick={() => setSelectedSlotId(null)} aria-label="Close">
          ×
        </button>
      </div>

      <label className="inspector__field">
        <span>Id</span>
        <input type="text" defaultValue={slot.id} key={slot.id} onFocus={beginChange} onBlur={handleIdBlur} />
      </label>

      <label className="inspector__field">
        <span>X (m)</span>
        <input
          type="number"
          step="1"
          value={slot.x}
          onFocus={beginChange}
          onChange={(e) => updateSlot(slot.id, { x: Number(e.target.value) })}
        />
      </label>

      <label className="inspector__field">
        <span>Y (m)</span>
        <input
          type="number"
          step="1"
          value={slot.y}
          onFocus={beginChange}
          onChange={(e) => updateSlot(slot.id, { y: Number(e.target.value) })}
        />
      </label>

      <label className="inspector__field">
        <span>Rotation (°)</span>
        <input
          type="number"
          step="90"
          value={slot.rotationDeg ?? 0}
          onFocus={beginChange}
          onChange={(e) => updateSlot(slot.id, { rotationDeg: Number(e.target.value) })}
        />
      </label>

      <button className="inspector__delete" onClick={() => deleteSlot(slot.id)}>
        Delete slot
      </button>
    </div>
  );
}
