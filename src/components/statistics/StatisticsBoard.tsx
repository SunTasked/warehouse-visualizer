import { useMemo } from "react";
import { useEditor } from "../../state/EditorContext";
import { useAnalytics } from "../../state/AnalyticsContext";
import { PALLET_FULL_ITEMS } from "../../lib/stock";
import { share, stockStatistics, type StockFigures } from "../../lib/stockStats";
import { Score } from "../analytics/AnalyticsBoard";

const count = (n: number) => n.toLocaleString("en-US");
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

function FillBar({ value }: { value: number }) {
  return (
    <span className="fill-bar">
      <span className="fill-bar__track">
        <span className="fill-bar__fill" style={{ width: `${Math.min(1, value) * 100}%` }} />
      </span>
      <span className="fill-bar__value">{percent(value)}</span>
    </span>
  );
}

/** A number of slots, with its share of them beside it. */
function SlotShare({ part, whole }: { part: number; whole: number }) {
  return (
    <>
      {count(part)} <span className="board__muted">{percent(share(part, whole))}</span>
    </>
  );
}

function FiguresRow({ label, figures, total = false }: { label: string; figures: StockFigures; total?: boolean }) {
  return (
    <tr className={total ? "stats__total" : undefined}>
      <td>{label}</td>
      <td>{count(figures.slots)}</td>
      <td>{count(figures.capacity)}</td>
      <td>{count(figures.pallets)}</td>
      <td>
        <FillBar value={share(figures.pallets, figures.capacity)} />
      </td>
      <td>{figures.pallets > 0 ? percent(share(figures.incompletePallets, figures.pallets)) : "–"}</td>
      <td>
        <SlotShare part={figures.emptySlots} whole={figures.slots} />
      </td>
      <td>
        <SlotShare part={figures.fullSlots} whole={figures.slots} />
      </td>
    </tr>
  );
}

/**
 * The Statistics tab (specs.md §5.6): what the racks hold against what they
 * can, for the whole plant and building by building. Read off the warehouse
 * on screen, so it follows every edit, load and simulated batch.
 */
export function StatisticsBoard() {
  const { warehouse } = useEditor();
  const analytics = useAnalytics();
  const showing = analytics.tab === "statistics";
  // Worked out only while the tab is showing, like the performance scores.
  const stats = useMemo(() => (showing ? stockStatistics(warehouse) : null), [showing, warehouse]);
  if (!stats) return null;

  const { plant, buildings, levels } = stats;
  const outside = plant.slots - buildings.reduce((sum, building) => sum + building.slots, 0);

  return (
    <div className="board">
      <div className="board__header">
        <h2>Statistics</h2>
        <span className="board__subtitle">
          {warehouse.name} · {count(plant.slots)} slots in {buildings.length} building{buildings.length === 1 ? "" : "s"} · the
          stock as it stands now
        </span>
        <button className="board__close" onClick={() => analytics.setTab("overview")} title="Back to the warehouse">
          ×
        </button>
      </div>

      <div className="board__body">
        <div className="board__main">
          <section className="board__section">
            <h3>Whole plant</h3>
            <div className="board__scores">
              <Score
                label="Capacity (pallets)"
                value={count(plant.capacity)}
                hint={`Each slot's depth × ${levels} levels, over ${count(plant.slots)} slots`}
              />
              <Score label="Pallets stored" value={count(plant.pallets)} hint={`${count(plant.items)} items on them`} />
              <Score label="Fill rate" value={percent(share(plant.pallets, plant.capacity))} hint="Pallets stored against capacity" />
              <Score
                label="Incomplete pallets"
                value={plant.pallets > 0 ? percent(share(plant.incompletePallets, plant.pallets)) : "–"}
                hint={`${count(plant.incompletePallets)} pallets carry fewer than ${PALLET_FULL_ITEMS} items`}
              />
              <Score
                label="Empty slots"
                value={percent(share(plant.emptySlots, plant.slots))}
                hint={`${count(plant.emptySlots)} of ${count(plant.slots)} slots hold nothing`}
              />
              <Score
                label="Full slots"
                value={percent(share(plant.fullSlots, plant.slots))}
                hint={`${count(plant.fullSlots)} slots have no room for another pallet`}
              />
            </div>
          </section>

          <section className="board__section">
            <h3>By building</h3>
            <div className="stats__scroll">
              <table className="board__table stats__table">
                <thead>
                  <tr>
                    <th>Building</th>
                    <th>Slots</th>
                    <th>Capacity</th>
                    <th>Pallets</th>
                    <th>Fill rate</th>
                    <th>Incomplete pallets</th>
                    <th>Empty slots</th>
                    <th>Full slots</th>
                  </tr>
                </thead>
                <tbody>
                  {buildings.map((building) => (
                    <FiguresRow key={building.id} label={building.id} figures={building} />
                  ))}
                  <FiguresRow label="Whole plant" figures={plant} total />
                </tbody>
              </table>
            </div>
            <p className="board__note">
              Capacity is each slot's depth × {levels} levels, the stack height the plan gives its slots. A pallet is
              incomplete when it carries fewer than {PALLET_FULL_ITEMS} items; a slot is full when it has no room for another
              pallet.
              {outside > 0 && ` ${count(outside)} slots stand in no building, so they count towards the whole plant only.`}
            </p>
            {plant.overfilledSlots > 0 && (
              <p className="board__note stats__warning">
                {count(plant.overfilledSlots)} slots hold more pallets than their capacity.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
