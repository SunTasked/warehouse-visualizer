import { useState } from "react";
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
  const { warehouse, mode } = useEditor();
  const simulation = useSimulation();
  const analytics = useAnalytics();
  const [showInfo, setShowInfo] = useState(false);

  const hasSession = simulation.capturedRuns.length > 0;
  const wallCount = warehouse.walls.length;

  const select = (tab: "overview" | "performances") => {
    if (tab === "performances" && !hasSession) return;
    analytics.setTab(tab);
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
        <button
          className={analytics.tab === "overview" ? "app__tab app__tab--active" : "app__tab"}
          onClick={() => select("overview")}
        >
          Overview
        </button>
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
