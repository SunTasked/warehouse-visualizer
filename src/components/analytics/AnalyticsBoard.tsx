import { useMemo, useState } from "react";
import { useEditor } from "../../state/EditorContext";
import { useSimulation } from "../../state/SimulationContext";
import { useAnalytics } from "../../state/AnalyticsContext";
import { formatDuration, scoreCapture, type ScorableRun } from "../../lib/metrics";
import { TIME_MODEL_FIELDS } from "../../lib/timeModel";
import { DecileChart, Splits, TimePie, type SplitSort } from "./Charts";

const GROUPS = ["Travel", "Pick / put", "Depot", "Tour"] as const;

function Score({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="score" title={hint}>
      <div className="score__value">{value}</div>
      <div className="score__label">{label}</div>
    </div>
  );
}

/** A snapshot's headline next to the current capture's, with the delta that actually answers "did this change help". */
function Delta({ current, baseline, lowerIsBetter = true }: { current: number; baseline: number; lowerIsBetter?: boolean }) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) return <span className="delta">–</span>;
  const change = ((current - baseline) / baseline) * 100;
  if (Math.abs(change) < 0.05) return <span className="delta">=</span>;
  const better = lowerIsBetter ? change < 0 : change > 0;
  return (
    <span className={better ? "delta delta--good" : "delta delta--bad"}>
      {change > 0 ? "+" : ""}
      {change.toFixed(1)}%
    </span>
  );
}

export function AnalyticsBoard() {
  const { warehouse } = useEditor();
  const simulation = useSimulation();
  const analytics = useAnalytics();
  const [snapshotName, setSnapshotName] = useState("");
  const [splitSort, setSplitSort] = useState<SplitSort>("index");

  // Recorded runs reduced to their scorable form — this is what both the
  // live board and every snapshot are scored from, so they stay comparable.
  const currentRuns = useMemo<ScorableRun[]>(
    () =>
      simulation.capturedRuns.map((run) => ({
        id: run.id,
        label: run.list.label,
        mode: run.list.mode,
        legs: run.profiles,
        handling: run.handling,
      })),
    [simulation.capturedRuns],
  );

  const metrics = useMemo(() => scoreCapture(currentRuns, analytics.settings), [currentRuns, analytics.settings]);
  // Snapshots are re-scored under the *current* settings, never the ones in
  // force when they were taken — otherwise a comparison would mix two time
  // models and the deltas would mean nothing.
  const snapshotMetrics = useMemo(
    () => analytics.snapshots.map((snap) => ({ snap, metrics: scoreCapture(snap.runs, analytics.settings) })),
    [analytics.snapshots, analytics.settings],
  );

  if (analytics.tab !== "performances") return null;

  const hasData = currentRuns.length > 0;
  const allTimeToSlot = metrics.runs.flatMap((run) => run.timeToSlot);

  const handleSave = () => {
    if (currentRuns.length === 0) return;
    analytics.saveSnapshot({
      name: snapshotName.trim() || `${warehouse.name} · ${currentRuns.length} runs`,
      warehouseName: warehouse.name,
      slotCount: warehouse.slots.length,
      runs: currentRuns,
    });
    setSnapshotName("");
  };

  return (
    <div className="board">
      <div className="board__header">
        <h2>Performances</h2>
        <span className="board__subtitle">
          {hasData
            ? `${currentRuns.length} recorded run${currentRuns.length === 1 ? "" : "s"} · ${metrics.totalPicks} picks · ${metrics.totalPuts} puts`
            : "Nothing recorded yet"}
        </span>
        <button className="board__close" onClick={() => analytics.setTab("overview")} title="Back to the warehouse">
          ×
        </button>
      </div>

      <div className="board__body">
        <div className="board__main">
          {!hasData ? (
            <div className="board__empty">
              <p>
                Arm <strong>Capture</strong> in the run console and play some picking lists.
              </p>
              <p>
                Every recorded run is scored here — and the model on the right re-scores them all instantly,
                with nothing re-run.
              </p>
            </div>
          ) : (
            <>
            <section className="board__section">
              <div className="board__scores">
                <Score
                  label="Mean time per pallet"
                  value={formatDuration(metrics.meanTimePerPick)}
                  hint="Whole-capture time divided by pallets handled — the headline comparison number"
                />
                <Score label="Median time to slot" value={formatDuration(metrics.medianTimeToSlot)} hint="Reaching a slot and working it" />
                <Score label="p90 time to slot" value={formatDuration(metrics.p90TimeToSlot)} hint="The slow tail" />
                <Score label="Travel share" value={`${(metrics.travelShare * 100).toFixed(0)}%`} hint="Time moving rather than handling — high means the racking is in the wrong places" />
                <Score label="Pallets / hour" value={metrics.picksPerHour.toFixed(1)} />
                <Score label="Total distance" value={`${metrics.totalDistance.toFixed(0)} m`} />
              </div>
            </section>

            <section className="board__section">
              <h3>Where the time goes</h3>
              <TimePie breakdown={metrics.breakdown as unknown as Record<string, number>} />
            </section>

            <section className="board__section">
              <h3>Time to slot — by decile</h3>
              <p className="board__note">
                P70 is the time 70% of slot visits came in under. Mean {formatDuration(metrics.meanTimeToSlot)},
                median {formatDuration(metrics.medianTimeToSlot)}.
              </p>
              <DecileChart values={allTimeToSlot} />
            </section>

            <section className="board__section">
              <h3>Per run</h3>
              <Splits
                rows={metrics.runs.map((run, i) => ({
                  index: i,
                  label: run.label,
                  mode: run.mode,
                  perPallet: run.picks + run.puts > 0 ? run.totalTime / (run.picks + run.puts) : run.totalTime,
                  totalTime: run.totalTime,
                  steps: run.picks + run.puts,
                }))}
                sort={splitSort}
                onSortChange={setSplitSort}
              />
              <p className="board__note">Time per pallet handled, so tours of different lengths compare fairly. Amber = storing.</p>
            </section>

            <section className="board__section">
              <h3>Comparison</h3>
              <div className="board__snapshot-save">
                <input
                  type="text"
                  placeholder="Name this configuration…"
                  value={snapshotName}
                  onChange={(e) => setSnapshotName(e.target.value)}
                />
                <button onClick={handleSave}>Save current as snapshot</button>
              </div>
              <table className="board__table">
                <thead>
                  <tr>
                    <th>Configuration</th>
                    <th>Runs</th>
                    <th>Mean / pallet</th>
                    <th>Median to slot</th>
                    <th>Travel share</th>
                    <th>Distance</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr className="board__row--current">
                    <td>
                      <strong>Current</strong> <span className="board__muted">{warehouse.name}</span>
                    </td>
                    <td>{currentRuns.length}</td>
                    <td>{formatDuration(metrics.meanTimePerPick)}</td>
                    <td>{formatDuration(metrics.medianTimeToSlot)}</td>
                    <td>{(metrics.travelShare * 100).toFixed(0)}%</td>
                    <td>{metrics.totalDistance.toFixed(0)} m</td>
                    <td />
                  </tr>
                  {snapshotMetrics.map(({ snap, metrics: snapMetrics }) => (
                    <tr key={snap.id}>
                      <td>
                        {snap.name} <span className="board__muted">{snap.slotCount} slots</span>
                      </td>
                      <td>{snap.runs.length}</td>
                      <td>
                        {formatDuration(snapMetrics.meanTimePerPick)}{" "}
                        <Delta current={metrics.meanTimePerPick} baseline={snapMetrics.meanTimePerPick} />
                      </td>
                      <td>
                        {formatDuration(snapMetrics.medianTimeToSlot)}{" "}
                        <Delta current={metrics.medianTimeToSlot} baseline={snapMetrics.medianTimeToSlot} />
                      </td>
                      <td>{(snapMetrics.travelShare * 100).toFixed(0)}%</td>
                      <td>{snapMetrics.totalDistance.toFixed(0)} m</td>
                      <td>
                        <button className="board__remove" onClick={() => analytics.removeSnapshot(snap.id)} title="Delete snapshot">
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {snapshotMetrics.length > 0 && (
                <p className="board__note">
                  Deltas compare the current capture against each snapshot. Snapshots are re-scored under the
                  settings below, so changing a parameter moves every row together.
                </p>
              )}
            </section>
            </>
          )}
        </div>

        <aside className="board__settings">
            <div className="board__settings-head">
              <h3>Computation</h3>
              <button className="board__reset" onClick={analytics.resetSettings}>
                Reset
              </button>
            </div>
            <p className="board__note">Changes re-score everything immediately — nothing is re-run.</p>
            {GROUPS.map((group) => (
              <div className="settings-group" key={group}>
                <div className="settings-group__title">{group}</div>
                {TIME_MODEL_FIELDS.filter((field) => field.group === group).map((field) => (
                  <label className="settings-field" key={field.key} title={field.hint}>
                    <span className="settings-field__label">{field.label}</span>
                    <span className="settings-field__input">
                      <input
                        type="number"
                        min={0}
                        step={field.step}
                        value={analytics.settings[field.key]}
                        onChange={(e) =>
                          analytics.setSetting(field.key, Math.max(0, Number(e.target.value) || 0))
                        }
                      />
                      <span className="settings-field__unit">{field.unit}</span>
                    </span>
                  </label>
                ))}
              </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
