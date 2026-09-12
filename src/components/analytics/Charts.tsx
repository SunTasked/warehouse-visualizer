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

/**
 * Where the time goes, as a pie with each label tethered to its own slice by
 * a leader line (specs.md §5.5) — a legend in a separate block makes you
 * match colours by eye, which is exactly the work the arrows remove. Slices
 * too thin to label without colliding drop to the overflow list underneath.
 */
export function TimePie({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return <div className="chart__empty">No time recorded yet.</div>;

  const width = 460;
  const cx = width / 2;
  const cy = 175;
  const radius = 100;
  const labelRadius = radius + 32;
  const MIN_LABEL_SHARE = 0.04;

  let angle = -Math.PI / 2; // start at twelve o'clock
  const slices = entries.map(([key, value]) => {
    const share = value / total;
    const sweep = share * Math.PI * 2;
    const slice = { key, value, share, start: angle, end: angle + sweep, mid: angle + sweep / 2 };
    angle = slice.end;
    return slice;
  });

  const point = (a: number, r: number) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;

  return (
    <div className="pie">
      <svg viewBox={`0 0 ${width} 320`} className="pie__svg" role="img" aria-label="Time breakdown">
        {slices.map((slice) => {
          const [sx, sy] = point(slice.start, radius);
          const [ex, ey] = point(slice.end, radius);
          const large = slice.end - slice.start > Math.PI ? 1 : 0;
          // A slice covering everything has coincident start and end points,
          // which an arc can't express — draw the whole disc instead.
          const d =
            slice.share >= 0.999
              ? `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx - 0.01} ${cy - radius} Z`
              : `M ${cx} ${cy} L ${sx} ${sy} A ${radius} ${radius} 0 ${large} 1 ${ex} ${ey} Z`;
          return (
            <path key={slice.key} d={d} fill={BREAKDOWN_COLORS[slice.key] ?? "#94a3b8"}>
              <title>{`${BREAKDOWN_LABELS[slice.key] ?? slice.key}: ${formatDuration(slice.value)}`}</title>
            </path>
          );
        })}

        {slices
          .filter((slice) => slice.share >= MIN_LABEL_SHARE)
          .map((slice) => {
            const [ax, ay] = point(slice.mid, radius);
            const [bx, by] = point(slice.mid, labelRadius);
            const toRight = Math.cos(slice.mid) >= 0;
            const tx = toRight ? bx + 10 : bx - 10;
            return (
              <g key={`label-${slice.key}`} className="pie__label">
                <polyline points={`${ax},${ay} ${bx},${by} ${tx},${by}`} fill="none" stroke="#9aa3b5" strokeWidth={1} />
                <circle cx={ax} cy={ay} r={2} fill="#9aa3b5" />
                <text x={toRight ? tx + 4 : tx - 4} y={by - 2} textAnchor={toRight ? "start" : "end"}>
                  {BREAKDOWN_LABELS[slice.key] ?? slice.key}
                </text>
                <text
                  x={toRight ? tx + 4 : tx - 4}
                  y={by + 11}
                  textAnchor={toRight ? "start" : "end"}
                  className="pie__label-value"
                >
                  {formatDuration(slice.value)} · {(slice.share * 100).toFixed(0)}%
                </text>
              </g>
            );
          })}
      </svg>

      {slices.some((slice) => slice.share < MIN_LABEL_SHARE) && (
        <ul className="pie__rest">
          {slices
            .filter((slice) => slice.share < MIN_LABEL_SHARE)
            .map((slice) => (
              <li key={slice.key}>
                <span className="breakdown__swatch" style={{ background: BREAKDOWN_COLORS[slice.key] ?? "#94a3b8" }} />
                <span className="breakdown__name">{BREAKDOWN_LABELS[slice.key] ?? slice.key}</span>
                <span className="breakdown__value">{formatDuration(slice.value)}</span>
                <span className="breakdown__pct">{(slice.share * 100).toFixed(1)}%</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Deciles of the time-to-slot distribution: point 7 is the time 70% of slot
 * visits came in under. Reads the tail far better than a histogram at these
 * sample sizes — with a few dozen visits, bin counts are mostly noise,
 * whereas the decile curve is stable and answers "how bad does it get".
 */
export function DecileChart({ values }: { values: number[] }) {
  if (values.length === 0) return <div className="chart__empty">No slot visits recorded yet.</div>;

  const sorted = [...values].sort((a, b) => a - b);
  const deciles = Array.from({ length: 10 }, (_, i) => {
    const position = (sorted.length - 1) * ((i + 1) / 10);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const value =
      lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
    return { decile: i + 1, value };
  });
  const max = Math.max(...deciles.map((d) => d.value), 1);

  return (
    <div className="chart">
      <div className="chart__bars" style={{ height: 150 }}>
        {deciles.map((d) => (
          <div
            className="chart__bar-col"
            key={d.decile}
            title={`${d.decile * 10}% of slot visits took ${formatDuration(d.value)} or less`}
          >
            <div className="chart__bar-value">{formatDuration(d.value)}</div>
            <div
              className="chart__bar"
              style={{ height: `${(d.value / max) * 100}%`, background: d.decile === 5 ? BAR_COLOR_ALT : BAR_COLOR }}
            />
            <div className="chart__bar-label">P{d.decile * 10}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface SplitRow {
  index: number;
  label: string;
  mode: "picking" | "storing";
  /** What the bar length encodes: time per pallet, so tours of different sizes compare. */
  perPallet: number;
  totalTime: number;
  steps: number;
}

export type SplitSort = "index" | "time" | "steps";

/** Run splits laid out like the km splits on a running activity: one row each, bar length proportional to the slowest. Scrolls past five rows so a long session can't push the rest of the board off screen. */
export function Splits({
  rows,
  sort,
  onSortChange,
}: {
  rows: SplitRow[];
  sort: SplitSort;
  onSortChange: (sort: SplitSort) => void;
}) {
  if (rows.length === 0) return <div className="chart__empty">No runs recorded yet.</div>;

  const sorted = [...rows].sort((a, b) => {
    if (sort === "time") return b.perPallet - a.perPallet;
    if (sort === "steps") return b.steps - a.steps;
    return a.index - b.index;
  });
  const max = Math.max(...rows.map((row) => row.perPallet), 1);

  const header = (key: SplitSort, label: string) => (
    <button
      className={sort === key ? "splits__sort splits__sort--active" : "splits__sort"}
      onClick={() => onSortChange(key)}
      title={`Order by ${label.toLowerCase()}`}
    >
      {label}
    </button>
  );

  return (
    <div className="splits">
      <div className="splits__head">
        {header("index", "#")}
        {header("time", "Per pallet")}
        <span className="splits__spacer" />
        {header("steps", "Steps")}
      </div>
      <div className="splits__scroll">
        {sorted.map((row) => (
          <div className="splits__row" key={row.index} title={`${row.label} — ${formatDuration(row.totalTime)} total`}>
            <span className="splits__index">{row.index + 1}</span>
            <span className="splits__time">{formatDuration(row.perPallet)}</span>
            <span className="splits__bar-cell">
              <span
                className="splits__bar"
                style={{
                  width: `${(row.perPallet / max) * 100}%`,
                  background: row.mode === "storing" ? BAR_COLOR_ALT : BAR_COLOR,
                }}
              />
              <span className="splits__name">{row.label}</span>
            </span>
            <span className="splits__steps">{row.steps}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
