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
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Point, Slot, Warehouse } from "../types/warehouse";
import { loadWarehouse, saveWarehouse } from "../lib/file";

export type Mode = "view" | "edit";

export type DragTarget =
  | { type: "wallPoint"; wallId: string; index: number }
  | { type: "slot"; slotId: string };

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

interface HistoryState {
  warehouse: Warehouse;
  past: Warehouse[];
  future: Warehouse[];
}

interface EditorContextValue {
  warehouse: Warehouse;
  dirty: boolean;
  mode: Mode;
  setMode: (mode: Mode) => void;
  addSlotMode: boolean;
  setAddSlotMode: (value: boolean) => void;
  selectedSlotId: string | null;
  setSelectedSlotId: (id: string | null) => void;
  dragRef: MutableRefObject<DragTarget | null>;
  orbitRef: MutableRefObject<OrbitControlsImpl | null>;
  /** Snapshots the current warehouse for undo before a multi-step edit gesture (a drag, or a field gaining focus). */
  beginChange: () => void;
  updateWallPoint: (wallId: string, index: number, point: Point) => void;
  addSlot: (id: string, x: number, y: number) => boolean;
  updateSlot: (id: string, patch: Partial<Slot>) => boolean;
  deleteSlot: (id: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
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
  const [state, setState] = useState<HistoryState>({
    warehouse: initialWarehouse,
    past: [],
    future: [],
  });
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
  const [addSlotMode, setAddSlotMode] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  const dragRef = useRef<DragTarget | null>(null);
  const orbitRef = useRef<OrbitControlsImpl | null>(null);
  const fileHandleRef = useRef<FileHandleLike | null>(null);

  const warehouse = state.warehouse;

  // Clear a stale selection if the referenced slot no longer exists — e.g.
  // after an undo/redo that removed it.
  useEffect(() => {
    if (selectedSlotId && !warehouse.slots.some((s) => s.id === selectedSlotId)) {
      setSelectedSlotId(null);
    }
  }, [warehouse, selectedSlotId]);

  // Pushes the CURRENT warehouse onto the undo stack and clears redo, without
  // otherwise changing anything. Call once at the start of an edit gesture
  // (pointer-down on a drag handle, a field gaining focus) — the pure updater
  // below only ever reads its own `s` argument, so it stays safe under React
  // 18 Strict Mode's dev-only double-invocation of setState updaters.
  const beginChange = useCallback(() => {
    setState((s) => ({ ...s, past: [...s.past, s.warehouse], future: [] }));
  }, []);

  // Applies a mutation to the warehouse without touching undo/redo history —
  // used for the continuous updates within a gesture that already called
  // beginChange (every pointermove of a drag, every keystroke while a field
  // has focus), so a whole drag or a whole field edit is one undo step.
  const mutateWarehouse = useCallback((updater: (w: Warehouse) => Warehouse) => {
    setState((s) => ({ ...s, warehouse: updater(s.warehouse) }));
    setDirty(true);
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
      beginChange();
      mutateWarehouse((current) => ({
        ...current,
        slots: [...current.slots, { id, x: snapCoord(x), y: snapCoord(y), rotationDeg: 0 }],
      }));
      setSelectedSlotId(id);
      return true;
    },
    [warehouse, beginChange, mutateWarehouse],
  );

  const updateSlot = useCallback(
    (id: string, patch: Partial<Slot>): boolean => {
      if (patch.id && patch.id !== id && warehouse.slots.some((s) => s.id === patch.id)) {
        return false;
      }
      const snappedPatch: Partial<Slot> = { ...patch };
      if (snappedPatch.x !== undefined) snappedPatch.x = snapCoord(snappedPatch.x);
      if (snappedPatch.y !== undefined) snappedPatch.y = snapCoord(snappedPatch.y);
      if (snappedPatch.rotationDeg !== undefined) {
        snappedPatch.rotationDeg = snapRotation(snappedPatch.rotationDeg);
      }
      mutateWarehouse((current) => ({
        ...current,
        slots: current.slots.map((s) => (s.id === id ? { ...s, ...snappedPatch } : s)),
      }));
      if (patch.id && patch.id !== id) setSelectedSlotId(patch.id);
      return true;
    },
    [warehouse, mutateWarehouse],
  );

  const deleteSlot = useCallback(
    (id: string) => {
      beginChange();
      mutateWarehouse((current) => ({ ...current, slots: current.slots.filter((s) => s.id !== id) }));
      setSelectedSlotId((current) => (current === id ? null : current));
    },
    [beginChange, mutateWarehouse],
  );

  const undo = useCallback(() => {
    setState((s) => {
      if (s.past.length === 0) return s;
      const previous = s.past[s.past.length - 1];
      return { warehouse: previous, past: s.past.slice(0, -1), future: [s.warehouse, ...s.future] };
    });
    setDirty(true);
  }, []);

  const redo = useCallback(() => {
    setState((s) => {
      if (s.future.length === 0) return s;
      const next = s.future[0];
      return { warehouse: next, past: [...s.past, s.warehouse], future: s.future.slice(1) };
    });
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
    setState({ warehouse: result.warehouse, past: [], future: [] });
    setDirty(false);
    setSelectedSlotId(null);
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
      selectedSlotId,
      setSelectedSlotId,
      dragRef,
      orbitRef,
      beginChange,
      updateWallPoint,
      addSlot,
      updateSlot,
      deleteSlot,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      undo,
      redo,
      save,
      load,
    }),
    [
      warehouse,
      dirty,
      mode,
      addSlotMode,
      selectedSlotId,
      beginChange,
      updateWallPoint,
      addSlot,
      updateSlot,
      deleteSlot,
      state.past.length,
      state.future.length,
      undo,
      redo,
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
