import { useEditor } from "../state/EditorContext";

export function Toolbar() {
  const {
    mode,
    setMode,
    addSlotMode,
    setAddSlotMode,
    dirty,
    save,
    load,
    undo,
    redo,
    canUndo,
    canRedo,
    showHistory,
    setShowHistory,
  } = useEditor();

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
          <button className="toolbar__btn" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button className="toolbar__btn" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
          <button
            className={showHistory ? "toolbar__btn toolbar__btn--active" : "toolbar__btn"}
            onClick={() => setShowHistory(!showHistory)}
          >
            History
          </button>
          <span className="toolbar__hint">
            Drag orange corners to reshape walls. Click a slot to select it, Ctrl+click to
            add/remove from the selection, or right-click-drag to box-select.
          </span>
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
