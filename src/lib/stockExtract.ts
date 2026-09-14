import type { SlotContent, Warehouse, WarehouseContent } from "../types/warehouse";
import { levelsOf, stackFullPallets } from "./stock";

/**
 * Stock the way a WMS query returns it (specs.md §5.6) — one row per location,
 * with its warehouse code and how many pallets stand there:
 *
 *   WAREHOUSE;SLOT;PALLET_COUNT
 *   CML;AA26Z;4
 *
 * — read straight into content, with no conversion to the content JSON first.
 * A count says nothing about what is on each pallet, so every pallet loads
 * full; nor where in the slot it stands, so pallets stack by the rule the
 * editor and the simulation store by (src/lib/stock.ts).
 */

export interface ExtractRow {
  /** Upper-cased; empty when the file has no warehouse column. */
  warehouse: string;
  /** Upper-cased location code, as the extract writes it. */
  location: string;
  pallets: number;
}

export interface StockExtract {
  rows: ExtractRow[];
  /** Lines with no location, or a pallet count that isn't a whole number. */
  skippedLines: number;
  hasWarehouseColumn: boolean;
}

const COLUMN_NAMES = {
  warehouse: ["WAREHOUSE", "WHS", "ENTREPOT"],
  location: ["SLOT", "LOCATION", "EMPLACEMENT"],
  pallets: ["PALLETCOUNT", "PALLETS", "NBPAL"],
};

const normalise = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, "");
const unquote = (value: string) => value.trim().replace(/^"(.*)"$/, "$1").trim();

/** Whether an opened content file is an extract rather than content JSON: by its extension, else by whether it even starts like JSON. */
export function isStockExtract(fileName: string, text: string): boolean {
  if (/\.(csv|tsv|txt)$/i.test(fileName)) return true;
  if (/\.json$/i.test(fileName)) return false;
  return !/^\s*[{[]/.test(text);
}

/** An extract's rows. The delimiter is whichever of `;`, tab or `,` splits the header most. Throws, with a message fit to show, when the header names no location or pallet count column. */
export function parseStockExtract(text: string): StockExtract {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim() !== "");
  if (headerIndex === -1) throw new Error("That file is empty.");
  const header = lines[headerIndex];
  const delimiter = [";", "\t", ","].reduce((best, candidate) =>
    header.split(candidate).length > header.split(best).length ? candidate : best,
  );
  const names = header.split(delimiter).map((name) => normalise(unquote(name)));
  const columnOf = (key: keyof typeof COLUMN_NAMES) => names.findIndex((name) => COLUMN_NAMES[key].includes(name));
  const warehouseAt = columnOf("warehouse");
  const locationAt = columnOf("location");
  const palletsAt = columnOf("pallets");
  if (locationAt === -1 || palletsAt === -1) {
    throw new Error(
      "That file isn't warehouse content or a stock extract: an extract's first line names its columns, SLOT and PALLET_COUNT (and WAREHOUSE).",
    );
  }

  const rows: ExtractRow[] = [];
  let skippedLines = 0;
  for (const line of lines.slice(headerIndex + 1)) {
    if (line.trim() === "") continue;
    const cells = line.split(delimiter);
    const location = unquote(cells[locationAt] ?? "").toUpperCase();
    const count = unquote(cells[palletsAt] ?? "");
    const pallets = count === "" ? NaN : Number(count);
    if (!location || !Number.isInteger(pallets) || pallets < 0) {
      skippedLines += 1;
      continue;
    }
    const warehouse = warehouseAt === -1 ? "" : unquote(cells[warehouseAt] ?? "").toUpperCase();
    rows.push({ warehouse, location, pallets });
  }
  return { rows, skippedLines, hasWarehouseColumn: warehouseAt !== -1 };
}

export interface ExtractWarehouse {
  code: string;
  rows: number;
}

/** The warehouse codes an extract covers, most rows first. */
export function extractWarehouses(extract: StockExtract): ExtractWarehouse[] {
  const rows = new Map<string, number>();
  for (const row of extract.rows) rows.set(row.warehouse, (rows.get(row.warehouse) ?? 0) + 1);
  return [...rows]
    .map(([code, count]) => ({ code, rows: count }))
    .sort((a, b) => b.rows - a.rows || a.code.localeCompare(b.code));
}

/**
 * The code whose rows belong to the plan on screen: the only one, or the one
 * named like the plan (CML for the plan `cml`). Null when the extract covers
 * several and none is — which one to load is then the user's call.
 */
export function planWarehouseCode(warehouses: ExtractWarehouse[], plan: Pick<Warehouse, "id" | "name">): string | null {
  if (warehouses.length === 1) return warehouses[0].code;
  const names = new Set([plan.id, plan.name].map(normalise).filter(Boolean));
  return warehouses.find((warehouse) => names.has(normalise(warehouse.code)))?.code ?? null;
}

/**
 * The plan slot a location code names: the code itself or, the way the CML
 * extract writes its locations (AA26Z for AA26), the code less a trailing Z.
 */
export function slotIdFor(location: string, slotIds: Set<string>): string | null {
  if (slotIds.has(location)) return location;
  const stem = location.slice(0, -1);
  return location.endsWith("Z") && slotIds.has(stem) ? stem : null;
}

export interface OverCapacity {
  location: string;
  slotId: string;
  pallets: number;
  capacity: number;
}

export interface ExtractReport {
  code: string;
  /** Rows for that warehouse. */
  rows: number;
  /** Rows for every other warehouse in the file — left out. */
  otherRows: number;
  /** Slots that receive pallets, and how many they receive in all. */
  slots: number;
  pallets: number;
  /** Rows whose location is no slot of the plan — left out. */
  unknown: ExtractRow[];
  /** Slots given more pallets than they hold, most excess first — filled to capacity. */
  overCapacity: OverCapacity[];
  /** The pallets over capacity, left out. */
  excessPallets: number;
  levels: number;
}

/** The content one warehouse's rows make on a plan, and what didn't fit. Rows naming the same slot add up. */
export function stockFromExtract(
  extract: StockExtract,
  plan: Pick<Warehouse, "id" | "slots" | "slotDefaults">,
  code: string,
): { content: WarehouseContent; report: ExtractReport } {
  const levels = levelsOf(plan.slotDefaults);
  const depthOf = new Map(plan.slots.map((slot) => [slot.id, slot.subSlots?.length ?? 1]));
  const slotIds = new Set(depthOf.keys());
  const counts = new Map<string, { location: string; pallets: number }>();
  const unknown: ExtractRow[] = [];
  let rows = 0;
  let otherRows = 0;

  for (const row of extract.rows) {
    if (row.warehouse !== code) {
      otherRows += 1;
      continue;
    }
    rows += 1;
    const slotId = slotIdFor(row.location, slotIds);
    if (!slotId) {
      unknown.push(row);
      continue;
    }
    const entry = counts.get(slotId);
    if (entry) entry.pallets += row.pallets;
    else counts.set(slotId, { location: row.location, pallets: row.pallets });
  }

  const slots: SlotContent[] = [];
  const overCapacity: OverCapacity[] = [];
  let pallets = 0;
  let excessPallets = 0;
  for (const [slotId, entry] of counts) {
    if (entry.pallets === 0) continue;
    const depth = depthOf.get(slotId)!;
    const capacity = depth * levels;
    if (entry.pallets > capacity) {
      overCapacity.push({ location: entry.location, slotId, pallets: entry.pallets, capacity });
      excessPallets += entry.pallets - capacity;
    }
    const stored = Math.min(entry.pallets, capacity);
    pallets += stored;
    slots.push({ slotId, subSlots: stackFullPallets(slotId, depth, stored, levels) });
  }
  overCapacity.sort((a, b) => b.pallets - b.capacity - (a.pallets - a.capacity) || a.slotId.localeCompare(b.slotId));

  return {
    content: { warehouseId: plan.id, slots },
    report: { code, rows, otherRows, slots: slots.length, pallets, unknown, overCapacity, excessPallets, levels },
  };
}
