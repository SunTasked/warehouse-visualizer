#!/usr/bin/env node
/**
 * Generates a large set of picking lists for a plan, to exercise batch route
 * computation (specs.md §5.3) at the scale of a real day's orders.
 *
 * Lists alternate between storing into and picking from one building at a
 * time, against a running count of every slot's pallets — so, run in order
 * from the plan's starting stock, every pick finds a pallet and no sub-slot
 * is stacked past three tiers. Deterministic for a given seed.
 *
 *   node scripts/generate_picking_lists.mjs --plan schema/CML.plan.json --count 5000
 *
 * Options: --plan, --content (starting stock; empty if omitted), --count,
 * --seed, --out (default data/<plan id>.picking-lists.<count>.json — data/ is
 * gitignored). Load the result with Overview → Load → Picking lists.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];

const plan = JSON.parse(readFileSync(args.plan ?? "schema/CML.plan.json", "utf8"));
const count = Number(args.count ?? 5000);
const seed = Number(args.seed ?? 1);
const out = args.out ?? `data/${plan.id}.picking-lists.${count}.json`;

/** Pallets a sub-slot is stacked to — the rack's tiers. */
const TIERS = 3;
/** Pallets the forklift carries per trip. */
const CAPACITY = 3;

// mulberry32: small, fast and seedable.
let state = seed >>> 0;
function random() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
const choose = (items) => items[Math.floor(random() * items.length)];

function inside(point, polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

const buildings = plan.walls
  .filter((wall) => wall.closed && wall.points.length >= 3)
  .map((wall) => ({ id: wall.id, polygon: wall.points, slots: [], depots: [] }));
for (const slot of plan.slots) {
  const building = buildings.find((b) => inside(slot, b.polygon));
  if (building) building.slots.push({ id: slot.id, capacity: (slot.depth ?? 1) * TIERS });
}
for (const space of plan.deliverySpaces ?? []) {
  buildings.find((b) => b.id === space.buildingId)?.depots.push(space.id);
}
const usable = buildings.filter((b) => b.slots.length > 0 && b.depots.length > 0);
if (usable.length === 0) throw new Error("No building has both slots and a delivery space to generate lists for.");
const mainDepot = plan.deliverySpaces[0].id;

const stock = new Map();
if (args.content) {
  for (const slot of JSON.parse(readFileSync(args.content, "utf8")).slots) {
    stock.set(slot.slotId, slot.subSlots.reduce((sum, subSlot) => sum + subSlot.pallets.length, 0));
  }
}
let stocked = [...stock.values()].reduce((a, b) => a + b, 0);

/** A random slot of the building passing `test`, or null if a few dozen tries find none. */
function findSlot(building, test) {
  for (let tries = 0; tries < 60; tries++) {
    const slot = choose(building.slots);
    if (test(slot)) return slot;
  }
  return null;
}

const pad = (n) => String(n).padStart(String(count).length, "0");

function storing(building, n) {
  const stops = [];
  const depot = choose(building.depots);
  for (let trip = between(1, 2); trip > 0; trip--) {
    const slots = [];
    for (let i = between(1, CAPACITY); i > 0; i--) {
      const slot = findSlot(building, (s) => (stock.get(s.id) ?? 0) < s.capacity);
      if (!slot) break;
      stock.set(slot.id, (stock.get(slot.id) ?? 0) + 1);
      stocked += 1;
      slots.push({ kind: "slot", id: slot.id });
    }
    if (slots.length === 0) break;
    stops.push({ kind: "depot", id: depot }, ...slots);
  }
  return stops.length === 0 ? null : { id: `gen-${pad(n)}`, label: `Order ${pad(n)} · store in ${building.id}`, mode: "storing", stops };
}

function picking(building, n) {
  const stops = [];
  for (let trip = between(1, 2); trip > 0; trip--) {
    const slots = [];
    for (let i = between(1, CAPACITY); i > 0; i--) {
      const slot = findSlot(building, (s) => (stock.get(s.id) ?? 0) > 0);
      if (!slot) break;
      stock.set(slot.id, stock.get(slot.id) - 1);
      stocked -= 1;
      slots.push({ kind: "slot", id: slot.id });
    }
    if (slots.length === 0) break;
    stops.push(...slots, { kind: "depot", id: random() < 0.5 ? choose(building.depots) : mainDepot });
  }
  return stops.length === 0 ? null : { id: `gen-${pad(n)}`, label: `Order ${pad(n)} · pick from ${building.id}`, mode: "picking", stops };
}

const lists = [];
for (let n = 1; lists.length < count; n++) {
  const building = choose(usable);
  // Pick only once there's stock worth picking from, else the early lists
  // would all fall back to storing anyway.
  const list = (stocked > 50 && random() < 0.5 ? picking(building, n) : null) ?? storing(building, n);
  if (list) lists.push(list);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ warehouseId: plan.id, lists }, null, 2) + "\n");
const stops = lists.reduce((sum, list) => sum + list.stops.length, 0);
console.log(`wrote ${out}: ${lists.length} lists, ${stops} stops, ${stocked} pallets left in stock`);
