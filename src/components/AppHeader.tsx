import { useEffect, useRef, useState } from "react";
import { useEditor } from "../state/EditorContext";
import { useSimulation } from "../state/SimulationContext";
import { useAnalytics } from "../state/AnalyticsContext";

/**
 * Title, warehouse identity and the two top-level tabs (specs.md §5.6).
 * Performances is gated on there being something to look at — the board is
 * meaningless without a recorded session, and a disabled tab says that more
 * plainly than an empty board would.
 */
export function AppHeader() {
  const { warehouse, mode, setMode, setAddSlotMode, dirty, save, load } = useEditor();
  const simulation = useSimulation();
  const analytics = useAnalytics();
  const [showInfo, setShowInfo] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const hasSession = simulation.capturedRuns.length > 0;
  const wallCount = warehouse.walls.length;

  // A menu that stays open after you click past it is worse than no menu.
  useEffect(() => {
    if (!showMenu) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setShowMenu(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [showMenu]);

  const select = (tab: "overview" | "performances") => {
    if (tab === "performances" && !hasSession) return;
    analytics.setTab(tab);
  };

  /**
   * Entering edit mode discards the session: every recorded route was
   * computed against the layout that is about to change, so keeping the runs
   * would mean scoring journeys that can no longer happen. The cost is
   * spelled out rather than left to a generic "are you sure" — losing a
   * baseline you were about to compare against is worth naming precisely.
   */
  const toggleMode = () => {
    setShowMenu(false);
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
    <header className="app__header">
      <div className="app__title-row">
        <h1>Warehouse benchmarker</h1>
        <div className="app__subtitle">
          <span>{warehouse.name}</span>
          <button
            className="app__info"
            onClick={() => setShowInfo((v) => !v)}
            onBlur={() => setShowInfo(false)}
            title="Warehouse details"
            aria-label="Warehouse details"
          >
            i
          </button>
          {showInfo && (
            <div className="app__info-card">
              <div className="app__info-row">
                <span>Buildings</span>
                <span>{wallCount}</span>
              </div>
              <div className="app__info-row">
                <span>Slots</span>
                <span>{warehouse.slots.length}</span>
              </div>
              <div className="app__info-row">
                <span>Paths</span>
                <span>{warehouse.paths.length}</span>
              </div>
              <div className="app__info-row">
                <span>Doors</span>
                <span>{warehouse.doors.length}</span>
              </div>
              <div className="app__info-row">
                <span>Lift stations</span>
                <span>{warehouse.liftStations.length}</span>
              </div>
              <div className="app__info-row">
                <span>Delivery spaces</span>
                <span>{warehouse.deliverySpaces.length}</span>
              </div>
              <div className="app__info-row">
                <span>Recorded runs</span>
                <span>{simulation.capturedRuns.length}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <nav className="app__tabs">
        {/* Overview doubles as the app menu: selecting the tab and opening
            the file/edit actions are the same click, the way a menu-bar item
            behaves. */}
        <div className="app__menu" ref={menuRef}>
          <button
            className={analytics.tab === "overview" ? "app__tab app__tab--active" : "app__tab"}
            onClick={() => {
              select("overview");
              setShowMenu((v) => !v);
            }}
            title="Warehouse view · file and edit actions"
          >
            Overview
            {dirty && <span className="app__tab-dot" title="Unsaved changes" />}
            <span className="app__tab-caret">▾</span>
          </button>

          {showMenu && (
            <div className="app__menu-list">
              {dirty && <div className="app__menu-note">● unsaved changes</div>}
              <button
                className="app__menu-item"
                onClick={() => {
                  setShowMenu(false);
                  void load();
                }}
              >
                Load…
              </button>
              <button
                className="app__menu-item"
                onClick={() => {
                  setShowMenu(false);
                  void save();
                }}
              >
                Save
              </button>
              <div className="app__menu-sep" />
              <button className="app__menu-item" onClick={toggleMode}>
                {mode === "edit" ? "Done editing" : "Edit layout…"}
              </button>
            </div>
          )}
        </div>
        <button
          className={analytics.tab === "performances" ? "app__tab app__tab--active" : "app__tab"}
          onClick={() => select("performances")}
          disabled={!hasSession || mode === "edit"}
          title={
            mode === "edit"
              ? "Leave edit mode to see performances"
              : hasSession
                ? "Time and throughput for the recorded session"
                : "Record a session first — arm Capture and play some lists"
          }
        >
          Performances
        </button>
      </nav>
    </header>
  );
}
