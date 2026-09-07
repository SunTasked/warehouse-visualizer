// Generates schema/warehouse.batiment-13a.json — an APPROXIMATION of the
// "Batiment 13A" reference warehouse (a screenshot of an Excel export
// showing rows A/B/D/E/G, offset side blocks N/L/K, obstacle cells, and a
// detached block Z), built with the physical asset format from specs.md
// §5.1. Block row/column counts and positions are estimated from the
// screenshot, not measured — ids are arbitrary (sequential per block), not
// the real WMS location codes. See specs.md open question 10.
//
// Run: node scripts/generate-batiment-13a.js
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const slots = [];
let obstaclesSkipped = 0;

// Adds a rows x cols grid of slots. (originX, originY) is the BOTTOM-LEFT
// corner of the block's footprint (not a slot center). `skip` is a list of
// [row, col] pairs (0-indexed, row 0 = bottom row) to omit — used to carve
// out obstacle/pillar gaps like the black cells in the reference image.
function addBlock(prefix, originX, originY, cols, rows, skip = []) {
  const skipSet = new Set(skip.map(([r, c]) => `${r},${c}`));
  let n = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (skipSet.has(`${row},${col}`)) {
        obstaclesSkipped++;
        continue;
      }
      n++;
      slots.push({
        id: `${prefix}${n}`,
        x: originX + col * 4 + 2,
        y: originY + row * 2 + 1,
      });
    }
  }
}

// --- Left-side blocks (N, L, K), stacked bottom to top ---
addBlock("K", 0, 0, 8, 3, [[1, 3]]); // bottom-left, roughly aligned with G
addBlock("L", 0, 16, 3, 3, [[2, 2]]); // mid-left, roughly aligned with D/E; one corner obstacle
addBlock("N", 0, 32, 4, 4, [[1, 1]]); // upper-left, roughly aligned with A/B

// --- Main blocks, left edge at x=40, bottom to top ---
const MAIN_X = 40;
const MAIN_COLS = 46;

// G: bottom row-group, split into two sub-blocks with a gap (matches the
// visible break in the middle of the G row), narrower than the full width.
addBlock("G", MAIN_X, 0, 20, 2);
addBlock("G", MAIN_X + 20 * 4 + 4, 0, 20, 2);

// D/E: tall combined block with several scattered obstacles.
addBlock("D", MAIN_X, 8, MAIN_COLS, 8, [
  [6, 5],
  [3, 20],
  [3, 21],
  [1, 40],
]);

// B
addBlock("B", MAIN_X, 28, MAIN_COLS, 4, [[3, 6]]);

// A
addBlock("A", MAIN_X, 39, MAIN_COLS, 3, [[2, 7]]);

// --- Small end-cap clusters, right of the main blocks ---
const CAP_X = MAIN_X + MAIN_COLS * 4 + 8;
addBlock("AC", CAP_X, 39, 4, 3); // top-right, aligned with A's band
addBlock("GC", CAP_X, 0, 4, 3); // bottom-right, aligned with G's band

// --- Detached block Z, far right, separate building envelope ---
addBlock("Z", 280, 16, 6, 6);

// addBlock restarts numbering per call, so the two G calls collide — renumber them.
let gCounter = 0;
for (const s of slots) {
  if (s.id.startsWith("G") && !s.id.startsWith("GC")) {
    gCounter++;
    s.id = `G${gCounter}`;
  }
}

// --- Walls: bounding box of everything except Z, plus a margin; Z gets its own small envelope ---
const MARGIN = 4;
const mainSlots = slots.filter((s) => !s.id.startsWith("Z"));
const zSlots = slots.filter((s) => s.id.startsWith("Z"));

function bbox(items, halfW = 2, halfH = 1) {
  const xs = items.flatMap((s) => [s.x - halfW, s.x + halfW]);
  const ys = items.flatMap((s) => [s.y - halfH, s.y + halfH]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

const mainBB = bbox(mainSlots);
const zBB = bbox(zSlots);

const warehouse = {
  id: "bat-13a-full",
  name: "Batiment 13A (approximate)",
  units: "m",
  walls: [
    {
      id: "envelope",
      closed: true,
      points: [
        { x: mainBB.minX - MARGIN, y: mainBB.minY - MARGIN },
        { x: mainBB.maxX + MARGIN, y: mainBB.minY - MARGIN },
        { x: mainBB.maxX + MARGIN, y: mainBB.maxY + MARGIN },
        { x: mainBB.minX - MARGIN, y: mainBB.maxY + MARGIN },
      ],
    },
    {
      id: "envelope-z",
      closed: true,
      points: [
        { x: zBB.minX - MARGIN, y: zBB.minY - MARGIN },
        { x: zBB.maxX + MARGIN, y: zBB.minY - MARGIN },
        { x: zBB.maxX + MARGIN, y: zBB.maxY + MARGIN },
        { x: zBB.minX - MARGIN, y: zBB.maxY + MARGIN },
      ],
    },
  ],
  slotDefaults: { width: 4, height: 2 },
  slots,
};

const outPath = path.join(__dirname, "..", "schema", "warehouse.batiment-13a.json");
writeFileSync(outPath, JSON.stringify(warehouse, null, 2) + "\n");
console.log(`Wrote ${outPath}`);
console.log(`Slots: ${slots.length}, obstacle gaps skipped: ${obstaclesSkipped}`);
