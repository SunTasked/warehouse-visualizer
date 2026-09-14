import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Warehouse, WarehouseContent } from "../types/warehouse";
import type { FileHandle } from "../lib/file";
import {
  extractWarehouses,
  planWarehouseCode,
  stockFromExtract,
  type ExtractWarehouse,
  type StockExtract,
} from "../lib/stockExtract";

/** A content file opened but not loaded yet: content JSON, or a stock extract (src/lib/stockExtract.ts). */
export type PendingContent =
  | { kind: "json"; fileName: string; content: WarehouseContent; handle: FileHandle | null }
  | { kind: "extract"; fileName: string; extract: StockExtract };

interface Issue {
  title: string;
  detail: string;
  /** The entries concerned, listed in full. */
  items?: string[];
}

export interface ContentLoad {
  content: WarehouseContent;
  /** Where a later Save writes the content — never an extract's own file, which Save would overwrite with JSON. */
  handle: FileHandle | null;
  summary: string;
  issues: Issue[];
  /** Nothing worth asking about: it loads straight away. */
  clean: boolean;
  /** Whether there is anything to load at all. */
  canLoad: boolean;
  /** An extract's warehouse codes, which one is loading, and the one named like the plan (null if none is). */
  extract?: { warehouses: ExtractWarehouse[]; code: string; named: string | null };
}

const count = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, word: string) => `${count(n)} ${word}${n === 1 ? "" : "s"}`;

/**
 * What loading `pending` onto `warehouse` would put in the racks, and what it
 * would leave out. `code` picks an extract's warehouse; by default the one
 * named like the plan.
 */
export function readContentLoad(pending: PendingContent, warehouse: Warehouse, hasStock: boolean, code?: string): ContentLoad {
  if (pending.kind === "json") {
    const { content } = pending;
    const known = new Set(warehouse.slots.map((slot) => slot.id));
    const unknown = content.slots.filter((entry) => !known.has(entry.slotId)).map((entry) => entry.slotId);
    const issues: Issue[] = [];
    if (content.warehouseId !== warehouse.id) {
      issues.push({ title: `Written for "${content.warehouseId}"`, detail: `The plan on screen is "${warehouse.id}".` });
    }
    if (unknown.length > 0) {
      issues.push({ title: `${plural(unknown.length, "slot")} not in this plan`, detail: "Their stock is left out.", items: unknown });
    }
    return {
      content,
      handle: pending.handle,
      summary: `Stock for ${plural(content.slots.length, "slot")}.`,
      issues,
      clean: issues.length === 0 && !hasStock,
      canLoad: true,
    };
  }

  const { extract } = pending;
  const warehouses = extractWarehouses(extract);
  const named = planWarehouseCode(warehouses, warehouse);
  const chosen = code ?? named ?? warehouses[0]?.code ?? "";
  const { content, report } = stockFromExtract(extract, warehouse, chosen);

  const issues: Issue[] = [];
  if (report.pallets === 0) {
    issues.push({
      title: "Nothing to load",
      detail: `No ${chosen ? `${chosen} ` : ""}location in this extract is a slot of this plan.`,
    });
  }
  if (report.unknown.length > 0) {
    issues.push({
      title: `${plural(report.unknown.length, "location")} not in this plan`,
      detail: "No slot has these codes, so their pallets are left out.",
      items: report.unknown.map((row) => `${row.location} · ${plural(row.pallets, "pallet")}`),
    });
  }
  if (report.overCapacity.length > 0) {
    issues.push({
      title: `${plural(report.overCapacity.length, "slot")} over capacity`,
      detail: `They hold more pallets than depth × ${report.levels} levels, so each is filled to capacity and ${plural(report.excessPallets, "pallet")} are left out.`,
      items: report.overCapacity.map((slot) => `${slot.location} · ${count(slot.pallets)} for ${count(slot.capacity)} places`),
    });
  }
  if (extract.skippedLines > 0) {
    issues.push({
      title: `${plural(extract.skippedLines, "line")} unreadable`,
      detail: "No location, or a pallet count that isn't a whole number. Left out.",
    });
  }

  const others = warehouses.filter((warehouse) => warehouse.code !== chosen).length;
  const summary =
    `${plural(report.rows, "row")}${extract.hasWarehouseColumn ? ` for ${chosen}` : ""}: ` +
    `${plural(report.pallets, "full pallet")} into ${plural(report.slots, "slot")}.` +
    (report.otherRows > 0 ? ` The ${plural(report.otherRows, "row")} for ${plural(others, "other warehouse")} are left out.` : "");

  return {
    content,
    handle: null,
    summary,
    issues,
    clean: issues.length === 0 && report.otherRows === 0 && !hasStock,
    canLoad: report.pallets > 0,
    extract: { warehouses, code: chosen, named },
  };
}

/**
 * Asked before content loads whenever there is something to say: slots the
 * plan doesn't have, slots given more than they hold, stock about to be
 * replaced — and, for an extract covering several warehouses, which one.
 */
export function ContentLoadDialog({
  pending,
  warehouse,
  hasStock,
  onLoad,
  onCancel,
}: {
  pending: PendingContent;
  warehouse: Warehouse;
  hasStock: boolean;
  onLoad: (content: WarehouseContent, handle: FileHandle | null) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState<string | undefined>(undefined);
  const load = useMemo(() => readContentLoad(pending, warehouse, hasStock, code), [pending, warehouse, hasStock, code]);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primaryRef.current?.focus();
    // Capture phase, and stopped there: Escape otherwise also reaches the
    // view's own handler and sends the camera back to the plant.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  return createPortal(
    <div
      className="confirm-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="confirm content-load" role="dialog" aria-modal="true" aria-labelledby="content-load-title">
        <h3 id="content-load-title">Load stock from {pending.fileName}</h3>
        <p>{load.summary}</p>

        {load.extract && load.extract.warehouses.length > 1 && (
          <label className="content-load__warehouse">
            <span>Warehouse</span>
            <select value={load.extract.code} onChange={(event) => setCode(event.target.value)}>
              {load.extract.warehouses.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code || "(blank)"} · {plural(option.rows, "row")}
                </option>
              ))}
            </select>
            {load.extract.named === null && (
              <span className="content-load__hint">None is named like this plan ({warehouse.id}): pick the one it holds.</span>
            )}
          </label>
        )}

        {load.issues.length > 0 && (
          <div className="content-load__issues">
            {load.issues.map((issue, i) => (
              <div className="content-load__issue" key={i}>
                <div className="content-load__issue-title">{issue.title}</div>
                <div className="content-load__issue-detail">{issue.detail}</div>
                {issue.items && (
                  <ul className="content-load__items">
                    {issue.items.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}

        {hasStock && <p className="content-load__note">It replaces the stock currently in the racks.</p>}

        <div className="confirm__actions">
          <button className="confirm__btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={primaryRef}
            className="confirm__btn confirm__btn--accent"
            disabled={!load.canLoad}
            onClick={() => onLoad(load.content, load.handle)}
          >
            Load stock
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
