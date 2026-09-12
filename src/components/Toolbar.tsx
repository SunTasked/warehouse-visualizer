import { useEditor } from "../state/EditorContext";

/**
 * Edit-mode tooling only. Load, Save and the Edit/Done toggle moved into the
 * Overview menu (AppHeader), so in view mode this bar has nothing to show
 * and renders nothing at all rather than an empty strip.
 */
export function Toolbar() {
  const { mode, addSlotMode, setAddSlotMode, undo, redo, canUndo, canRedo, showHistory, setShowHistory } =
    useEditor();

  if (mode !== "edit") return null;

  return (
    <div className="toolbar">
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
        Drag orange corners to reshape walls. Click a slot to select it, Ctrl+click to add/remove from the
        selection, or right-click-drag to box-select.
      </span>
    </div>
  );
}
