import type { Warehouse } from "../types/warehouse";

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

const JSON_PICKER_TYPES = [
  { description: "Warehouse JSON", accept: { "application/json": [".json"] } },
];

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function downloadJson(warehouse: Warehouse): void {
  const blob = new Blob([JSON.stringify(warehouse, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${warehouse.id || "warehouse"}.json`;
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

/**
 * Saves to the given file handle if we have one (from a prior load/save-as),
 * otherwise prompts via the File System Access API (Chrome/Edge). Falls back
 * to a plain browser download when that API isn't available (e.g. Firefox,
 * Safari) — the caller won't get a handle back in that case, so subsequent
 * saves download again rather than overwriting in place.
 */
export async function saveWarehouse(
  warehouse: Warehouse,
  handle: FileSystemFileHandleLike | null,
): Promise<FileSystemFileHandleLike | null> {
  if (!window.showSaveFilePicker) {
    downloadJson(warehouse);
    return null;
  }

  try {
    const target =
      handle ??
      (await window.showSaveFilePicker({
        suggestedName: `${warehouse.id || "warehouse"}.json`,
        types: JSON_PICKER_TYPES,
      }));
    const writable = await target.createWritable();
    await writable.write(JSON.stringify(warehouse, null, 2));
    await writable.close();
    return target;
  } catch (err) {
    if (isAbort(err)) return handle;
    throw err;
  }
}

/**
 * Opens a warehouse JSON file. Uses the File System Access API when
 * available (so a following Save can write back in place); otherwise falls
 * back to a plain <input type="file"> picker.
 */
export async function loadWarehouse(): Promise<{ warehouse: Warehouse; handle: FileSystemFileHandleLike | null } | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: JSON_PICKER_TYPES, multiple: false });
      const file = await handle.getFile();
      const warehouse = JSON.parse(await file.text()) as Warehouse;
      return { warehouse, handle };
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }

  const file = await pickJsonFile();
  if (!file) return null;
  const warehouse = JSON.parse(await file.text()) as Warehouse;
  return { warehouse, handle: null };
}
