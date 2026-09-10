// Generates schema/warehouse.example.json (config) and
// schema/warehouse.content.example.json (content) — the default example
// warehouse: two facing-pairs of racking rows across a shared aisle.
//
//   A01-A05: depth 3, up to 2 pallet tiers/sub-slot, facing south.
//   B01-B05: depth 2, up to 3 pallet tiers/sub-slot, facing north.
//            (A and B face each other across a 2m aisle.)
//   N01-N04: depth 3, up to 2 pallet tiers/sub-slot, facing east.
//   M01-M04: depth 2, up to 3 pallet tiers/sub-slot, facing west.
//            (N and M face each other across a 2m aisle, oriented
//            perpendicular to A/B — "vertical" racks.)
//
// Each "0x" slot number gets the same pallet count across every group
// (01->1, 02->3, 03->5, 04->6, 05->0 where it exists), filled sub-slot by
// sub-slot using the exact same "fewest pallets wins, ties toward the
// deepest" rule as the app's own addPalletAuto (src/state/EditorContext.tsx)
// — so this data looks exactly like what clicking "+ Pallet" that many times
// in the Inspector would produce.
//
// Run: node scripts/generate-example-warehouse.js

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WIDTH = 4; // slotDefaults.width
const CELL_DEPTH = 2; // slotDefaults.height (one sub-slot's own depth-axis extent)
const ITEMS_PER_PALLET = 6; // not specified by the request; a reasonable fixed default

// rotationDeg -> facing, per Slots.tsx's actual rotation math (verified
// against the entry-marker/sub-slot position formulas, not assumed):
//   0 = North, 90 = West, 180 = South, 270 = East.
const FACING = { north: 0, west: 90, south: 180, east: 270 };

// Mirrors EditorContext.addPalletAuto exactly: repeatedly adds one pallet to
// whichever sub-slot currently has the fewest, tie-breaking toward the
// deepest (highest-index) one.
function fillDeepestFirst(depth, palletCount) {
  const counts = Array.from({ length: depth }, () => 0);
  for (let n = 0; n < palletCount; n++) {
    let targetIndex = 0;
    let fewest = Infinity;
    counts.forEach((c, i) => {
      if (c <= fewest) {
        fewest = c;
        targetIndex = i;
      }
    });
    counts[targetIndex]++;
  }
  return counts;
}

function subSlotsContent(slotId, depth, palletCount) {
  const tierCounts = fillDeepestFirst(depth, palletCount);
  return tierCounts.map((tierCount, subIndex) => {
    const pallets = [];
    for (let p = 1; p <= tierCount; p++) {
      const palletId = `${slotId}.${subIndex + 1}-P${p}`;
      const items = Array.from({ length: ITEMS_PER_PALLET }, (_, i) => ({
        id: `${palletId}-I${i + 1}`,
      }));
      pallets.push({ id: palletId, items });
    }
    return { pallets };
  });
}

// One "row" of slots sharing an orientation, laid out contiguously along
// their own width axis, all at the same anchor-perpendicular coordinate.
// `along` lists the [id-suffix, centerAlongRow, palletCount] entries;
// `perp` is the shared coordinate on the other axis (the entry-edge side).
function buildGroup({ prefix, facing, depth, along, alongAxis, perpValue }) {
  const rotationDeg = facing;
  const slots = [];
  const contents = [];
  for (const [suffix, alongCoord, palletCount] of along) {
    const id = `${prefix}${suffix}`;
    const x = alongAxis === "x" ? alongCoord : perpValue;
    const y = alongAxis === "y" ? alongCoord : perpValue;
    const slot = { id, x, y };
    if (rotationDeg !== 0) slot.rotationDeg = rotationDeg;
    if (depth > 1) slot.depth = depth;
    slots.push(slot);
    if (palletCount > 0) {
      contents.push({ slotId: id, subSlots: subSlotsContent(id, depth, palletCount) });
    }
  }
  return { slots, contents };
}

const PALLET_COUNTS_5 = { "01": 1, "02": 3, "03": 5, "04": 6, "05": 0 };
const PALLET_COUNTS_4 = { "01": 1, "02": 3, "03": 5, "04": 6 };

// --- A/B: horizontal facing-pair across a 2m east-west aisle, A north of
// it facing south, B south of it facing north. ---
const A_ROW_X = [4, 8, 12, 16, 20];
const A_ENTRY_Y = 14; // aisle's north edge
const A_ANCHOR_Y = A_ENTRY_Y + CELL_DEPTH / 2; // = 15
const B_ENTRY_Y = A_ENTRY_Y - 2; // aisle's south edge (2m aisle)
const B_ANCHOR_Y = B_ENTRY_Y - CELL_DEPTH / 2; // = 11

const groupA = buildGroup({
  prefix: "A",
  facing: FACING.south,
  depth: 3,
  alongAxis: "x",
  perpValue: A_ANCHOR_Y,
  along: A_ROW_X.map((x, i) => [String(i + 1).padStart(2, "0"), x, PALLET_COUNTS_5[String(i + 1).padStart(2, "0")]]),
});

const groupB = buildGroup({
  prefix: "B",
  facing: FACING.north,
  depth: 2,
  alongAxis: "x",
  perpValue: B_ANCHOR_Y,
  along: A_ROW_X.map((x, i) => [String(i + 1).padStart(2, "0"), x, PALLET_COUNTS_5[String(i + 1).padStart(2, "0")]]),
});

// --- N/M: vertical facing-pair (rotated 90/270), same aisle-width pattern,
// placed east of A/B with a clear gap. ---
const NM_ROW_Y = [4, 8, 12, 16];
const N_ENTRY_X = 32;
const N_ANCHOR_X = N_ENTRY_X - CELL_DEPTH / 2; // = 31
const M_ENTRY_X = N_ENTRY_X + 2; // 2m aisle
const M_ANCHOR_X = M_ENTRY_X + CELL_DEPTH / 2; // = 35

const groupN = buildGroup({
  prefix: "N",
  facing: FACING.east,
  depth: 3,
  alongAxis: "y",
  perpValue: N_ANCHOR_X,
  along: NM_ROW_Y.map((y, i) => [String(i + 1).padStart(2, "0"), y, PALLET_COUNTS_4[String(i + 1).padStart(2, "0")]]),
});

const groupM = buildGroup({
  prefix: "M",
  facing: FACING.west,
  depth: 2,
  alongAxis: "y",
  perpValue: M_ANCHOR_X,
  along: NM_ROW_Y.map((y, i) => [String(i + 1).padStart(2, "0"), y, PALLET_COUNTS_4[String(i + 1).padStart(2, "0")]]),
});

const allSlots = [...groupA.slots, ...groupB.slots, ...groupN.slots, ...groupM.slots];
const allContents = [...groupA.contents, ...groupB.contents, ...groupN.contents, ...groupM.contents];

const config = {
  id: "bat-13a",
  name: "Batiment 13A",
  units: "m",
  walls: [
    {
      id: "envelope",
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 22 },
        { x: 0, y: 22 },
      ],
    },
  ],
  slotDefaults: { width: WIDTH, height: CELL_DEPTH },
  slots: allSlots,
};

const content = {
  warehouseId: config.id,
  slots: allContents,
};

writeFileSync(
  path.join(__dirname, "../schema/warehouse.example.json"),
  JSON.stringify(config, null, 2) + "\n",
);
writeFileSync(
  path.join(__dirname, "../schema/warehouse.content.example.json"),
  JSON.stringify(content, null, 2) + "\n",
);

console.log(`Wrote ${allSlots.length} slots (config) and ${allContents.length} stocked slots (content).`);
