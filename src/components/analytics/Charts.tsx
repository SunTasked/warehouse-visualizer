import { formatDuration } from "../../lib/metrics";

/**
 * Hand-rolled SVG charts (specs.md §5.5). Deliberately no charting library:
 * three small chart shapes don't justify a dependency, and plain SVG keeps
 * the styling consistent with the rest of the overlays.
 */

const BAR_COLOR = "#4d7cfe";
const BAR_COLOR_ALT = "#f59e0b";

export function BarChart({
  data,
  height = 160,
  format = formatDuration,
}: {
  data: Array<{ label: string; value: number; alt?: boolean }>;
  height?: number;
  format?: (value: number) => string;
}) {
  if (data.length === 0) return <div className="chart__empty">No data yet.</div>;
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="chart">
      <div className="chart__bars" style={{ height }}>
        {data.map((d, i) => (
          <div className="chart__bar-col" key={i} title={`${d.label}: ${format(d.value)}`}>
            <div className="chart__bar-value">{format(d.value)}</div>
            <div
              className="chart__bar"
              style={{
                height: `${(d.value / max) * 100}%`,
                background: d.alt ? BAR_COLOR_ALT : BAR_COLOR,
              }}
            />
            <div className="chart__bar-label">{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Distribution of per-slot times — the shape behind the mean/median/p90 figures. */
export function Histogram({ values, bins = 10 }: { values: number[]; bins?: number }) {
  if (values.length === 0) return <div className="chart__empty">No slot visits recorded yet.</div>;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = span / bins;
  const counts = Array.from({ length: bins }, () => 0);
  for (const value of values) {
    // The maximum value would land one past the last bin.
    const index = Math.min(bins - 1, Math.floor((value - min) / width));
    counts[index] += 1;
  }
  const peak = Math.max(...counts, 1);

  return (
    <div className="chart">
      <div className="chart__bars chart__bars--tight" style={{ height: 140 }}>
        {counts.map((count, i) => (
          <div
            className="chart__bar-col"
            key={i}
            title={`${formatDuration(min + i * width)} – ${formatDuration(min + (i + 1) * width)}: ${count} visit${count === 1 ? "" : "s"}`}
          >
            <div className="chart__bar" style={{ height: `${(count / peak) * 100}%`, background: BAR_COLOR }} />
          </div>
        ))}
      </div>
      <div className="chart__axis">
        <span>{formatDuration(min)}</span>
        <span>{formatDuration(max)}</span>
      </div>
    </div>
  );
}

const BREAKDOWN_COLORS: Record<string, string> = {
  travel: "#4d7cfe",
  turns: "#7c9cff",
  base: "#22c55e",
  tier: "#f59e0b",
  depth: "#dc2626",
  unload: "#8b5cf6",
  load: "#a78bfa",
  overhead: "#94a3b8",
};

const BREAKDOWN_LABELS: Record<string, string> = {
  travel: "Travel",
  turns: "Turns",
  base: "Handling",
  tier: "Tier height",
  depth: "Slot depth",
  unload: "Unload",
  load: "Load",
  overhead: "Tour overhead",
};

/** Where the time actually goes — the most actionable chart on the board, since each band maps to a lever you can pull. */
export function BreakdownBar({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown).filter(([, value]) => value > 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return <div className="chart__empty">No time recorded yet.</div>;

  return (
    <div className="breakdown">
      <div className="breakdown__bar">
        {entries.map(([key, value]) => (
          <div
            key={key}
            className="breakdown__band"
            style={{ width: `${(value / total) * 100}%`, background: BREAKDOWN_COLORS[key] ?? "#94a3b8" }}
            title={`${BREAKDOWN_LABELS[key] ?? key}: ${formatDuration(value)} (${((value / total) * 100).toFixed(1)}%)`}
          />
        ))}
      </div>
      <ul className="breakdown__legend">
        {entries
          .sort((a, b) => b[1] - a[1])
          .map(([key, value]) => (
            <li key={key}>
              <span className="breakdown__swatch" style={{ background: BREAKDOWN_COLORS[key] ?? "#94a3b8" }} />
              <span className="breakdown__name">{BREAKDOWN_LABELS[key] ?? key}</span>
              <span className="breakdown__value">{formatDuration(value)}</span>
              <span className="breakdown__pct">{((value / total) * 100).toFixed(0)}%</span>
            </li>
          ))}
      </ul>
    </div>
  );
}
