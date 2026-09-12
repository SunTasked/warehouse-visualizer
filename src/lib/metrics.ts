import {
  handlingBreakdown,
  handlingTime,
  legTravelTime,
  type LegProfile,
  type StopHandling,
  type TimeModelSettings,
} from "./timeModel";

/** The scoreable shape of a recorded run — deliberately not the run itself, so metrics don't depend on routes, geometry or the live warehouse. */
export interface ScorableRun {
  id: string;
  label: string;
  mode: "picking" | "storing";
  /** One per leg; leg i runs stop i -> stop i+1. */
  legs: LegProfile[];
  /** One per stop, parallel to the run's own stops. */
  handling: StopHandling[];
}

export interface RunMetrics {
  id: string;
  label: string;
  mode: "picking" | "storing";
  totalTime: number;
  travelTime: number;
  handlingTime: number;
  overhead: number;
  distance: number;
  picks: number;
  puts: number;
  /** Time to reach each slot and work it: the arriving leg plus that slot's own handling. The distribution behind "time to slot". */
  timeToSlot: number[];
}

export interface Breakdown {
  travel: number;
  turns: number;
  base: number;
  tier: number;
  depth: number;
  unload: number;
  load: number;
  overhead: number;
}

export interface CaptureMetrics {
  runs: RunMetrics[];
  totalTime: number;
  totalDistance: number;
  totalPicks: number;
  totalPuts: number;
  /** Headline: whole-capture time divided by pallets handled. Normalises away tour length and pick count, so any two captures compare directly. */
  meanTimePerPick: number;
  /** Distribution of per-slot times (see RunMetrics.timeToSlot). */
  meanTimeToSlot: number;
  medianTimeToSlot: number;
  p90TimeToSlot: number;
  /** Share of tour time spent moving rather than working — the layout-diagnostic number. */
  travelShare: number;
  picksPerHour: number;
  breakdown: Breakdown;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function median(values: number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

function emptyBreakdown(): Breakdown {
  return { travel: 0, turns: 0, base: 0, tier: 0, depth: 0, unload: 0, load: 0, overhead: 0 };
}

export function scoreRun(run: ScorableRun, settings: TimeModelSettings): RunMetrics {
  let travelTime = 0;
  let handling = 0;
  let distance = 0;
  let picks = 0;
  let puts = 0;
  const timeToSlot: number[] = [];

  for (const leg of run.legs) {
    travelTime += legTravelTime(leg, settings);
    distance += leg.segmentLengths.reduce((sum, length) => sum + length, 0);
  }

  run.handling.forEach((stop, stopIndex) => {
    const stopTime = handlingTime(stop, settings);
    handling += stopTime;
    if (stop.kind === "pick") picks += 1;
    if (stop.kind === "store") puts += 1;

    // "Time to slot": reaching it and working it. Leg stopIndex-1 is the one
    // that arrives here; the very first stop is the depot the tour starts
    // from, so nothing leads to it.
    if ((stop.kind === "pick" || stop.kind === "store") && stopIndex > 0) {
      const arriving = run.legs[stopIndex - 1];
      timeToSlot.push((arriving ? legTravelTime(arriving, settings) : 0) + stopTime);
    }
  });

  return {
    id: run.id,
    label: run.label,
    mode: run.mode,
    totalTime: travelTime + handling + settings.tourOverhead,
    travelTime,
    handlingTime: handling,
    overhead: settings.tourOverhead,
    distance,
    picks,
    puts,
    timeToSlot,
  };
}

export function scoreCapture(runs: ScorableRun[], settings: TimeModelSettings): CaptureMetrics {
  const scored = runs.map((run) => scoreRun(run, settings));
  const breakdown = emptyBreakdown();

  for (const run of runs) {
    for (const leg of run.legs) {
      breakdown.travel += leg.segmentLengths.reduce(
        (total, length) => total + legTravelTime({ segmentLengths: [length], turns: 0 }, settings),
        0,
      );
      breakdown.turns += leg.turns * settings.turnPenalty;
    }
    for (const stop of run.handling) {
      const parts = handlingBreakdown(stop, settings);
      breakdown.base += parts.base;
      breakdown.tier += parts.tier;
      breakdown.depth += parts.depth;
      breakdown.unload += parts.unload;
      breakdown.load += parts.load;
    }
    breakdown.overhead += settings.tourOverhead;
  }

  const totalTime = scored.reduce((sum, run) => sum + run.totalTime, 0);
  const travelTime = scored.reduce((sum, run) => sum + run.travelTime, 0);
  const totalDistance = scored.reduce((sum, run) => sum + run.distance, 0);
  const totalPicks = scored.reduce((sum, run) => sum + run.picks, 0);
  const totalPuts = scored.reduce((sum, run) => sum + run.puts, 0);
  // Both directions are a pallet moved, and a storing tour is just as real a
  // use of the warehouse as a picking one — so the headline counts either.
  const handled = totalPicks + totalPuts;

  const allTimeToSlot = scored.flatMap((run) => run.timeToSlot);
  const sorted = [...allTimeToSlot].sort((a, b) => a - b);

  return {
    runs: scored,
    totalTime,
    totalDistance,
    totalPicks,
    totalPuts,
    meanTimePerPick: handled > 0 ? totalTime / handled : 0,
    meanTimeToSlot: allTimeToSlot.length > 0 ? allTimeToSlot.reduce((a, b) => a + b, 0) / allTimeToSlot.length : 0,
    medianTimeToSlot: quantile(sorted, 0.5),
    p90TimeToSlot: quantile(sorted, 0.9),
    travelShare: totalTime > 0 ? travelTime / totalTime : 0,
    picksPerHour: totalTime > 0 ? (handled * 3600) / totalTime : 0,
    breakdown,
  };
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "–";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${String(rest).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}
