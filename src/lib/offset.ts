import type { Point } from "../types/warehouse";

/** Rotates a unit direction vector -90° — (x,y) -> (y,-x) — the fixed "always the right side of travel" convention used by every lane-offset consumer (Forklift.tsx's route lanes, Paths.tsx's directional usage coloring). */
export function rightOf(ux: number, uy: number): { x: number; y: number } {
  return { x: uy, y: -ux };
}

// Beyond this angle between the incoming and outgoing segment's directions
// (dot product of their unit vectors below this — -1 is a dead-straight
// reversal, 0 is a right angle), a turn is treated as a U-turn/hairpin
// rather than a corner: see the "near-reversal" branch below.
const REVERSAL_DOT_THRESHOLD = -0.8;

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
 * grows as the turn sharpens, so it's capped at `miterLimit` * offset for a
 * merely sharp turn.
 *
 * A near-*reversal* turn is different in kind, not just degree — a route
 * can legitimately double back on itself (e.g. a corridor that only tees
 * off further down the aisle, forcing a real U-turn to reach it), and
 * "right of travel" flips to the opposite physical side when direction
 * reverses. No single point can honor both the incoming segment's lane and
 * the outgoing segment's lane at once there — forcing one anyway (as a
 * plain miter, even clamped, would) put the outgoing segment's start on the
 * *incoming* segment's side, rendering as a long diagonal cut across to the
 * wrong lane (the "weird angle trajectory" feedback). So instead the
 * returned array grows by one extra point at a reversal: the incoming
 * segment's own end (its own perpendicular) immediately followed by the
 * outgoing segment's own start (its own perpendicular) — every consumer
 * here just walks the result as a plain polyline, so an extra point is
 * transparent to them, and the short cross-over segment it creates reads as
 * a small U-turn cap instead of a diagonal streak.
 */
export function offsetPolyline(points: Point[], offset: number, miterLimit = 2): Point[] {
  const result: Point[] = [];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[i - 1];
    const next = points[i + 1];

    const inLen = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) : 0;
    const inUx = inLen > 1e-6 ? (p.x - prev!.x) / inLen : 0;
    const inUy = inLen > 1e-6 ? (p.y - prev!.y) / inLen : 0;

    const outLen = next ? Math.hypot(next.x - p.x, next.y - p.y) : 0;
    const outUx = outLen > 1e-6 ? (next!.x - p.x) / outLen : 0;
    const outUy = outLen > 1e-6 ? (next!.y - p.y) / outLen : 0;

    if (inLen <= 1e-6 && outLen <= 1e-6) {
      result.push(p);
      continue;
    }

    // Endpoint of the whole polyline (or of one leg's slice of it): only one
    // adjacent segment exists, so its own perpendicular is the answer —
    // nothing to bisect.
    if (inLen <= 1e-6) {
      const perp = rightOf(outUx, outUy);
      result.push({ x: p.x + perp.x * offset, y: p.y + perp.y * offset });
      continue;
    }
    if (outLen <= 1e-6) {
      const perp = rightOf(inUx, inUy);
      result.push({ x: p.x + perp.x * offset, y: p.y + perp.y * offset });
      continue;
    }

    const perpIn = rightOf(inUx, inUy);
    const perpOut = rightOf(outUx, outUy);

    const turnDot = inUx * outUx + inUy * outUy;
    if (turnDot < REVERSAL_DOT_THRESHOLD) {
      result.push({ x: p.x + perpIn.x * offset, y: p.y + perpIn.y * offset });
      result.push({ x: p.x + perpOut.x * offset, y: p.y + perpOut.y * offset });
      continue;
    }

    let bx = perpIn.x + perpOut.x;
    let by = perpIn.y + perpOut.y;
    const blen = Math.hypot(bx, by);
    if (blen < 1e-6) {
      // Shouldn't happen (the reversal check above already catches an
      // exact 180°, where the perpendiculars are exact opposites) — kept as
      // a defensive fallback in case of float error right at the boundary.
      result.push({ x: p.x + perpIn.x * offset, y: p.y + perpIn.y * offset });
      continue;
    }
    bx /= blen;
    by /= blen;
    // Miter scale = offset / cos(halfAngle), i.e. offset / (bisector · perpIn).
    const cosHalf = bx * perpIn.x + by * perpIn.y;
    const scale = cosHalf > 1e-3 ? Math.min(1 / cosHalf, miterLimit) : miterLimit;
    result.push({ x: p.x + bx * offset * scale, y: p.y + by * offset * scale });
  }

  return result;
}
