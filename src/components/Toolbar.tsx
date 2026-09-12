import { useEditor } from "../state/EditorContext";
import { useSimulation } from "../state/SimulationContext";
import { useAnalytics } from "../state/AnalyticsContext";

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
  const simulation = useSimulation();
  const analytics = useAnalytics();

  /**
   * Entering edit mode discards the session: every recorded route was
   * computed against the layout that is about to change, so keeping the
   * runs would mean scoring journeys that can no longer happen. The cost is
   * spelled out here rather than in a generic "are you sure" — losing a
   * baseline you were about to compare against is worth a specific warning.
   */
  const toggleMode = () => {
    const next = mode === "view" ? "edit" : "view";
    if (next === "edit") {
      const runs = simulation.sessionRuns.length;
      const snapshots = analytics.snapshots.length;
      if (runs > 0 || snapshots > 0) {
        const lost = [
          runs > 0 ? `${runs} recorded run${runs === 1 ? "" : "s"} and both heatmaps` : null,
          snapshots > 0 ? `${snapshots} saved snapshot${snapshots === 1 ? "" : "s"}` : null,
        ]
          .filter(Boolean)
          .join(", plus ");
        const ok = window.confirm(
          `Editing the layout discards the current session.

You will lose ${lost}.

The routes were measured against this layout, so they can't be compared against the edited one. Continue?`,
        );
        if (!ok) return;
      }
      simulation.clearSession();
      analytics.clearAll();
    }
    setMode(next);
    if (next === "view") setAddSlotMode(false);
  };

  return (
    <div className="toolbar">
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
      <button
        className={mode === "edit" ? "toolbar__btn toolbar__btn--active" : "toolbar__btn"}
        onClick={toggleMode}
        title={mode === "edit" ? "Finish editing and go back to the warehouse view" : "Edit the layout (discards the current session)"}
      >
        {mode === "edit" ? "Done" : "Edit"}
      </button>
    </div>
  );
}
