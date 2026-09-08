import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type { Camera } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Point, Slot, Warehouse } from "../types/warehouse";
import { loadWarehouse, saveWarehouse } from "../lib/file";

export type Mode = "view" | "edit";

export type DragTarget = {
  label: string;
  /** Set to true on the first pointermove that actually applies a change — a
   * plain click (down+up with no movement) shouldn't commit a no-op history
   * entry. */
  moved: boolean;
} & (
  | { type: "wallPoint"; wallId: string; index: number }
  | { type: "slots"; ids: string[]; anchor: Point; origins: Record<string, Point> }
);

interface FileHandleLike {
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
}

// All edges (walls and slots) must land on whole-meter graduation marks.
// Slot footprints (4x2) have integer half-extents, so an integer center plus
// a rotation that's a multiple of 90 degrees is sufficient to keep the
// corners on integers too.
const snapCoord = (v: number): number => Math.round(v);
const snapRotation = (deg: number): number => Math.round(deg / 90) * 90;
const snapPoint = (p: Point): Point => ({ x: snapCoord(p.x), y: snapCoord(p.y) });

export interface HistoryEntry {
  warehouse: Warehouse;
  label: string;
}

interface EditorState {
  warehouse: Warehouse; // live/current document — may be ahead of entries[cursor] mid-gesture
  entries: HistoryEntry[]; // committed checkpoints, oldest first; entries[0] is the loaded state
  cursor: number; // entries[cursor].warehouse === warehouse whenever no gesture is in progress
}

interface EditorContextValue {
  warehouse: Warehouse;
  dirty: boolean;
  mode: Mode;
  setMode: (mode: Mode) => void;
  addSlotMode: boolean;
  setAddSlotMode: (value: boolean) => void;
  selectedSlotIds: Set<string>;
  toggleSlotSelection: (id: string) => void;
  selectOnly: (id: string) => void;
  selectMany: (ids: string[], additive: boolean) => void;
  clearSelection: () => void;
  dragRef: MutableRefObject<DragTarget | null>;
  orbitRef: MutableRefObject<OrbitControlsImpl | null>;
  cameraRef: MutableRefObject<Camera | null>;
  updateWallPoint: (wallId: string, index: number, point: Point) => void;
  addSlot: (id: string, x: number, y: number) => boolean;
  /** Applies the same field patch (e.g. rotation) to every listed slot. Live-mutate only — caller commits. */
  updateSlots: (ids: string[], patch: Partial<Omit<Slot, "id">>) => void;
  /** Applies a per-slot position patch (a different x/y per id) — used for group dragging. Live-mutate only. */
  applySlotPatches: (patches: { id: string; x: number; y: number }[]) => void;
  /** Renames a single slot's id, checking for collisions and following the selection. Live-mutate only — caller commits. */
  renameSlot: (id: string, newId: string) => boolean;
  deleteSlots: (ids: string[]) => void;
  /** Records the current live warehouse as one history entry with a human-readable label. */
  commit: (label: string) => void;
  entries: HistoryEntry[];
  cursor: number;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  jumpTo: (index: number) => void;
  showHistory: boolean;
  setShowHistory: (value: boolean) => void;
  save: () => Promise<void>;
  load: () => Promise<void>;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({
  initialWarehouse,
  children,
}: {
  initialWarehouse: Warehouse;
  children: ReactNode;
}) {
  const [state, setState] = useState<EditorState>({
    warehouse: initialWarehouse,
    entries: [{ warehouse: initialWarehouse, label: "Loaded" }],
    cursor: 0,
  });
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
  const [addSlotMode, setAddSlotMode] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedSlotIds, setSelectedSlotIds] = useState<Set<string>>(new Set());

  const dragRef = useRef<DragTarget | null>(null);
  const orbitRef = useRef<OrbitControlsImpl | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const fileHandleRef = useRef<FileHandleLike | null>(null);

  const warehouse = state.warehouse;

  // Drop selected ids that no longer exist — after a delete, an undo/redo, a
  // jump, or a load.
  useEffect(() => {
    setSelectedSlotIds((ids) => {
      const valid = new Set(warehouse.slots.map((s) => s.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of ids) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : ids;
    });
  }, [warehouse]);

  const toggleSlotSelection = useCallback((id: string) => {
    setSelectedSlotIds((ids) => {
      const next = new Set(ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectOnly = useCallback((id: string) => {
    setSelectedSlotIds(new Set([id]));
  }, []);

  const selectMany = useCallback((ids: string[], additive: boolean) => {
    setSelectedSlotIds((current) => {
      if (!additive) return new Set(ids);
      const next = new Set(current);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedSlotIds(new Set()), []);

  // Applies a mutation to the LIVE warehouse only — entries/cursor (and thus
  // undo/redo/the history panel) are untouched until commit() is called.
  // This is what lets a whole drag gesture or a whole field edit collapse
  // into one history entry instead of one per pointermove/keystroke.
  const mutateWarehouse = useCallback((updater: (w: Warehouse) => Warehouse) => {
    setState((s) => ({ ...s, warehouse: updater(s.warehouse) }));
    setDirty(true);
  }, []);

  // Records the current live warehouse as one committed history entry,
  // dropping any redo tail beyond the current cursor. Pure — only reads its
  // own `s` argument, safe under Strict Mode's double-invocation of updaters.
  const commit = useCallback((label: string) => {
    setState((s) => {
      const truncated = s.entries.slice(0, s.cursor + 1);
      return { warehouse: s.warehouse, entries: [...truncated, { warehouse: s.warehouse, label }], cursor: truncated.length };
    });
  }, []);

  const updateWallPoint = useCallback(
    (wallId: string, index: number, point: Point) => {
      const snapped = snapPoint(point);
      mutateWarehouse((current) => ({
        ...current,
        walls: current.walls.map((wall) =>
          wall.id !== wallId
            ? wall
            : { ...wall, points: wall.points.map((p, i) => (i === index ? snapped : p)) },
        ),
      }));
    },
    [mutateWarehouse],
  );

  const addSlot = useCallback(
    (id: string, x: number, y: number): boolean => {
      if (warehouse.slots.some((s) => s.id === id)) return false;
      mutateWarehouse((current) => ({
        ...current,
        slots: [...current.slots, { id, x: snapCoord(x), y: snapCoord(y), rotationDeg: 0 }],
      }));
      commit(`Add slot ${id}`);
      selectOnly(id);
      return true;
    },
    [warehouse, mutateWarehouse, commit, selectOnly],
  );

  const updateSlots = useCallback(
    (ids: string[], patch: Partial<Omit<Slot, "id">>) => {
      const snapped: Partial<Omit<Slot, "id">> = { ...patch };
      if (snapped.x !== undefined) snapped.x = snapCoord(snapped.x);
      if (snapped.y !== undefined) snapped.y = snapCoord(snapped.y);
      if (snapped.rotationDeg !== undefined) snapped.rotationDeg = snapRotation(snapped.rotationDeg);
      const idSet = new Set(ids);
      mutateWarehouse((current) => ({
        ...current,
        slots: current.slots.map((s) => (idSet.has(s.id) ? { ...s, ...snapped } : s)),
      }));
    },
    [mutateWarehouse],
  );

  const applySlotPatches = useCallback(
    (patches: { id: string; x: number; y: number }[]) => {
      const byId = new Map(patches.map((p) => [p.id, { x: snapCoord(p.x), y: snapCoord(p.y) }]));
      mutateWarehouse((current) => ({
        ...current,
        slots: current.slots.map((s) => {
          const p = byId.get(s.id);
          return p ? { ...s, x: p.x, y: p.y } : s;
        }),
      }));
    },
    [mutateWarehouse],
  );

  const renameSlot = useCallback(
    (id: string, newId: string): boolean => {
      const trimmed = newId.trim();
      if (!trimmed || trimmed === id) return true;
      if (warehouse.slots.some((s) => s.id === trimmed)) return false;
      mutateWarehouse((current) => ({
        ...current,
        slots: current.slots.map((s) => (s.id === id ? { ...s, id: trimmed } : s)),
      }));
      setSelectedSlotIds((ids) => {
        if (!ids.has(id)) return ids;
        const next = new Set(ids);
        next.delete(id);
        next.add(trimmed);
        return next;
      });
      return true;
    },
    [warehouse, mutateWarehouse],
  );

  const deleteSlots = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      mutateWarehouse((current) => ({ ...current, slots: current.slots.filter((s) => !idSet.has(s.id)) }));
      commit(ids.length === 1 ? `Delete slot ${ids[0]}` : `Delete ${ids.length} slots`);
    },
    [mutateWarehouse, commit],
  );

  const undo = useCallback(() => {
    setState((s) => (s.cursor <= 0 ? s : { warehouse: s.entries[s.cursor - 1].warehouse, entries: s.entries, cursor: s.cursor - 1 }));
    setDirty(true);
  }, []);

  const redo = useCallback(() => {
    setState((s) =>
      s.cursor >= s.entries.length - 1
        ? s
        : { warehouse: s.entries[s.cursor + 1].warehouse, entries: s.entries, cursor: s.cursor + 1 },
    );
    setDirty(true);
  }, []);

  const jumpTo = useCallback((index: number) => {
    setState((s) => (index < 0 || index >= s.entries.length ? s : { warehouse: s.entries[index].warehouse, entries: s.entries, cursor: index }));
    setDirty(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  const save = useCallback(async () => {
    const handle = await saveWarehouse(warehouse, fileHandleRef.current);
    fileHandleRef.current = handle;
    setDirty(false);
  }, [warehouse]);

  const load = useCallback(async () => {
    const result = await loadWarehouse();
    if (!result) return;
    fileHandleRef.current = result.handle;
    setState({
      warehouse: result.warehouse,
      entries: [{ warehouse: result.warehouse, label: `Loaded ${result.warehouse.name}` }],
      cursor: 0,
    });
    setDirty(false);
    setSelectedSlotIds(new Set());
    setAddSlotMode(false);
  }, []);

  const value = useMemo<EditorContextValue>(
    () => ({
      warehouse,
      dirty,
      mode,
      setMode,
      addSlotMode,
      setAddSlotMode,
      selectedSlotIds,
      toggleSlotSelection,
      selectOnly,
      selectMany,
      clearSelection,
      dragRef,
      orbitRef,
      cameraRef,
      updateWallPoint,
      addSlot,
      updateSlots,
      applySlotPatches,
      renameSlot,
      deleteSlots,
      commit,
      entries: state.entries,
      cursor: state.cursor,
      canUndo: state.cursor > 0,
      canRedo: state.cursor < state.entries.length - 1,
      undo,
      redo,
      jumpTo,
      showHistory,
      setShowHistory,
      save,
      load,
    }),
    [
      warehouse,
      dirty,
      mode,
      addSlotMode,
      selectedSlotIds,
      toggleSlotSelection,
      selectOnly,
      selectMany,
      clearSelection,
      updateWallPoint,
      addSlot,
      updateSlots,
      applySlotPatches,
      renameSlot,
      deleteSlots,
      commit,
      state.entries,
      state.cursor,
      undo,
      redo,
      jumpTo,
      showHistory,
      save,
      load,
    ],
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used within an EditorProvider");
  return ctx;
}
