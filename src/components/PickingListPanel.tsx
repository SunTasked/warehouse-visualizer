import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PickingList } from "../types/simulation";
import { useEditor } from "../state/EditorContext";
import { useSimulation } from "../state/SimulationContext";

/**
 * Asked before lists run while capture is armed: a demo or a test run played
 * with capture forgotten on quietly skews the measurement, and nothing
 * afterwards can take it back out.
 */
function CaptureConfirm({
  count,
  onCapture,
  onWithoutCapture,
  onCancel,
}: {
  count: number;
  onCapture: () => void;
  onWithoutCapture: () => void;
  onCancel: () => void;
}) {
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primaryRef.current?.focus();
    // Capture phase, and stopped there: Escape otherwise also reaches the
    // view's own handler and sends the camera back to the plant.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  return createPortal(
    <div
      className="confirm-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="confirm" role="dialog" aria-modal="true" aria-labelledby="capture-confirm-title">
        <h3 id="capture-confirm-title">
          <span className="capture__dot capture__dot--on" />
          Capture is on
        </h3>
        <p>
          {count === 1 ? "This list" : `These ${count} lists`} will be measured into the path and slot
          heatmaps and the capture's record. Run {count === 1 ? "it" : "them"} without capturing if this
          isn't part of the measurement.
        </p>
        <div className="confirm__actions">
          <button className="confirm__btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="confirm__btn" onClick={onWithoutCapture}>
            Run without capturing
          </button>
          <button ref={primaryRef} className="confirm__btn confirm__btn--primary" onClick={onCapture}>
            Run and capture
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

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
  const [pendingLists, setPendingLists] = useState<PickingList[] | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  // Asked once per capture: after "Run and capture" the user has said what
  // they want, and asking again before every list of a long capture would
  // only teach them to click through it. Disarming forgets the answer.
  const captureConfirmedRef = useRef(false);

  const all = simulation.pickingLists;
  const allSelected = all.length > 0 && selected.size === all.length;
  const someSelected = selected.size > 0 && !allSelected;

  // Loading another plant replaces the lists wholesale; ticks left on ids
  // that no longer exist would throw select-all's count off.
  useEffect(() => {
    setSelected(new Set());
  }, [all]);

  // "Some selected" has no HTML attribute — it only exists as a DOM property.
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  useEffect(() => {
    if (!simulation.captureArmed) captureConfirmedRef.current = false;
  }, [simulation.captureArmed]);

  const cancelPending = useCallback(() => setPendingLists(null), []);

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

  const launch = (lists: PickingList[]) => {
    if (lists.length === 0) return;
    if (simulation.captureArmed && !captureConfirmedRef.current) {
      setPendingLists(lists);
      return;
    }
    simulation.playQueue(lists);
  };

  return (
    <div className="picking-panel">
      <button className="picking-panel__header" onClick={() => setCollapsed((c) => !c)}>
        <h2>Picking lists</h2>
        <span className="picking-panel__chevron">{collapsed ? "▸" : "▾"}</span>
      </button>

      {!collapsed && (
        <>
      {all.length === 0 ? (
        <div className="picking-panel__empty">
          No picking lists for this plant — load some from Overview → Load → Picking lists…
        </div>
      ) : (
        <label className="picking-panel__select-all">
          <input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={toggleAll} />
          <span>Select all</span>
        </label>
      )}

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
            <button className="picking-panel__play" onClick={() => launch([list])}>
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
          onClick={() => launch(selectedLists)}
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

      {pendingLists && (
        <CaptureConfirm
          count={pendingLists.length}
          onCancel={cancelPending}
          onCapture={() => {
            captureConfirmedRef.current = true;
            setPendingLists(null);
            simulation.playQueue(pendingLists);
          }}
          onWithoutCapture={() => {
            simulation.setCaptureArmed(false);
            setPendingLists(null);
            simulation.playQueue(pendingLists);
          }}
        />
      )}
    </div>
  );
}
