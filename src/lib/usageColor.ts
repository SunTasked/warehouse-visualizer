// Green-yellow-red scale for the picking-list route usage coloring (§5.3):
// green = the lowest nonzero count seen across the whole warehouse, red =
// the highest, with a yellow/orange midpoint (per user feedback — a direct
// two-stop green->red lerp passes through a muddy olive/brown around the
// middle instead of a legible "medium" color). An unused segment (count 0)
// isn't on the scale at all — it stays the infrastructure paths' own
// neutral color, since "green" already means "used, just least" and 0 uses
// is a different fact than that.
const STOPS = [
  { r: 0x22, g: 0xc5, b: 0x5e }, // green-500
  { r: 0xf5, g: 0x9e, b: 0x0b }, // amber-500
  { r: 0xdc, g: 0x26, b: 0x26 }, // red-600
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/** Maps a t in [0,1] onto the STOPS gradient (green -> amber -> red). */
function colorAt(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(scaled));
  const localT = scaled - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  const r = lerp(a.r, b.r, localT);
  const g = lerp(a.g, b.g, localT);
  const bl = lerp(a.b, b.b, localT);
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
}

/** Maps a count into the green-amber-red scale given the overall [min>0, max] range. min===max (only one distinct nonzero count in play) renders as pure green — there's no spread to show. */
export function usageColor(count: number, min: number, max: number): string {
  const t = max > min ? (count - min) / (max - min) : 0;
  return colorAt(t);
}

/** The [min, max] of every nonzero count in a usage map — null when nothing's been traveled yet (nothing to scale against). */
export function usageRange(edgeUsage: Record<string, number>): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const count of Object.values(edgeUsage)) {
    if (count <= 0) continue;
    if (count < min) min = count;
    if (count > max) max = count;
  }
  if (min === Infinity) return null;
  return { min, max };
}
