/**
 * How long a picking tour takes (specs.md §5.5). Every recorded run carries a
 * geometry-free profile (see LegProfile) and a resolved handling description
 * per stop, so tour time is a pure function of those plus these settings —
 * which means changing a parameter re-scores an entire capture instantly,
 * with nothing re-run and no routes recomputed.
 */
export interface TimeModelSettings {
  /** Top travel speed, m/s. */
  speed: number;
  /** How briskly it gets to (and off) that speed, m/s². Short hops never reach top speed at all, which is why this matters more than it looks. */
  acceleration: number;
  /** Seconds lost to each direction change, on top of the deceleration the profile already implies. */
  turnPenalty: number;
  /** Seconds for one pick or put with the pallet at floor level, at the front of the slot. */
  baseHandling: number;
  /** Extra seconds per tier above the floor — mast raise and lower. */
  perTier: number;
  /** Extra seconds per sub-slot of depth beyond the front one — reaching past what's in front. */
  perDepth: number;
  /** Seconds to drop one pallet at a delivery space. */
  unloadPerPallet: number;
  /** Seconds to take one pallet on at a delivery space. */
  loadPerPallet: number;
  /** Fixed seconds charged once per tour — docking, paperwork, scanning. */
  tourOverhead: number;
}

export const DEFAULT_TIME_MODEL: TimeModelSettings = {
  speed: 2,
  acceleration: 0.8,
  turnPenalty: 2,
  baseHandling: 15,
  perTier: 3,
  perDepth: 8,
  unloadPerPallet: 10,
  loadPerPallet: 8,
  tourOverhead: 20,
};

export const TIME_MODEL_FIELDS: Array<{
  key: keyof TimeModelSettings;
  label: string;
  unit: string;
  group: "Travel" | "Pick / put" | "Depot" | "Tour";
  step: number;
  hint: string;
}> = [
  { key: "speed", label: "Travel speed", unit: "m/s", group: "Travel", step: 0.1, hint: "Top speed on a straight run" },
  { key: "acceleration", label: "Acceleration", unit: "m/s²", group: "Travel", step: 0.1, hint: "Also used for braking; short hops never reach top speed" },
  { key: "turnPenalty", label: "Turn penalty", unit: "s", group: "Travel", step: 0.5, hint: "Per direction change along a leg" },
  { key: "baseHandling", label: "Base handling", unit: "s", group: "Pick / put", step: 1, hint: "One pick or put, front of slot, floor level" },
  { key: "perTier", label: "Per tier above floor", unit: "s", group: "Pick / put", step: 0.5, hint: "Mast raise and lower" },
  { key: "perDepth", label: "Per extra slot depth", unit: "s", group: "Pick / put", step: 0.5, hint: "Reaching past pallets in front" },
  { key: "unloadPerPallet", label: "Unload per pallet", unit: "s", group: "Depot", step: 1, hint: "Dropping at a delivery space" },
  { key: "loadPerPallet", label: "Load per pallet", unit: "s", group: "Depot", step: 1, hint: "Taking on at a delivery space" },
  { key: "tourOverhead", label: "Tour overhead", unit: "s", group: "Tour", step: 1, hint: "Charged once per list" },
];

/** A leg reduced to what the time model needs: no coordinates, just how far each straight run is and how many turns join them. Keeps recorded runs small enough to persist, and decouples scoring from geometry entirely. */
export interface LegProfile {
  segmentLengths: number[];
  turns: number;
}

/** What a stop costs to work, resolved at record time against the inventory as it stood then (see resolveHandling in SimulationContext). */
export type StopHandling =
  | { kind: "pick" | "store"; subSlotIndex: number; tierIndex: number }
  | { kind: "deliver" | "load"; pallets: number }
  | { kind: "none" };

/**
 * Time to cover one straight run, accelerating from rest and braking back to
 * rest. Below twice the ramp distance the vehicle never reaches top speed and
 * the profile is triangular — which is exactly the regime most warehouse legs
 * live in, and why a flat distance/speed model flatters short-hop layouts.
 */
function straightRunTime(distance: number, speed: number, acceleration: number): number {
  if (distance <= 0) return 0;
  if (acceleration <= 0) return distance / speed;
  const rampDistance = (speed * speed) / (2 * acceleration);
  if (distance >= 2 * rampDistance) {
    const rampTime = speed / acceleration;
    return 2 * rampTime + (distance - 2 * rampDistance) / speed;
  }
  return 2 * Math.sqrt(distance / acceleration);
}

export function legTravelTime(profile: LegProfile, settings: TimeModelSettings): number {
  const runs = profile.segmentLengths.reduce(
    (total, length) => total + straightRunTime(length, settings.speed, settings.acceleration),
    0,
  );
  return runs + profile.turns * settings.turnPenalty;
}

export function handlingTime(handling: StopHandling, settings: TimeModelSettings): number {
  switch (handling.kind) {
    case "pick":
    case "store":
      return (
        settings.baseHandling + handling.tierIndex * settings.perTier + handling.subSlotIndex * settings.perDepth
      );
    case "deliver":
      return handling.pallets * settings.unloadPerPallet;
    case "load":
      return handling.pallets * settings.loadPerPallet;
    default:
      return 0;
  }
}

/** Splits handling into its parts, for the board's breakdown chart. */
export function handlingBreakdown(
  handling: StopHandling,
  settings: TimeModelSettings,
): { base: number; tier: number; depth: number; unload: number; load: number } {
  const zero = { base: 0, tier: 0, depth: 0, unload: 0, load: 0 };
  switch (handling.kind) {
    case "pick":
    case "store":
      return {
        ...zero,
        base: settings.baseHandling,
        tier: handling.tierIndex * settings.perTier,
        depth: handling.subSlotIndex * settings.perDepth,
      };
    case "deliver":
      return { ...zero, unload: handling.pallets * settings.unloadPerPallet };
    case "load":
      return { ...zero, load: handling.pallets * settings.loadPerPallet };
    default:
      return zero;
  }
}
