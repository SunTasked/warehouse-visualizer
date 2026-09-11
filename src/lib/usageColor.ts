// Green-to-red scale for the picking-list route usage coloring (§5.3):
// green = the lowest nonzero count seen across the whole warehouse, red =
// the highest. An unused segment (count 0) isn't on the scale at all — it
// stays the infrastructure paths' own neutral color, since "green" already
// means "used, just least" and 0 uses is a different fact than that.
const LOW_COLOR = { r: 0x22, g: 0xc5, b: 0x5e }; // green-500
const HIGH_COLOR = { r: 0xdc, g: 0x26, b: 0x26 }; // red-600

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/** Maps a count into the green-red scale given the overall [min>0, max] range. min===max (only one distinct nonzero count in play) renders as pure green — there's no spread to show. */
export function usageColor(count: number, min: number, max: number): string {
  const t = max > min ? (count - min) / (max - min) : 0;
  const clamped = Math.max(0, Math.min(1, t));
  const r = lerp(LOW_COLOR.r, HIGH_COLOR.r, clamped);
  const g = lerp(LOW_COLOR.g, HIGH_COLOR.g, clamped);
  const b = lerp(LOW_COLOR.b, HIGH_COLOR.b, clamped);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
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
