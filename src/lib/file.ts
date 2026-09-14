import type { Warehouse } from "../types/warehouse";
import { splitWarehouse } from "./warehouseFiles";

// Minimal File System Access API typings (not yet in lib.dom.d.ts everywhere).
export interface FileHandle {
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: unknown) => Promise<FileHandle[]>;
    showSaveFilePicker?: (options?: unknown) => Promise<FileHandle>;
  }
}

export interface WarehouseFileHandles {
  configHandle: FileHandle | null;
  contentHandle: FileHandle | null;
}

interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}

const JSON_PICKER_TYPES: PickerType[] = [
  { description: "Warehouse JSON", accept: { "application/json": [".json"] } },
];

/** Content is a JSON file, or a stock extract from the WMS (src/lib/stockExtract.ts). */
const CONTENT_PICKER_TYPES: PickerType[] = [
  {
    description: "Warehouse content or stock extract",
    accept: { "application/json": [".json"], "text/csv": [".csv"], "text/plain": [".txt"] },
  },
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

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** Saves one JSON document to the given handle if present, otherwise prompts (FSA, or a plain download as fallback). */
async function saveJson(data: unknown, handle: FileHandle | null, suggestedName: string): Promise<FileHandle | null> {
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

/** An opened file's text and name, and — through the File System Access API — a handle a later save can write back to. */
export interface OpenedFile {
  text: string;
  name: string;
  handle: FileHandle | null;
}

/**
 * Opens exactly one file — through the File System Access API when
 * available, so a later save can write back in place; `<input type=file>`
 * otherwise. A plant's plan, content and picking lists are separate files
 * loaded independently (Overview → Load), so interpreting what was opened is
 * left to the caller.
 *
 * Resolves null if the picker was cancelled.
 */
async function openFile(types: PickerType[]): Promise<OpenedFile | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types, multiple: false });
      const file = await handle.getFile();
      return { text: await file.text(), name: file.name, handle };
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  const accept = types
    .flatMap((type) => Object.entries(type.accept).flatMap(([mime, extensions]) => [mime, ...extensions]))
    .join(",");
  const file = await pickFile(accept);
  if (!file) return null;
  return { text: await file.text(), name: file.name, handle: null };
}

/** One JSON file, parsed. Resolves null if the picker was cancelled; throws if the file isn't JSON. */
export async function openJsonFile<T>(): Promise<{ data: T; handle: FileHandle | null } | null> {
  const opened = await openFile(JSON_PICKER_TYPES);
  if (!opened) return null;
  return { data: JSON.parse(opened.text) as T, handle: opened.handle };
}

/** One content file — content JSON or a stock extract — as text, for the caller to tell which. */
export function openContentFile(): Promise<OpenedFile | null> {
  return openFile(CONTENT_PICKER_TYPES);
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
