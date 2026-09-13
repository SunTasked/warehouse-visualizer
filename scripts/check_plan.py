#!/usr/bin/env python3
"""Sanity-check a warehouse plan file the way the app will use it.

Run:  python scripts/check_plan.py schema/CML.plan.json

Fails (exit 1) on anything that would draw or route wrongly:
  * duplicate ids (slots, paths, doors, facilities);
  * a slot outside every building, or overlapping another slot;
  * a corridor centreline running through a slot;
  * a slot with no corridor in front of it, or whose way out to the nearest
    one in front (the one the app's router picks) crosses other racking;
  * a facility pad outside its building or on top of racking or a corridor;
  * a door off its building's wall, or not on the path network;
  * a path network in more than one piece.
Reports, without failing, corridors whose full drawn width grazes racking.

Geometry mirrors the app: a slot's local depth axis runs from its entry edge
at -cellDepth/2 backwards, rotated like Slots.tsx (rotationDeg 0 opens north,
90 west, 180 south, 270 east); pathGraph.ts snaps a slot's entry point to the
nearest point on a corridor in front of it.
"""
import json
import math
import re
import sys
from collections import Counter, defaultdict

EPS = 1e-6
PAD_W, PAD_D = 6.0, 2.0  # LiftStations.tsx / DeliverySpaces.tsx


def rect_overlap(a, b, eps=EPS):
    return a[0] < b[2] - eps and b[0] < a[2] - eps and a[1] < b[3] - eps and b[1] < a[3] - eps


def through(line, rect):
    """An axis-aligned line (a zero-width rect) passes through rect's interior - running along its edge doesn't count."""
    return rect[0] + EPS < line[2] and line[0] < rect[2] - EPS and rect[1] + EPS < line[3] and line[1] < rect[3] - EPS


def point_in_polygon(x, y, pts):
    inside = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi, xj, yj = pts[i]["x"], pts[i]["y"], pts[j]["x"], pts[j]["y"]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def slot_geometry(slot, defaults):
    """-> (rect xmin,ymin,xmax,ymax, entry point, outward facing unit vector)."""
    w, cd = defaults["width"], defaults["height"]
    depth = slot.get("depth", 1)
    th = math.radians(slot.get("rotationDeg", 0))
    corners = []
    for lx in (-w / 2, w / 2):
        for lz in (-cd / 2, (depth - 1) * cd + cd / 2):
            # three.js Y rotation, then scene z = -y
            sx = lx * math.cos(th) + lz * math.sin(th)
            sz = -lx * math.sin(th) + lz * math.cos(th)
            corners.append((slot["x"] + sx, slot["y"] - sz))
    xs, ys = [c[0] for c in corners], [c[1] for c in corners]
    entry = (slot["x"] - (cd / 2) * math.sin(th), slot["y"] + (cd / 2) * math.cos(th))
    facing = (-math.sin(th), math.cos(th))
    return (min(xs), min(ys), max(xs), max(ys)), entry, facing


def segment_rect(a, b, half_width):
    """Axis-aligned body of a corridor segment (None if the segment is diagonal)."""
    (x0, y0), (x1, y1) = a, b
    if abs(y0 - y1) < EPS:
        return (min(x0, x1), y0 - half_width, max(x0, x1), y0 + half_width)
    if abs(x0 - x1) < EPS:
        return (x0 - half_width, min(y0, y1), x0 + half_width, max(y0, y1))
    return None


def project(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return (ax + t * dx, ay + t * dy)


class Grid:
    """Buckets rectangles so overlap queries stay fast with thousands of slots."""

    def __init__(self, cell=5.0):
        self.cell, self.buckets = cell, defaultdict(list)

    def _keys(self, r):
        c = self.cell
        for i in range(math.floor(r[0] / c), math.floor(r[2] / c) + 1):
            for j in range(math.floor(r[1] / c), math.floor(r[3] / c) + 1):
                yield i, j

    def add(self, key, r):
        for k in self._keys(r):
            self.buckets[k].append((key, r))

    def query(self, r):
        seen = set()
        for k in self._keys(r):
            for key, other in self.buckets[k]:
                if key not in seen:
                    seen.add(key)
                    yield key, other


def main(path):
    plan = json.load(open(path, encoding="utf-8"))
    defaults = plan["slotDefaults"]
    loops = [w for w in plan["walls"] if w.get("closed")]
    errors, warnings = [], []

    def err(msg):
        errors.append(msg)

    for kind in ("slots", "paths", "doors", "liftStations", "deliverySpaces", "inaccessibleZones"):
        counts = Counter(x["id"] for x in plan.get(kind, []))
        dup = sorted(i for i, n in counts.items() if n > 1)
        if dup:
            err(f"duplicate {kind} ids: {dup[:10]}")

    # --- slots ---------------------------------------------------------------
    grid = Grid()
    geo = {}
    per_building = defaultdict(int)
    for s in plan["slots"]:
        rect, entry, facing = slot_geometry(s, defaults)
        geo[s["id"]] = (rect, entry, facing)
        homes = [l["id"] for l in loops if all(
            point_in_polygon(x, y, l["points"]) for x in (rect[0] + EPS, rect[2] - EPS) for y in (rect[1] + EPS, rect[3] - EPS)
        )]
        if len(homes) != 1:
            err(f"slot {s['id']} is inside {len(homes)} buildings")
        else:
            per_building[homes[0]] += 1
        for other, orect in grid.query(rect):
            if rect_overlap(rect, orect):
                err(f"slots {s['id']} and {other} overlap")
        grid.add(s["id"], rect)

    # --- corridors ---------------------------------------------------------------
    segments = []  # (path id, a, b, half width)
    for p in plan.get("paths", []):
        pts = [(q["x"], q["y"]) for q in p["points"]]
        for a, b in zip(pts, pts[1:]):
            segments.append((p["id"], a, b, p.get("width", 2.2) / 2))

    grazing = defaultdict(set)
    for pid, a, b, hw in segments:
        line = segment_rect(a, b, 0.0)
        body = segment_rect(a, b, hw)
        if line is None:
            warnings.append(f"path {pid} has a diagonal segment (not checked against racking)")
            continue
        for sid, rect in grid.query(body):
            if through(line, rect):
                err(f"path {pid} runs through slot {sid}")
            elif rect_overlap(body, rect, eps=1e-3):
                grazing[pid].add(sid)
    for pid, sids in sorted(grazing.items()):
        warnings.append(f"path {pid}'s drawn width grazes {len(sids)} slots, e.g. {sorted(sids)[:3]}")

    # --- every slot reaches its own aisle -------------------------------------
    longest = (0.0, None)
    notches = []  # (slot id, corridor id, the way out as a zero-width rect)
    for sid, (rect, entry, facing) in geo.items():
        best = None  # the nearest corridor in front of the slot, as the router picks it
        for pid, a, b, _ in segments:
            q = project(entry, a, b)
            d = math.dist(entry, q)
            if (q[0] - entry[0]) * facing[0] + (q[1] - entry[1]) * facing[1] < -EPS:
                continue
            if best is None or d < best[0]:
                best = (d, q, pid)
        if best is None:
            err(f"slot {sid} has no corridor in front of it")
            continue
        d, q, pid = best
        if d > longest[0]:
            longest = (d, sid)
        notch = (min(entry[0], q[0]), min(entry[1], q[1]), max(entry[0], q[0]), max(entry[1], q[1]))
        notches.append((sid, pid, notch))
        for other, orect in grid.query(notch):
            if other != sid and through(notch, orect):
                err(f"slot {sid}'s way out to {pid} crosses slot {other}")
                break

    # --- facilities ------------------------------------------------------------
    loop_by_id = {l["id"]: l for l in loops}
    pad_rects = []
    for kind in ("liftStations", "deliverySpaces"):
        for f in plan.get(kind, []):
            rot = f.get("rotationDeg", 0) % 180
            hw, hd = (PAD_W / 2, PAD_D / 2) if rot == 0 else (PAD_D / 2, PAD_W / 2)
            rect = (f["x"] - hw, f["y"] - hd, f["x"] + hw, f["y"] + hd)
            pad_rects.append((f["id"], rect))
            loop = loop_by_id.get(f["buildingId"])
            if not loop or not all(point_in_polygon(x, y, loop["points"]) for x in (rect[0], rect[2]) for y in (rect[1], rect[3])):
                err(f"{f['id']} is not inside building {f['buildingId']}")
            for sid, srect in grid.query(rect):
                if rect_overlap(rect, srect):
                    err(f"{f['id']} overlaps slot {sid}")
            for pid, a, b, hw2 in segments:
                body = segment_rect(a, b, hw2)
                if body and rect_overlap(rect, body):
                    err(f"{f['id']} overlaps path {pid}")

    # --- inaccessible zones ------------------------------------------------------
    # Nothing may be placed in one, and no corridor - nor any slot's way out to
    # its corridor - may cross one; a corridor merely touching its edge is fine.
    for z in plan.get("inaccessibleZones", []):
        rect = (z["x"] - z["width"] / 2, z["y"] - z["depth"] / 2, z["x"] + z["width"] / 2, z["y"] + z["depth"] / 2)
        loop = loop_by_id.get(z["buildingId"])
        if not loop or not all(
            point_in_polygon(x, y, loop["points"]) for x in (rect[0] + EPS, rect[2] - EPS) for y in (rect[1] + EPS, rect[3] - EPS)
        ):
            err(f"zone {z['id']} is not inside building {z['buildingId']}")
        for sid, srect in grid.query(rect):
            if rect_overlap(rect, srect):
                err(f"zone {z['id']} overlaps slot {sid}")
        for fid, frect in pad_rects:
            if rect_overlap(rect, frect):
                err(f"{fid} overlaps zone {z['id']}")
        for pid, a, b, hw2 in segments:
            line = segment_rect(a, b, 0.0)
            body = segment_rect(a, b, hw2)
            if line and through(line, rect):
                err(f"path {pid} runs through zone {z['id']}")
            elif body and rect_overlap(body, rect, eps=1e-3):
                warnings.append(f"path {pid}'s drawn width grazes zone {z['id']}")
        for sid, pid, notch in notches:
            if through(notch, rect):
                err(f"slot {sid}'s way out to {pid} crosses zone {z['id']}")

    # --- doors and connectivity -------------------------------------------------
    def key(x, y):
        return f"{x:.3f},{y:.3f}"

    nodes = defaultdict(set)
    node_paths = defaultdict(set)
    for pid, a, b, _ in segments:
        nodes[key(*a)].add(key(*b))
        nodes[key(*b)].add(key(*a))
        node_paths[key(*a)].add(pid)
        node_paths[key(*b)].add(pid)
    for d in plan.get("doors", []):
        loop = loop_by_id.get(d["buildingId"])
        on_wall = False
        if loop:
            pts = loop["points"]
            for i in range(len(pts)):
                a, b = pts[i], pts[(i + 1) % len(pts)]
                q = project((d["x"], d["y"]), (a["x"], a["y"]), (b["x"], b["y"]))
                on_wall |= math.dist(q, (d["x"], d["y"])) < 0.05
        if not on_wall:
            err(f"door {d['id']} is not on building {d['buildingId']}'s wall")
        if key(d["x"], d["y"]) not in nodes:
            err(f"door {d['id']} is not on the path network")

    remaining, pieces = set(nodes), []
    while remaining:
        start = remaining.pop()
        stack, piece = [start], {start}
        while stack:
            for n in nodes[stack.pop()]:
                if n in remaining:
                    remaining.remove(n)
                    piece.add(n)
                    stack.append(n)
        pieces.append(piece)
    components = len(pieces)
    pieces.sort(key=len, reverse=True)
    for piece in pieces[1:]:
        cut_off = sorted({pid for n in piece for pid in node_paths[n]})
        err(f"paths cut off from the rest of the network: {cut_off}")

    print(f"{path}: {len(plan['slots'])} slots in {len(loops)} buildings {dict(per_building)}, "
          f"{len(plan.get('paths', []))} paths, {components} network piece(s), "
          f"longest slot-to-corridor notch {longest[0]:.2f} m ({longest[1]})")
    for w in warnings:
        print("  warning:", w)
    # Grouped by kind (the message with its ids blanked), so one systematic
    # problem shows as one line with a count rather than a screenful.
    kinds = defaultdict(list)
    for e in errors:
        kinds[re.sub(r"\S*\d\S*", "…", e)].append(e)
    for kind, examples in kinds.items():
        print(f"  ERROR x{len(examples)}: {examples[0]}" + (f"  (also: {examples[1:4]})" if len(examples) > 1 else ""))
    if errors:
        print(f"  {len(errors)} error(s)")
        sys.exit(1)
    print("  OK")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "schema/CML.plan.json")
