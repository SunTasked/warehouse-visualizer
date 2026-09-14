#!/usr/bin/env python3
"""Sanity-check a warehouse plan file the way the app will use it.

Run:  python scripts/check_plan.py schema/CML.plan.json

Fails (exit 1) on anything that would draw or route wrongly:
  * duplicate ids (slots, junctions, corridors, doors, facilities, zones);
  * a corridor naming a junction the plan doesn't have, or with fewer than
    two; two junctions at the same position (they look connected but aren't);
  * a slot outside every building, or overlapping another slot;
  * a corridor centreline running through a slot;
  * a slot's access naming a corridor the plan doesn't have, an offset past
    either end of it, or a join behind the slot; a slot with no access and no
    corridor in front of it; a slot's way out to its join crossing other
    racking or a zone;
  * a facility pad outside its building, on top of racking or a corridor, or
    with a broken access;
  * a door off its building's wall, or not on a junction;
  * a corridor network in more than one piece.
Reports, without failing: corridors whose full drawn width grazes racking,
slots with no stated access, slots whose stated corridor isn't the nearest one
in front of them (worth a look, not necessarily wrong), and junctions no
corridor uses.

Geometry mirrors the app: a slot's local depth axis runs from its entry edge
at -cellDepth/2 backwards, rotated like Slots.tsx (rotationDeg 0 opens north,
90 west, 180 south, 270 east). A slot joins its corridor at `access.offset`
metres along it; without an access, at the nearest point on a corridor in
front of it (pathGraph.ts). A plan still in the older `paths` format is
checked too, its junctions being the coordinates paths share.
"""
import json
import math
import re
import sys
from collections import Counter, defaultdict

EPS = 1e-6
PAD_W, PAD_D = 6.0, 2.0  # LiftStations.tsx / DeliverySpaces.tsx
DEFAULT_WIDTH = 1.0  # Paths.tsx's PATH_DEFAULT_WIDTH


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


def point_along(points, offset):
    """The point `offset` metres along a polyline, or None past either end."""
    if offset < -EPS:
        return None
    for a, b in zip(points, points[1:]):
        seg = math.dist(a, b)
        if offset <= seg + EPS:
            t = 0.0 if seg == 0 else max(0.0, min(1.0, offset / seg))
            return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
        offset -= seg
    return None


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


def load_network(plan):
    """-> ({junction id: (x, y)}, [(corridor id, [junction ids], width)]). Legacy `paths` become junctions at the coordinates they share."""
    if "corridors" in plan:
        junctions = {}
        for j in plan.get("junctions", []):
            junctions.setdefault(j["id"], (j["x"], j["y"]))
        corridors = [(c["id"], c["junctions"], c.get("width", DEFAULT_WIDTH)) for c in plan["corridors"]]
        return junctions, corridors
    junctions, corridors = {}, []
    for p in plan.get("paths", []):
        ids = []
        for q in p["points"]:
            jid = f"{q['x']:.3f},{q['y']:.3f}"
            junctions.setdefault(jid, (q["x"], q["y"]))
            ids.append(jid)
        corridors.append((p["id"], ids, p.get("width", DEFAULT_WIDTH)))
    return junctions, corridors


def main(path):
    plan = json.load(open(path, encoding="utf-8"))
    defaults = plan["slotDefaults"]
    loops = [w for w in plan["walls"] if w.get("closed")]
    errors, warnings = [], []

    def err(msg):
        errors.append(msg)

    for kind in ("slots", "junctions", "corridors", "paths", "doors", "liftStations", "deliverySpaces", "inaccessibleZones"):
        counts = Counter(x["id"] for x in plan.get(kind, []))
        dup = sorted(i for i, n in counts.items() if n > 1)
        if dup:
            err(f"duplicate {kind} ids: {dup[:10]}")

    # --- the corridor network --------------------------------------------------
    junctions, corridors = load_network(plan)
    used = set()
    lines = {}  # corridor id -> its polyline
    segments = []  # (corridor id, a, b, half width, junction a, junction b)
    for cid, ids, width in corridors:
        missing = [j for j in ids if j not in junctions]
        if missing:
            err(f"corridor {cid} names junctions the plan doesn't have: {missing[:3]}")
        known = [j for j in ids if j in junctions]
        used.update(known)
        if len(known) < 2:
            err(f"corridor {cid} runs through fewer than two junctions")
            continue
        pts = [junctions[j] for j in known]
        lines[cid] = pts
        for ja, jb in zip(known, known[1:]):
            segments.append((cid, junctions[ja], junctions[jb], width / 2, ja, jb))
    unused = sorted(set(junctions) - used)
    if unused:
        warnings.append(f"{len(unused)} junctions no corridor runs through, e.g. {unused[:3]}")
    by_position = defaultdict(list)
    for jid, (x, y) in junctions.items():
        by_position[(round(x, 3), round(y, 3))].append(jid)
    for ids in by_position.values():
        if len(ids) > 1:
            err(f"junctions {ids[:3]} share a position without being one junction, so nothing connects through there")

    # --- slots ---------------------------------------------------------------
    grid = Grid()
    geo = {}
    per_building = defaultdict(int)
    for s in plan["slots"]:
        rect, entry, facing = slot_geometry(s, defaults)
        geo[s["id"]] = (rect, entry, facing, s.get("access"))
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

    grazing = defaultdict(set)
    for cid, a, b, hw, _, _ in segments:
        line = segment_rect(a, b, 0.0)
        body = segment_rect(a, b, hw)
        if line is None:
            warnings.append(f"corridor {cid} has a diagonal segment (not checked against racking)")
            continue
        for sid, rect in grid.query(body):
            if through(line, rect):
                err(f"corridor {cid} runs through slot {sid}")
            elif rect_overlap(body, rect, eps=1e-3):
                grazing[cid].add(sid)
    for cid, sids in sorted(grazing.items()):
        warnings.append(f"corridor {cid}'s drawn width grazes {len(sids)} slots, e.g. {sorted(sids)[:3]}")

    def check_access(owner, access):
        """The join point of a stated access, or None (with an error) when it's broken."""
        if access["corridor"] not in lines:
            err(f"{owner}'s access names corridor {access['corridor']}, which the plan doesn't have")
            return None
        q = point_along(lines[access["corridor"]], access["offset"])
        if q is None:
            err(f"{owner}'s access is {access['offset']} m along {access['corridor']}, past its end")
        return q

    # --- every slot reaches its corridor -----------------------------------------
    longest = (0.0, None)
    notches = []  # (slot id, corridor id, the way out as a zero-width rect)
    unstated, not_nearest = [], []
    for sid, (rect, entry, facing, access) in geo.items():
        nearest = None  # the nearest corridor in front of the slot
        for cid, a, b, _, _, _ in segments:
            q = project(entry, a, b)
            d = math.dist(entry, q)
            if (q[0] - entry[0]) * facing[0] + (q[1] - entry[1]) * facing[1] < -EPS:
                continue
            if nearest is None or d < nearest[0]:
                nearest = (d, q, cid)
        if access:
            q = check_access(f"slot {sid}", access)
            if q is None:
                continue
            cid = access["corridor"]
            if (q[0] - entry[0]) * facing[0] + (q[1] - entry[1]) * facing[1] < -1e-3:
                err(f"slot {sid} joins {cid} behind itself")
            if nearest and nearest[2] != cid and math.dist(entry, q) > nearest[0] + 1e-3:
                not_nearest.append(f"{sid} ({cid}, nearest {nearest[2]})")
        else:
            unstated.append(sid)
            if nearest is None:
                err(f"slot {sid} has no corridor in front of it")
                continue
            _, q, cid = nearest
        d = math.dist(entry, q)
        if d > longest[0]:
            longest = (d, sid)
        notch = (min(entry[0], q[0]), min(entry[1], q[1]), max(entry[0], q[0]), max(entry[1], q[1]))
        notches.append((sid, cid, notch))
        for other, orect in grid.query(notch):
            if other != sid and through(notch, orect):
                err(f"slot {sid}'s way out to {cid} crosses slot {other}")
                break
    if unstated:
        warnings.append(f"{len(unstated)} slots state no access (the app joins them to the nearest corridor in front), e.g. {unstated[:3]}")
    if not_nearest:
        warnings.append(f"{len(not_nearest)} slots are worked from a corridor other than the nearest one in front, e.g. {not_nearest[:3]}")

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
            for cid, a, b, hw2, _, _ in segments:
                body = segment_rect(a, b, hw2)
                if body and rect_overlap(rect, body):
                    err(f"{f['id']} overlaps corridor {cid}")
            if f.get("access"):
                check_access(f["id"], f["access"])

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
        for cid, a, b, hw2, _, _ in segments:
            line = segment_rect(a, b, 0.0)
            body = segment_rect(a, b, hw2)
            if line and through(line, rect):
                err(f"corridor {cid} runs through zone {z['id']}")
            elif body and rect_overlap(body, rect, eps=1e-3):
                warnings.append(f"corridor {cid}'s drawn width grazes zone {z['id']}")
        for sid, cid, notch in notches:
            if through(notch, rect):
                err(f"slot {sid}'s way out to {cid} crosses zone {z['id']}")

    # --- doors and connectivity -------------------------------------------------
    neighbours = defaultdict(set)
    corridors_at = defaultdict(set)
    for cid, _, _, _, ja, jb in segments:
        neighbours[ja].add(jb)
        neighbours[jb].add(ja)
        corridors_at[ja].add(cid)
        corridors_at[jb].add(cid)
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
        if not any(math.dist((d["x"], d["y"]), junctions[j]) < 1e-3 for j in neighbours):
            err(f"door {d['id']} is not at a junction of the network")

    remaining, pieces = set(neighbours), []
    while remaining:
        start = remaining.pop()
        stack, piece = [start], {start}
        while stack:
            for n in neighbours[stack.pop()]:
                if n in remaining:
                    remaining.remove(n)
                    piece.add(n)
                    stack.append(n)
        pieces.append(piece)
    pieces.sort(key=len, reverse=True)
    for piece in pieces[1:]:
        cut_off = sorted({cid for n in piece for cid in corridors_at[n]})
        err(f"corridors cut off from the rest of the network: {cut_off}")

    stated = len(geo) - len(unstated)
    print(f"{path}: {len(plan['slots'])} slots in {len(loops)} buildings {dict(per_building)}, "
          f"{len(junctions)} junctions, {len(corridors)} corridors, {len(pieces)} network piece(s); "
          f"{stated} slots state their access; longest slot-to-corridor notch {longest[0]:.2f} m ({longest[1]})")
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
