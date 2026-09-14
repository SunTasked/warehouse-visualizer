import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PickingList } from "../types/simulation";
import { useEditor } from "../state/EditorContext";
import { useSimulation, type Computation } from "../state/SimulationContext";
import { useVirtualRows } from "../lib/useVirtualRows";

const formatCount = (n: number) => n.toLocaleString("en-US");

/** A catalogue row's pitch: `.picking-panel__row` is 52px tall with 6px below it. */
const LIST_ROW_PITCH = 58;

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
          {count === 1 ? "This list" : `These ${formatCount(count)} lists`} will be measured into the path and slot
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

/** One list in the catalogue. Memoised: a plant can have thousands, and ticking one should re-render that row alone. */
const ListRow = memo(function ListRow({
  list,
  checked,
  onToggle,
  onPlay,
}: {
  list: PickingList;
  checked: boolean;
  onToggle: (id: string) => void;
  onPlay: (list: PickingList) => void;
}) {
  // One line, cut short when long — rows are a fixed height so the catalogue
  // can render only the ones in view. The whole sequence is the tooltip.
  const stops = list.stops.map((s) => s.id).join(" → ");
  return (
    <li className="picking-panel__row">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(list.id)}
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
          <span className="picking-panel__stops" title={stops}>
            {stops}
          </span>
        </div>
      </div>
      <button className="picking-panel__play" onClick={() => onPlay(list)}>
        Play
      </button>
    </li>
  );
});

/** Stands in for the catalogue while a batch is routed: how far it has got, and a way out. */
function RunProgress({ computation, onCancel }: { computation: Computation; onCancel: () => void }) {
  const share = computation.total > 0 ? computation.done / computation.total : 0;
  return (
    <div className="run-progress">
      <div className="run-progress__head">
        <span>Computing routes</span>
        <span className="run-progress__pct">{Math.floor(share * 100)}%</span>
      </div>
      <div
        className="run-progress__track"
        role="progressbar"
        aria-label="Picking lists computed"
        aria-valuemin={0}
        aria-valuemax={computation.total}
        aria-valuenow={computation.done}
      >
        <div className="run-progress__fill" style={{ width: `${share * 100}%` }} />
      </div>
      <div className="run-progress__meta">
        <span>
          {formatCount(computation.done)} / {formatCount(computation.total)} lists
        </span>
        <button className="picking-panel__btn run-progress__cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * The catalogue of picking lists (§5.3): what you can launch, and how. Kept
 * deliberately separate from the run console (RunConsole.tsx) which owns
 * everything about what's currently *happening* — capture, transport and the
 * orders computed. One place to choose, one place to watch.
 *
 * Running lists computes them all first, with a progress bar in place of the
 * catalogue, then hands the orders to the console. Nothing is drawn while
 * they compute, which is what lets thousands go through in seconds.
 */
export function PickingListPanel() {
  const { mode } = useEditor();
  const simulation = useSimulation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);
  const [pending, setPending] = useState<{ lists: PickingList[]; show: boolean } | null>(null);
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

  const cancelPending = useCallback(() => setPending(null), []);

  const start = (lists: PickingList[], show: boolean) => {
    void simulation.runLists(lists, { show }).then((completed) => {
      // A finished batch leaves nothing ticked: its orders are in the
      // console now, and the next selection starts from scratch.
      if (completed && !show) setSelected(new Set());
    });
  };

  const launch = (lists: PickingList[], show: boolean) => {
    if (lists.length === 0) return;
    if (simulation.captureArmed && !captureConfirmedRef.current) {
      setPending({ lists, show });
      return;
    }
    start(lists, show);
  };

  // Stable handlers for the memoised rows, reading the latest launch.
  const launchRef = useRef(launch);
  launchRef.current = launch;
  const toggleSelected = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // A single list's Play shows its route as soon as it's computed.
  const playOne = useCallback((list: PickingList) => launchRef.current([list], true), []);
  const catalogue = useVirtualRows<HTMLUListElement>(all.length, LIST_ROW_PITCH);

  if (mode !== "view") return null;

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

      {!collapsed &&
        (simulation.computation ? (
          <RunProgress computation={simulation.computation} onCancel={simulation.cancelComputation} />
        ) : (
          <>
            {all.length === 0 ? (
              <div className="picking-panel__empty">
                No picking lists for this plant — load some from Overview → Load → Picking lists…
              </div>
            ) : (
              <label className="picking-panel__select-all">
                <input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={toggleAll} />
                <span>Select all ({formatCount(all.length)})</span>
              </label>
            )}

            <ul className="picking-panel__list" ref={catalogue.ref} onScroll={catalogue.onScroll}>
              <li className="picking-panel__spacer" aria-hidden="true" style={{ height: catalogue.before }} />
              {all.slice(catalogue.first, catalogue.last).map((list) => (
                <ListRow
                  key={list.id}
                  list={list}
                  checked={selected.has(list.id)}
                  onToggle={toggleSelected}
                  onPlay={playOne}
                />
              ))}
              <li className="picking-panel__spacer" aria-hidden="true" style={{ height: catalogue.after }} />
            </ul>

            <div className="picking-panel__actions">
              <button
                className="picking-panel__btn"
                disabled={selectedLists.length === 0}
                onClick={() => launch(selectedLists, false)}
                title="Compute the ticked lists, in order, then list their orders in the run console"
              >
                Run selected ({formatCount(selectedLists.length)})
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
        ))}

      {pending && (
        <CaptureConfirm
          count={pending.lists.length}
          onCancel={cancelPending}
          onCapture={() => {
            captureConfirmedRef.current = true;
            setPending(null);
            start(pending.lists, pending.show);
          }}
          onWithoutCapture={() => {
            simulation.setCaptureArmed(false);
            setPending(null);
            start(pending.lists, pending.show);
          }}
        />
      )}
    </div>
  );
}
