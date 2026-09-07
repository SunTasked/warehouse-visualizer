import { useEditor } from "../state/EditorContext";

export function Toolbar() {
  const { mode, setMode, addSlotMode, setAddSlotMode, dirty, save, load } = useEditor();

  const toggleMode = () => {
    const next = mode === "view" ? "edit" : "view";
    setMode(next);
    if (next === "view") setAddSlotMode(false);
  };

  return (
    <div className="toolbar">
      <button className={mode === "edit" ? "toolbar__btn toolbar__btn--active" : "toolbar__btn"} onClick={toggleMode}>
        {mode === "edit" ? "Editing" : "View only"}
      </button>

      {mode === "edit" && (
        <>
          <button
            className={addSlotMode ? "toolbar__btn toolbar__btn--active" : "toolbar__btn"}
            onClick={() => setAddSlotMode(!addSlotMode)}
          >
            {addSlotMode ? "Click floor to add slot…" : "Add Slot"}
          </button>
          <span className="toolbar__hint">Drag orange corners to reshape walls. Click a slot to select it.</span>
        </>
      )}

      <div className="toolbar__spacer" />

      {dirty && <span className="toolbar__dirty">● unsaved changes</span>}
      <button className="toolbar__btn" onClick={() => void load()}>
        Load…
      </button>
      <button className="toolbar__btn" onClick={() => void save()}>
        Save
      </button>
    </div>
  );
}
