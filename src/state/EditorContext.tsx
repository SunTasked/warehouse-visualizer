import {
  createContext,
  useCallback,
  useContext,
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
  updateWallPoint: (wallId: string, index: number, point: Point) => void;
  addSlot: (id: string, x: number, y: number) => boolean;
  updateSlot: (id: string, patch: Partial<Slot>) => boolean;
  deleteSlot: (id: string) => void;
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
  const [warehouse, setWarehouse] = useState(initialWarehouse);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
  const [addSlotMode, setAddSlotMode] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  const dragRef = useRef<DragTarget | null>(null);
  const orbitRef = useRef<OrbitControlsImpl | null>(null);
  const fileHandleRef = useRef<FileHandleLike | null>(null);

  const updateWallPoint = useCallback((wallId: string, index: number, point: Point) => {
    setDirty(true);
    setWarehouse((current) => ({
      ...current,
      walls: current.walls.map((wall) =>
        wall.id !== wallId
          ? wall
          : { ...wall, points: wall.points.map((p, i) => (i === index ? point : p)) },
      ),
    }));
  }, []);

  // The duplicate-id checks read `warehouse` directly (rather than inspecting
  // `current` from inside the setWarehouse updater) so the updater itself
  // stays a pure function of its input — React 18 Strict Mode invokes
  // updater functions twice in development specifically to catch impure
  // ones, and an outer mutable variable set inside the updater is exactly
  // that: it was double counting adds/edits before this fix.
  const addSlot = useCallback(
    (id: string, x: number, y: number): boolean => {
      if (warehouse.slots.some((s) => s.id === id)) return false;
      setWarehouse((current) => ({
        ...current,
        slots: [...current.slots, { id, x, y, rotationDeg: 0 }],
      }));
      setDirty(true);
      setSelectedSlotId(id);
      return true;
    },
    [warehouse],
  );

  const updateSlot = useCallback(
    (id: string, patch: Partial<Slot>): boolean => {
      if (patch.id && patch.id !== id && warehouse.slots.some((s) => s.id === patch.id)) {
        return false;
      }
      setWarehouse((current) => ({
        ...current,
        slots: current.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      }));
      setDirty(true);
      if (patch.id && patch.id !== id) setSelectedSlotId(patch.id);
      return true;
    },
    [warehouse],
  );

  const deleteSlot = useCallback((id: string) => {
    setDirty(true);
    setWarehouse((current) => ({ ...current, slots: current.slots.filter((s) => s.id !== id) }));
    setSelectedSlotId((current) => (current === id ? null : current));
  }, []);

  const save = useCallback(async () => {
    const handle = await saveWarehouse(warehouse, fileHandleRef.current);
    fileHandleRef.current = handle;
    setDirty(false);
  }, [warehouse]);

  const load = useCallback(async () => {
    const result = await loadWarehouse();
    if (!result) return;
    fileHandleRef.current = result.handle;
    setWarehouse(result.warehouse);
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
      updateWallPoint,
      addSlot,
      updateSlot,
      deleteSlot,
      save,
      load,
    }),
    [warehouse, dirty, mode, addSlotMode, selectedSlotId, updateWallPoint, addSlot, updateSlot, deleteSlot, save, load],
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used within an EditorProvider");
  return ctx;
}
