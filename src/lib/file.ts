import type { Warehouse, WarehouseConfig, WarehouseContent } from "../types/warehouse";
import { mergeWarehouse, splitWarehouse } from "./warehouseFiles";

// Minimal File System Access API typings (not yet in lib.dom.d.ts everywhere).
interface FileSystemFileHandleLike {
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: unknown) => Promise<FileSystemFileHandleLike[]>;
    showSaveFilePicker?: (options?: unknown) => Promise<FileSystemFileHandleLike>;
  }
}

export interface WarehouseFileHandles {
  configHandle: FileSystemFileHandleLike | null;
  contentHandle: FileSystemFileHandleLike | null;
}

const JSON_PICKER_TYPES = [
  { description: "Warehouse JSON", accept: { "application/json": [".json"] } },
];

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function pickJsonFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** Saves one JSON document to the given handle if present, otherwise prompts (FSA, or a plain download as fallback). */
async function saveJson(
  data: unknown,
  handle: FileSystemFileHandleLike | null,
  suggestedName: string,
): Promise<FileSystemFileHandleLike | null> {
  if (!window.showSaveFilePicker) {
    downloadJson(data, suggestedName);
    return null;
  }
  try {
    const target = handle ?? (await window.showSaveFilePicker({ suggestedName, types: JSON_PICKER_TYPES }));
    const writable = await target.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
    return target;
  } catch (err) {
    if (isAbort(err)) return handle;
    throw err;
  }
}

/** Opens one JSON file (FSA when available, so a following save can write back in place; `<input type=file>` otherwise). */
async function pickJson<T>(instructions: string): Promise<{ data: T; handle: FileSystemFileHandleLike | null } | null> {
  window.alert(instructions);
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: JSON_PICKER_TYPES, multiple: false });
      const file = await handle.getFile();
      return { data: JSON.parse(await file.text()) as T, handle };
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  const file = await pickJsonFile();
  if (!file) return null;
  return { data: JSON.parse(await file.text()) as T, handle: null };
}

/**
 * Loads a warehouse from two separate files, picked in sequence: first the
 * physical-layout **configuration**, then its **content** (inventory). The
 * content file is optional — cancelling that second picker still loads the
 * layout, just with every slot empty (mergeWarehouse handles a null
 * content). Cancelling the *first* picker (config) aborts the whole load.
 */
export async function loadWarehouseFiles(): Promise<
  { warehouse: Warehouse; handles: WarehouseFileHandles } | null
> {
  const configResult = await pickJson<WarehouseConfig>(
    "Select the warehouse CONFIGURATION file (layout: walls, slots, depth).",
  );
  if (!configResult) return null;

  const contentResult = await pickJson<WarehouseContent>(
    "Now select the warehouse CONTENT file (inventory: pallets/items). Cancel to load the layout empty.",
  );

  const warehouse = mergeWarehouse(configResult.data, contentResult?.data ?? null);
  return {
    warehouse,
    handles: { configHandle: configResult.handle, contentHandle: contentResult?.handle ?? null },
  };
}

/**
 * Splits the live warehouse back into its two files and saves each — to its
 * existing handle in place when we have one (FSA, from a prior load/save),
 * otherwise prompting for where to save (or downloading, on browsers without
 * the File System Access API).
 */
export async function saveWarehouseFiles(
  warehouse: Warehouse,
  handles: WarehouseFileHandles,
): Promise<WarehouseFileHandles> {
  const { config, content } = splitWarehouse(warehouse);
  const base = warehouse.id || "warehouse";
  const configHandle = await saveJson(config, handles.configHandle, `${base}.json`);
  const contentHandle = await saveJson(content, handles.contentHandle, `${base}.content.json`);
  return { configHandle, contentHandle };
}
