import { useEffect, useRef, useState } from "react";
import { useEditor } from "../state/EditorContext";
import { useSimulation } from "../state/SimulationContext";

/**
 * The catalogue of picking lists (§5.3): what you can launch, and how. Kept
 * deliberately separate from the run console (RunConsole.tsx, docked
 * top-center) which owns everything about what's currently *happening* —
 * capture, transport, operations and the capture's run history. One place to
 * choose, one place to watch.
 */
export function PickingListPanel() {
  const { mode } = useEditor();
  const simulation = useSimulation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const all = simulation.pickingLists;
  const allSelected = all.length > 0 && selected.size === all.length;
  const someSelected = selected.size > 0 && !allSelected;

  // "Some selected" has no HTML attribute — it only exists as a DOM property.
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  if (mode !== "view") return null;

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(all.map((list) => list.id)));
  };

  const selectedLists = all.filter((list) => selected.has(list.id));

  return (
    <div className="picking-panel">
      <button className="picking-panel__header" onClick={() => setCollapsed((c) => !c)}>
        <h2>Picking lists</h2>
        <span className="picking-panel__chevron">{collapsed ? "▸" : "▾"}</span>
      </button>

      {!collapsed && (
        <>
      <label className="picking-panel__select-all">
        <input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={toggleAll} />
        <span>Select all</span>
      </label>

      <ul className="picking-panel__list">
        {all.map((list) => (
          <li key={list.id} className="picking-panel__row">
            <input
              type="checkbox"
              checked={selected.has(list.id)}
              onChange={() => toggleSelected(list.id)}
              aria-label={`Select ${list.label}`}
            />
            <div className="picking-panel__info">
              <div className="picking-panel__label">{list.label}</div>
              <div className="picking-panel__meta">
                <span
                  className={
                    list.mode === "picking"
                      ? "picking-panel__badge picking-panel__badge--picking"
                      : "picking-panel__badge picking-panel__badge--storing"
                  }
                >
                  {list.mode}
                </span>
                <span>{list.stops.map((s) => s.id).join(" → ")}</span>
              </div>
            </div>
            <button className="picking-panel__play" onClick={() => simulation.playList(list)}>
              Play
            </button>
          </li>
        ))}
      </ul>

      <div className="picking-panel__actions">
        {/* Running is the only launch action now: "all" is just the select-all
            checkbox, and stopping belongs with the rest of the transport on
            the run console. */}
        <button
          className="picking-panel__btn"
          disabled={selectedLists.length === 0}
          onClick={() => simulation.playQueue(selectedLists)}
          title="Run the ticked lists back to back"
        >
          Run selected ({selectedLists.length})
        </button>
        <button
          className="picking-panel__btn picking-panel__btn--reset"
          onClick={simulation.resetWarehouse}
          title="Undo every pallet the simulation moved (keeps the captured heatmaps)"
        >
          Reset warehouse
        </button>
      </div>
        </>
      )}
    </div>
  );
}
