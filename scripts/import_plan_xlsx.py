#!/usr/bin/env python3
"""Import one building's rack layout from the CML plant workbook (PLAN_Sortie).

Run:  python scripts/import_plan_xlsx.py --building "BATIMENT 13A"

--------------------------------------------------------------------------
How the spreadsheet encodes a warehouse
--------------------------------------------------------------------------
The sheet is a floor plan drawn with cells. Reading it does *not* require
guessing from geometry, because the drawing is self-describing:

* Every storage location has a **label cell** (e.g. 'AA01') written *inside
  the aisle that serves it*, on the line nearest the rack it names. So for
  aisle A, the 'AA01, AA03, ...' line names the rack above it and the
  'AA02, AA04, ...' line the rack below. Odd codes therefore always face
  south and even codes north (verified: true for every two-sided aisle in
  13A, no exceptions).

* Every drawn box carries a formula that identifies it:
    =VLOOKUP(<its own label cell>, Analyse!...)  -> the FRONT position, the
                                                    one touching the aisle
    =<another box cell>                          -> the same location, one
                                                    position further back
  Following those references gives each location its exact set of cells, and
  the count of them is the rack's depth in pallet positions. A location is
  one addressable lane: depth N, LEVELS high.

* 38 boxes carry a broken '=VLOOKUP(,...)' (the reference was deleted at some
  point). Their label is recovered from the adjacent label cell.

* Black-filled boxes are drawn but carry no formula and no code - blocked
  positions (pillars and the like). They become holes in the racking.

* Bold borders mark back-to-back facings, as the plan's author intended, but
  the file is not consistent about it (the D/E block uses a thin line for the
  same thing). They are therefore *not* used here - the formulas settle every
  case on their own.

--------------------------------------------------------------------------
How it becomes a warehouse
--------------------------------------------------------------------------
One Excel location -> one Slot; its depth cells -> that slot's sub-slots;
LEVELS -> pallet tiers per sub-slot (content, not config, so it is only a
capacity here).

The drawing is schematic, not to scale: a one-deep lane is often drawn two
cells tall while a three-deep lane gets three cells. So cell *extents* are
not used as distances. Instead every column gets a fixed pitch and every row
a pitch depending on its role (rack row vs aisle line), and a slot is
anchored at the aisle-facing edge of its front box. Relative positions - the
thing the plan actually encodes - are preserved exactly.

Aisles come out of the same label rows: the corridor centreline for aisle A
is the line its 'AA..' labels are written on, spanning the columns those
labels cover. Those corridors are joined by a vertical trunk in the empty
column band west of the main racks, plus one down the Z block's own aisle.
"""
import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

import openpyxl
from openpyxl.utils import column_index_from_string, get_column_letter

# --- Metric assumptions (the drawing carries no scale) ----------------------
LANE_W = 1.2        # one location's width along the rack face
POS_D = 1.2         # one pallet position's depth into the rack
AISLE_W = 3.5       # a normal picking aisle
WIDE_AISLE_W = 5.0  # a main cross-aisle (drawn 4+ rows tall, e.g. aisle C)
WIDE_AISLE_ROWS = 4
LEVELS = 3          # pallet tiers per position
MARGIN = 1.0        # clear floor between the outermost racking and the wall

# rotationDeg -> facing, per Slots.tsx's rotation math (see the example
# generator, which documents the same mapping).
FACING = {"N": 0, "W": 90, "S": 180, "E": 270}

VLOOKUP = re.compile(r"^=VLOOKUP\(\$?([A-Z]{1,2})\$?(\d+)\s*,", re.I)
BROKEN = re.compile(r"^=VLOOKUP\(\s*,", re.I)
REF = re.compile(r"^=\$?([A-Z]{1,2})\$?(\d+)$", re.I)
CODE = re.compile(r"^[A-Z]{2}\d{2,3}$")


# ---------------------------------------------------------------------------
# Reading the sheet
# ---------------------------------------------------------------------------
def _style(side):
    return side.style if side is not None and side.style else None


def _is_black(cell):
    f = cell.fill
    return (
        f is not None
        and f.patternType == "solid"
        and f.fgColor is not None
        and f.fgColor.type == "theme"
        and f.fgColor.theme == 1
    )


def _is_boxed(cell):
    b = cell.border
    return (
        any(_style(getattr(b, s)) for s in ("left", "right", "top", "bottom"))
        or _is_black(cell)
        or (isinstance(cell.value, str) and cell.value.startswith("="))
    )


def _label_at(ws, r, c):
    v = ws.cell(r, c).value
    return v.strip() if isinstance(v, str) and CODE.match(str(v).strip()) else None


def _resolve(ws, r, c, seen=None):
    """-> (location code, label cell) for the box at (r, c)."""
    seen = seen or set()
    if (r, c) in seen:
        return None, None
    seen.add((r, c))
    v = ws.cell(r, c).value
    if not isinstance(v, str) or not v.startswith("="):
        return None, None
    m = VLOOKUP.match(v)
    if m:
        lr, lc = int(m.group(2)), column_index_from_string(m.group(1))
        return _label_at(ws, lr, lc), (lr, lc)
    if BROKEN.match(v):
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            lab = _label_at(ws, r + dr, c + dc)
            if lab:
                return lab, (r + dr, c + dc)
        return None, None
    m = REF.match(v)
    if m:
        tr, tc = int(m.group(2)), column_index_from_string(m.group(1))
        lab = _label_at(ws, tr, tc)
        if lab:  # points straight at the label cell
            return lab, (tr, tc)
        return _resolve(ws, tr, tc, seen)
    return None, None


def find_building_rows(ws, name):
    """Interior row range of a building, from the rotated markers in column A.

    The north and south walls are drawn as medium-weight borders spanning the
    block; the floor is everything between them - including the clear strips
    with no racking, which is where the dock ends up.
    """
    markers = []
    for r in range(1, ws.max_row + 1):
        v = ws.cell(r, 1).value
        if isinstance(v, str) and v.strip().upper().startswith("BATIMENT"):
            markers.append((r, v.strip()))
    for i, (r, label) in enumerate(markers):
        if label.upper() != name.upper():
            continue
        end = markers[i + 1][0] - 1 if i + 1 < len(markers) else ws.max_row
        walls = [
            rr
            for rr in range(r, end + 1)
            if sum(
                1
                for c in range(1, 120)
                if _style(ws.cell(rr, c).border.top) == "medium" or _style(ws.cell(rr, c).border.bottom) == "medium"
            )
            > 20
        ]
        if len(walls) >= 2:
            return walls[0] + 1, walls[-1] - 1, label
        return r + 1, end - 1, label
    raise SystemExit(f"building {name!r} not found; have: {[m[1] for m in markers]}")


def extract(ws, r0, r1, c1=200):
    """-> (locations, blacks). Each location: cells front-to-back, facing, label cell."""
    boxes, blacks, bad = {}, [], []
    for r in range(r0, r1 + 1):
        for c in range(1, c1 + 1):
            cell = ws.cell(r, c)
            if not _is_boxed(cell):
                continue
            if _is_black(cell):
                blacks.append((r, c))
                continue
            v = cell.value
            if not (isinstance(v, str) and v.startswith("=")):
                continue  # blank continuation cell of a box drawn several cells tall
            code, lab = _resolve(ws, r, c)
            if not code:
                bad.append(f"{get_column_letter(c)}{r}")
                continue
            boxes[(r, c)] = (code, bool(VLOOKUP.match(v) or BROKEN.match(v)), lab)
    if bad:
        print(f"  ! {len(bad)} unresolved boxes: {bad[:10]}")

    grouped = defaultdict(list)
    for (r, c), (code, front, lab) in boxes.items():
        grouped[code].append((r, c, front, lab))

    locations = {}
    for code, cells in grouped.items():
        fronts = [(r, c, lab) for r, c, f, lab in cells if f]
        if len(fronts) != 1:
            print(f"  ! {code}: {len(fronts)} front cells, skipped")
            continue
        fr, fc, (lr, lc) = fronts[0][0], fronts[0][1], fronts[0][2]
        dr, dc = lr - fr, lc - fc
        if dr and dc:
            print(f"  ! {code}: label is diagonal from its front box, skipped")
            continue
        face = "N" if dr < 0 else "S" if dr > 0 else "W" if dc < 0 else "E"
        # Depth runs away from the aisle, i.e. opposite the facing.
        step = {"N": (1, 0), "S": (-1, 0), "W": (0, 1), "E": (0, -1)}[face]
        ordered = sorted(
            ((r, c) for r, c, _, _ in cells),
            key=lambda rc: (rc[0] - fr) * step[0] + (rc[1] - fc) * step[1],
        )
        locations[code] = {"cells": ordered, "face": face, "label": (lr, lc)}
    return locations, blacks


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------
def build_axes(locations, r0, r1):
    """Per-row heights and per-column widths, then cumulative edges.

    A row that carries the labels of a north/south-facing rack *is* that
    rack's aisle, so it gets aisle pitch; every other row is a rack row at one
    pallet position deep. Same idea transposed for the (rare) east/west racks,
    whose labels sit in a column instead.
    """
    aisle_rows, aisle_cols = set(), set()
    for loc in locations.values():
        lr, lc = loc["label"]
        (aisle_rows if loc["face"] in "NS" else aisle_cols).add(lr if loc["face"] in "NS" else lc)

    # An aisle drawn with blank rows between its two label lines (the main
    # cross-aisle) is wider; absorb those blanks into the group.
    if aisle_rows:
        lo, hi = min(aisle_rows), max(aisle_rows)
        occupied = {r for loc in locations.values() for r, _ in loc["cells"]}
        for r in range(lo, hi + 1):
            if r not in aisle_rows and r not in occupied:
                if any(x in aisle_rows for x in range(lo, r)) and any(x in aisle_rows for x in range(r + 1, hi + 1)):
                    aisle_rows.add(r)

    groups, current = [], []
    for r in range(r0, r1 + 2):
        if r in aisle_rows:
            current.append(r)
        elif current:
            groups.append(current)
            current = []

    # An aisle line that also carries racking somewhere else along its length
    # (the plan has a few) must still be at least one position deep, or that
    # rack would overflow its band and collide with the one behind it.
    occupied_rows = {r for loc in locations.values() for r, _ in loc["cells"]}
    row_h = {r: POS_D for r in range(r0, r1 + 1)}
    for g in groups:
        total = WIDE_AISLE_W if len(g) >= WIDE_AISLE_ROWS else AISLE_W
        free = [r for r in g if r not in occupied_rows]
        forced = [r for r in g if r in occupied_rows]
        spare = total - len(forced) * POS_D
        for r in forced:
            row_h[r] = POS_D
        for r in free:
            row_h[r] = max(POS_D, spare / len(free)) if free else POS_D

    cols = [c for loc in locations.values() for _, c in loc["cells"]]
    c0, c1 = min(cols), max(cols)
    occupied_cols = set(cols)
    col_w = {c: LANE_W for c in range(c0 - 1, c1 + 2)}
    for c in aisle_cols:
        if c not in occupied_cols:
            col_w[c] = AISLE_W

    return row_h, col_w, aisle_rows, aisle_cols, (c0 - 1, c1 + 1)


def axis_edges(sizes, lo, hi):
    """-> {index: (start, end)} accumulating from lo."""
    out, acc = {}, 0.0
    for i in range(lo, hi + 1):
        w = sizes.get(i, POS_D)
        out[i] = (acc, acc + w)
        acc += w
    return out, acc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workbook", default="data/CML_warehouse.xlsx")
    ap.add_argument("--sheet", default="PLAN_Sortie")
    ap.add_argument("--building", default="BATIMENT 13A")
    ap.add_argument("--id", default="bat-13a")
    ap.add_argument("--out", default="schema/warehouse.batiment-13a.json")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    wb = openpyxl.load_workbook(root / args.workbook, data_only=False)
    ws = wb[args.sheet]

    r0, r1, label = find_building_rows(ws, args.building)
    print(f"{label}: rows {r0}..{r1}")
    locations, blacks = extract(ws, r0, r1)
    print(f"  {len(locations)} locations, {sum(len(l['cells']) for l in locations.values())} positions, "
          f"{len(blacks)} blocked")

    row_h, col_w, aisle_rows, aisle_cols, (_, cmax) = build_axes(locations, r0, r1)
    # The floor is the building's whole interior, not just its racked part -
    # the clear strips (here, south of the last rack) are where the dock goes.
    rmin, rmax = r0, r1
    cmin = 2  # column 1 is the rotated building-name strip, outside the wall

    ys, total_h = axis_edges(row_h, rmin, rmax)
    xs, total_w = axis_edges(col_w, cmin, cmax)

    # Excel rows run downward; world +Y runs up. Flip, and inset by MARGIN so
    # the outermost racking isn't flush against the wall.
    def y_top(r):
        return total_h - ys[r][0] + MARGIN

    def y_bot(r):
        return total_h - ys[r][1] + MARGIN

    def y_mid(r):
        return (y_top(r) + y_bot(r)) / 2

    def x_left(c):
        return xs[c][0] + MARGIN

    def x_right(c):
        return xs[c][1] + MARGIN

    def x_mid(c):
        return (x_left(c) + x_right(c)) / 2

    width = total_w + 2 * MARGIN
    height = total_h + 2 * MARGIN
    print(f"  envelope {width:.1f} x {height:.1f} m")

    # --- slots -------------------------------------------------------------
    slots = []
    for code, loc in sorted(locations.items()):
        fr, fc = loc["cells"][0]
        face = loc["face"]
        depth = len(loc["cells"])
        if face == "S":      # opening faces south: front box's south edge is the aisle
            x, y = x_mid(fc), y_bot(fr) + POS_D / 2
        elif face == "N":
            x, y = x_mid(fc), y_top(fr) - POS_D / 2
        elif face == "W":
            x, y = x_left(fc) + POS_D / 2, y_mid(fr)
        else:
            x, y = x_right(fc) - POS_D / 2, y_mid(fr)
        slot = {"id": code, "x": round(x, 3), "y": round(y, 3)}
        if FACING[face]:
            slot["rotationDeg"] = FACING[face]
        if depth > 1:
            slot["depth"] = depth
        slots.append(slot)

    # --- aisles ------------------------------------------------------------
    # One corridor per aisle prefix, on the very line its labels are written
    # on, spanning the columns (or rows) those labels cover.
    occupied = {(r, c) for loc in locations.values() for r, c in loc["cells"]} | set(blacks)

    def clear_between_cols(rows, ca, cb):
        """Nothing drawn between two columns, along a corridor's own rows."""
        lo, hi = sorted((ca, cb))
        return not any((r, c) in occupied for r in rows for c in range(lo + 1, hi))

    aisles = defaultdict(list)
    for code, loc in locations.items():
        aisles[code[:2]].append(loc)

    h_cor, v_cor = {}, {}
    for prefix, locs in aisles.items():
        lrs = sorted({l["label"][0] for l in locs})
        lcs = sorted({l["label"][1] for l in locs})
        if locs[0]["face"] in "NS":
            h_cor[prefix] = {"rows": lrs, "y": (y_top(lrs[0]) + y_bot(lrs[-1])) / 2, "c0": lcs[0], "c1": lcs[-1]}
        else:
            v_cor[prefix] = {"cols": lcs, "x": (x_left(lcs[0]) + x_right(lcs[-1])) / 2, "r0": lrs[0], "r1": lrs[-1]}

    # The trunk is the plan's own vertical circulation route: the widest fully
    # empty column band that has racking on both sides of it. (Taking merely
    # the widest empty band would pick the clear floor along a wall, and every
    # aisle would then be dragged straight through the blocks in between.)
    empty_cols = [c for c in range(cmin, cmax + 1) if not any((r, c) in occupied for r in range(rmin, rmax + 1))]
    bands = []
    for c in empty_cols:
        if bands and c == bands[-1][-1] + 1:
            bands[-1].append(c)
        else:
            bands.append([c])
    occ_cols = {c for _, c in occupied}
    interior = [b for b in bands if any(c < b[0] for c in occ_cols) and any(c > b[-1] for c in occ_cols)]
    trunk_band = max(interior, key=len) if interior else bands[-1]
    trunk_col = trunk_band[len(trunk_band) // 2]
    trunk_x = (x_left(trunk_band[0]) + x_right(trunk_band[-1])) / 2

    paths = []
    joins = defaultdict(set)  # corridor key -> the y values it must carry a point at

    for prefix, h in sorted(h_cor.items(), key=lambda kv: -kv[1]["y"]):
        x0, x1 = x_mid(h["c0"]), x_mid(h["c1"])
        # Reach the trunk, from whichever side it lies on - but only if the
        # corridor's own rows are clear all the way there.
        if trunk_col < h["c0"] and clear_between_cols(h["rows"], h["c0"], trunk_col):
            x0 = trunk_x
            joins["trunk"].add(round(h["y"], 3))
        elif trunk_col > h["c1"] and clear_between_cols(h["rows"], h["c1"], trunk_col):
            x1 = trunk_x
            joins["trunk"].add(round(h["y"], 3))
        # Reach any vertical service corridor further east, same condition.
        for vp, v in v_cor.items():
            if v["cols"][0] > h["c1"] and clear_between_cols(h["rows"], h["c1"], v["cols"][0]):
                x1 = max(x1, v["x"])
                joins[vp].add(round(h["y"], 3))
        paths.append({"id": f"aisle-{prefix}", "points": [(x0, h["y"]), (x1, h["y"])]})

    # The dock: clear floor south of the last rack row.
    last_rack = max(r for r, _ in occupied)
    if last_rack < rmax:
        dock_y = (y_top(last_rack + 1) + y_bot(rmax)) / 2
    else:
        dock_y = y_bot(rmax) + POS_D
    dock_x1 = max(x_mid(h["c1"]) for h in h_cor.values())

    trunk_ys = sorted(joins["trunk"], reverse=True)
    paths.append({"id": "trunk", "points": [(trunk_x, y) for y in trunk_ys] + [(trunk_x, dock_y)]})
    paths.append({"id": "dock-south", "points": [(trunk_x, dock_y), (dock_x1, dock_y)]})

    # Vertical service corridors (the Z block's own aisle), spanning their own
    # locations and every horizontal aisle that reaches them.
    for prefix, v in v_cor.items():
        own = {round(y_top(v["r0"]), 3), round(y_bot(v["r1"]), 3)}
        pts = sorted(joins[prefix] | own, reverse=True)
        if len(pts) > 1:
            paths.append({"id": f"aisle-{prefix}", "points": [(v["x"], y) for y in pts]})

    def fmt(pts):
        return [{"x": round(x, 3), "y": round(y, 3)} for x, y in pts]

    paths = [
        {"id": p["id"], "points": fmt(p["points"]), "width": 2.2, "buildingIds": [args.id]}
        for p in paths
        if len(p["points"]) > 1
    ]

    # --- home base ---------------------------------------------------------
    # Not in the spreadsheet: the app needs somewhere for a forklift to start
    # and deliver to. Placed on the clear floor south of the last rack.
    lift = {"id": "CL01", "x": round(trunk_x + 6, 3), "y": round(dock_y - 2.5, 3), "buildingId": args.id}
    dock = {"id": "DS01", "x": round(trunk_x + 18, 3), "y": round(dock_y - 2.5, 3), "buildingId": args.id}

    config = {
        "id": args.id,
        "name": label.title(),
        "units": "m",
        "walls": [
            {
                "id": args.id,
                "closed": True,
                "points": [
                    {"x": 0, "y": 0},
                    {"x": round(width, 3), "y": 0},
                    {"x": round(width, 3), "y": round(height, 3)},
                    {"x": 0, "y": round(height, 3)},
                ],
            }
        ],
        "doors": [],
        "paths": paths,
        "liftStations": [lift],
        "deliverySpaces": [dock],
        "slotDefaults": {"width": LANE_W, "height": POS_D},
        "slots": slots,
    }

    out = root / args.out
    out.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print(f"  wrote {out.relative_to(root)}  ({len(slots)} slots, {len(paths)} paths)")

    content_path = out.with_name(out.stem.replace("warehouse.", "warehouse.content.") + out.suffix)
    content_path.write_text(
        json.dumps({"warehouseId": args.id, "slots": []}, indent=2) + "\n", encoding="utf-8"
    )
    print(f"  wrote {content_path.relative_to(root)}  (empty stock; capacity is depth x {LEVELS} tiers)")


if __name__ == "__main__":
    main()
