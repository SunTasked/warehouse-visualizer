import type { Point } from "../types/warehouse";

/** Rotates a unit direction vector -90° — (x,y) -> (y,-x) — the fixed "always the right side of travel" convention used by every lane-offset consumer (Forklift.tsx's route lanes, Paths.tsx's directional usage coloring). */
export function rightOf(ux: number, uy: number): { x: number; y: number } {
  return { x: uy, y: -ux };
}

/**
 * Shifts every point of a polyline perpendicular to its own local travel
 * direction by a fixed distance, so two lanes riding the same physical
 * corridor in opposite directions end up offset to *opposite* sides of the
 * true centerline (rotating a direction vector by a fixed 90° always points
 * to its "right," and "right of forward" for one direction is "left of
 * forward" for the reverse of it — one rule is enough to separate
 * outbound/inbound lanes with no explicit overlap detection).
 *
 * At an interior vertex, the offset direction is the angle bisector of the
 * incoming and outgoing segments' *unit* directions — deliberately not a sum
 * of their raw displacement vectors, which would let whichever adjacent
 * segment happens to be longer dominate the direction and skew the corner
 * (e.g. a short notch into a slot next to a long aisle run would offset
 * almost parallel to the notch instead of bisecting the turn). The miter
 * distance needed to keep both adjoining segments a uniform `offset` apart
 * grows as the turn sharpens and blows up near a straight reversal, so it's
 * capped at `miterLimit` * offset — beyond that, the join falls back to the
 * incoming segment's own perpendicular (a bevel-ish join) rather than
 * shooting the corner out past the corridor's true footprint.
 */
export function offsetPolyline(points: Point[], offset: number, miterLimit = 2): Point[] {
  return points.map((p, i) => {
    const prev = points[i - 1];
    const next = points[i + 1];

    const inLen = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) : 0;
    const inUx = inLen > 1e-6 ? (p.x - prev!.x) / inLen : 0;
    const inUy = inLen > 1e-6 ? (p.y - prev!.y) / inLen : 0;

    const outLen = next ? Math.hypot(next.x - p.x, next.y - p.y) : 0;
    const outUx = outLen > 1e-6 ? (next!.x - p.x) / outLen : 0;
    const outUy = outLen > 1e-6 ? (next!.y - p.y) / outLen : 0;

    if (inLen <= 1e-6 && outLen <= 1e-6) return p;

    // Endpoint of the whole polyline (or of one leg's slice of it): only one
    // adjacent segment exists, so its own perpendicular is the answer —
    // nothing to bisect.
    if (inLen <= 1e-6) {
      const perp = rightOf(outUx, outUy);
      return { x: p.x + perp.x * offset, y: p.y + perp.y * offset };
    }
    if (outLen <= 1e-6) {
      const perp = rightOf(inUx, inUy);
      return { x: p.x + perp.x * offset, y: p.y + perp.y * offset };
    }

    const perpIn = rightOf(inUx, inUy);
    const perpOut = rightOf(outUx, outUy);
    let bx = perpIn.x + perpOut.x;
    let by = perpIn.y + perpOut.y;
    const blen = Math.hypot(bx, by);
    if (blen < 1e-6) {
      // Straight reversal (~180°): the two perpendiculars cancel out and
      // there's no well-defined bisector — fall back to the incoming side.
      return { x: p.x + perpIn.x * offset, y: p.y + perpIn.y * offset };
    }
    bx /= blen;
    by /= blen;
    // Miter scale = offset / cos(halfAngle), i.e. offset / (bisector · perpIn).
    const cosHalf = bx * perpIn.x + by * perpIn.y;
    const scale = cosHalf > 1e-3 ? Math.min(1 / cosHalf, miterLimit) : miterLimit;
    return { x: p.x + bx * offset * scale, y: p.y + by * offset * scale };
  });
}
