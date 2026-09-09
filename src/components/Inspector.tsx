import type { FocusEvent } from "react";
import { useEditor } from "../state/EditorContext";

export function Inspector() {
  const {
    mode,
    warehouse,
    selectedSlotIds,
    updateSlots,
    setSlotDepth,
    addPalletAuto,
    removePallet,
    setPalletItemCount,
    renameSlot,
    deleteSlots,
    clearSelection,
    commit,
  } = useEditor();
  if (mode !== "edit" || selectedSlotIds.size === 0) return null;

  const ids = Array.from(selectedSlotIds);

  if (ids.length === 1) {
    const id = ids[0];
    const slot = warehouse.slots.find((s) => s.id === id);
    if (!slot) return null;

    const handleIdBlur = (e: FocusEvent<HTMLInputElement>) => {
      const nextId = e.target.value.trim();
      if (!nextId || nextId === slot.id) {
        e.target.value = slot.id;
        return;
      }
      const ok = renameSlot(slot.id, nextId);
      if (!ok) {
        window.alert(`A slot with id "${nextId}" already exists.`);
        e.target.value = slot.id;
      } else {
        commit(`Rename ${slot.id} to ${nextId}`);
      }
    };

    const field = (key: "x" | "y" | "rotationDeg", label: string, step: string) => (
      <label className="inspector__field">
        <span>{label}</span>
        <input
          type="number"
          step={step}
          value={key === "rotationDeg" ? slot.rotationDeg ?? 0 : slot[key]}
          onChange={(e) => updateSlots([slot.id], { [key]: Number(e.target.value) })}
          onBlur={() => commit(key === "rotationDeg" ? `Rotate slot ${slot.id}` : `Move slot ${slot.id}`)}
        />
      </label>
    );

    return (
      <div className="inspector">
        <div className="inspector__header">
          <h2>Slot</h2>
          <button className="inspector__close" onClick={clearSelection} aria-label="Close">
            ×
          </button>
        </div>

        <label className="inspector__field">
          <span>Id</span>
          <input type="text" defaultValue={slot.id} key={slot.id} onBlur={handleIdBlur} />
        </label>

        {field("x", "X (m)", "1")}
        {field("y", "Y (m)", "1")}
        {field("rotationDeg", "Rotation (°)", "90")}

        <label className="inspector__field">
          <span>Depth (sub-slots)</span>
          <input
            type="number"
            min={1}
            max={12}
            step={1}
            value={slot.subSlots?.length ?? 1}
            onChange={(e) => setSlotDepth(slot.id, Number(e.target.value))}
            onBlur={() => commit(`Set depth of ${slot.id}`)}
          />
        </label>

        <button
          className="inspector__small-btn inspector__add-pallet"
          onClick={() => addPalletAuto(slot.id)}
          title="Adds a pallet to whichever sub-slot needs it, deepest first"
        >
          + Pallet (deepest-first)
        </button>

        {(slot.subSlots?.length ?? 0) > 0 && (
          <div className="inspector__subslots">
            {slot.subSlots!.map((subSlot, si) => (
              <div className="inspector__subslot" key={subSlot.id}>
                <div className="inspector__subslot-header">
                  <span>{subSlot.id}</span>
                </div>
                {subSlot.pallets.length === 0 && <p className="inspector__hint">Empty.</p>}
                {subSlot.pallets.map((pallet, pi) => (
                  <div className="inspector__pallet" key={pallet.id}>
                    <span className="inspector__pallet-label">{pallet.id}</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      step={1}
                      value={pallet.items.length}
                      onChange={(e) => setPalletItemCount(slot.id, si, pi, Number(e.target.value))}
                      onBlur={() => commit(`Set item count on ${pallet.id}`)}
                    />
                    <span className="inspector__pallet-unit">items</span>
                    <button
                      className="inspector__small-btn inspector__small-btn--danger"
                      onClick={() => removePallet(slot.id, si, pi)}
                      title="Remove this pallet"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        <button className="inspector__delete" onClick={() => deleteSlots([slot.id])}>
          Delete slot
        </button>
      </div>
    );
  }

  return (
    <div className="inspector">
      <div className="inspector__header">
        <h2>{ids.length} slots selected</h2>
        <button className="inspector__close" onClick={clearSelection} aria-label="Close">
          ×
        </button>
      </div>

      <label className="inspector__field">
        <span>Rotation (° — applies to all)</span>
        <input
          type="number"
          step="90"
          placeholder="—"
          onChange={(e) => {
            if (e.target.value === "") return;
            updateSlots(ids, { rotationDeg: Number(e.target.value) });
          }}
          onBlur={(e) => {
            if (e.target.value === "") return;
            commit(`Rotate ${ids.length} slots`);
          }}
        />
      </label>

      <p className="inspector__hint">Drag any selected slot to move the whole group together.</p>

      <button className="inspector__delete" onClick={() => deleteSlots(ids)}>
        Delete {ids.length} slots
      </button>
    </div>
  );
}
