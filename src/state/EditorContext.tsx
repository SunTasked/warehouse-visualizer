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
import type { Point, Slot, SubSlot, Warehouse, WarehouseConfig, WarehouseContent } from "../types/warehouse";
import type { PickingList } from "../types/simulation";
import { saveWarehouseFiles, type FileHandle, type WarehouseFileHandles } from "../lib/file";
import { mergeWarehouse, splitWarehouse } from "../lib/warehouseFiles";

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

// All edges (walls and slots) must land on whole-meter graduation marks.
// Slot footprints (4x2) have integer half-extents, so an integer center plus
// a rotation that's a multiple of 90 degrees is sufficient to keep the
// corners on integers too.
const snapCoord = (v: number): number => Math.round(v);
const snapRotation = (deg: number): number => Math.round(deg / 90) * 90;
const snapPoint = (p: Point): Point => ({ x: snapCoord(p.x), y: snapCoord(p.y) });

const MAX_DEPTH = 12;
const MAX_ITEMS_PER_PALLET = 10;

function mapSubSlot(slot: Slot, subSlotIndex: number, fn: (subSlot: SubSlot) => SubSlot): Slot {
  if (!slot.subSlots) return slot;
  return { ...slot, subSlots: slot.subSlots.map((ss, i) => (i === subSlotIndex ? fn(ss) : ss)) };
}

/**
 * Where a history entry came from. Only "edit" — a change made in edit mode —
 * counts as unsaved: the simulation's picks and stores run through this same
 * history (which is how "Reset warehouse" undoes them) but aren't changes
 * anyone made to the warehouse, and a load is by definition what's on disk.
 */
export type HistoryOrigin = "load" | "edit" | "simulation";

export interface HistoryEntry {
  warehouse: Warehouse;
  label: string;
  origin: HistoryOrigin;
}

interface EditorState {
  warehouse: Warehouse; // live/current document — may be ahead of entries[cursor] mid-gesture
  entries: HistoryEntry[]; // committed checkpoints, oldest first; entries[0] is the loaded state
  cursor: number; // entries[cursor].warehouse === warehouse whenever no gesture is in progress
  /** Index of the entry matching what was last loaded or saved. */
  baseline: number;
  /** Unsaved edits the history can no longer point at: made before a content load reset it, or lost with a redo tail a new commit dropped. */
  carriedEdits: boolean;
}

/**
 * Records `warehouse` as one committed history entry after the cursor,
 * dropping any redo tail. If the saved entry sits in that tail, rebases onto
 * the new entry's parent and carries forward any edits lost with it.
 */
function appendEntry(s: EditorState, warehouse: Warehouse, label: string, origin: HistoryOrigin): EditorState {
  const truncated = s.entries.slice(0, s.cursor + 1);
  const baselineDropped = s.baseline > s.cursor;
  return {
    warehouse,
    entries: [...truncated, { warehouse, label, origin }],
    cursor: truncated.length,
    baseline: baselineDropped ? s.cursor : s.baseline,
    carriedEdits: s.carriedEdits || (baselineDropped && editsBetween(s.entries, s.cursor, s.baseline)),
  };
}

/** Whether any edit-mode entry lies between two history positions — in either direction, since undoing past a save point unsaves too. */
function editsBetween(entries: HistoryEntry[], a: number, b: number): boolean {
  for (let i = Math.min(a, b) + 1; i <= Math.max(a, b); i++) {
    if (entries[i]?.origin === "edit") return true;
  }
  return false;
}

/**
 * Unsaved = edit-mode changes since the last load or save. Derived from the
 * history rather than kept as a flag that every change sets, so moving back
 * to the saved state — an undo, a simulation reset — clears it on its own,
 * and the simulation moving stock never raises it.
 */
function hasUnsavedEdits(s: EditorState): boolean {
  return (
    s.carriedEdits ||
    editsBetween(s.entries, s.baseline, s.cursor) ||
    s.warehouse !== s.entries[s.cursor]?.warehouse // an edit gesture still in progress
  );
}

interface EditorContextValue {
  warehouse: Warehouse;
  /** Edit-mode changes since the last load or save — see hasUnsavedEdits. */
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
  /** Resizes a slot's depth (number of sub-slots). Live-mutate only — caller commits. */
  setSlotDepth: (slotId: string, depth: number) => void;
  /** Adds a pallet to whichever sub-slot needs it per the deepest-first fill rule. Commits immediately. */
  addPalletAuto: (slotId: string) => void;
  /** Removes one pallet from a sub-slot. Commits immediately. */
  removePallet: (slotId: string, subSlotIndex: number, palletIndex: number) => void;
  /**
   * Lands a finished batch of picking lists (§5.3): replaces the sub-slots of
   * every slot it changed, as one history entry of simulation origin — so a
   * batch of thousands of lists is one step to undo, and "Reset warehouse"
   * still steps back over it.
   */
  applySimulatedStock: (stock: Record<string, SubSlot[]>, label: string) => void;
  /** Resizes one pallet's item count (1-10). Live-mutate only — caller commits. */
  setPalletItemCount: (slotId: string, subSlotIndex: number, palletIndex: number, count: number) => void;
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
  /** The plant's forklift work orders — its third file, alongside the plan and content. */
  pickingLists: PickingList[];
  /** Replaces the warehouse with a plan file. It loads empty: stock is the separate content file. */
  applyPlan: (config: WarehouseConfig, handle: FileHandle | null) => void;
  /** Replaces the stock with a content file, on the plan already on screen. */
  applyContent: (content: WarehouseContent, handle: FileHandle | null) => void;
  applyPickingLists: (lists: PickingList[]) => void;
  /** Replaces the warehouse and its picking lists with ones that have no file behind them (a preset). */
  loadWarehouse: (warehouse: Warehouse, pickingLists: PickingList[]) => void;
  /** Undoes the simulation's trailing stock moves, stopping at the first change that wasn't one. */
  revertSimulation: () => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({
  initialWarehouse,
  initialPickingLists,
  children,
}: {
  initialWarehouse: Warehouse;
  initialPickingLists: PickingList[];
  children: ReactNode;
}) {
  const [state, setState] = useState<EditorState>({
    warehouse: initialWarehouse,
    entries: [{ warehouse: initialWarehouse, label: "Loaded", origin: "load" }],
    cursor: 0,
    baseline: 0,
    carriedEdits: false,
  });
  const dirty = hasUnsavedEdits(state);
  const [pickingLists, setPickingLists] = useState<PickingList[]>(initialPickingLists);
  const [mode, setMode] = useState<Mode>("view");
  // commit() reads this to tag each entry with the mode it was made in.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [addSlotMode, setAddSlotMode] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedSlotIds, setSelectedSlotIds] = useState<Set<string>>(new Set());

  const dragRef = useRef<DragTarget | null>(null);
  const orbitRef = useRef<OrbitControlsImpl | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const fileHandlesRef = useRef<WarehouseFileHandles>({ configHandle: null, contentHandle: null });

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
  }, []);

  // Records the current live warehouse as one committed history entry,
  // dropping any redo tail beyond the current cursor. Pure — only reads its
  // own `s` argument, safe under Strict Mode's double-invocation of updaters.
  const commit = useCallback((label: string) => {
    // Outside edit mode, the only thing that commits is the simulation
    // moving stock. Read at call time, not inside the updater.
    const origin: HistoryOrigin = modeRef.current === "edit" ? "edit" : "simulation";
    setState((s) => appendEntry(s, s.warehouse, label, origin));
  }, []);

  const applySimulatedStock = useCallback((stock: Record<string, SubSlot[]>, label: string) => {
    setState((s) => {
      const slots = s.warehouse.slots.map((slot) => (stock[slot.id] ? { ...slot, subSlots: stock[slot.id] } : slot));
      return appendEntry(s, { ...s.warehouse, slots }, label, "simulation");
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

  // Resizes a slot's depth (its subSlots array), preserving existing
  // sub-slots' content when growing and dropping the deepest ones when
  // shrinking. Live-mutate only — caller commits (mirrors the x/y/rotationDeg
  // inspector fields: live on change, one history entry on blur).
  const setSlotDepth = useCallback(
    (slotId: string, depth: number) => {
      const clamped = Math.max(1, Math.min(MAX_DEPTH, Math.round(depth)));
      mutateWarehouse((current) => ({
        ...current,
        slots: current.slots.map((s) => {
          if (s.id !== slotId) return s;
          const existing = s.subSlots ?? [{ id: `${s.id}.1`, pallets: [] }];
          const next = existing.slice(0, clamped);
          while (next.length < clamped) {
            next.push({ id: `${s.id}.${next.length + 1}`, pallets: [] });
          }
          return { ...s, subSlots: next };
        }),
      }));
    },
    [mutateWarehouse],
  );

  // Adds a new pallet (one item) to a slot, enforcing "fill deepest-first":
  // targets whichever sub-slot currently has the fewest pallets, breaking
  // ties toward the deepest (highest-index) one. Repeated calls fill tier 1
  // of every sub-slot from the back forward, then tier 2, and so on — never
  // piling a second tier onto one sub-slot while a deeper one is still
  // completely empty. A discrete click, like addSlot/deleteSlots — commits
  // immediately.
  const addPalletAuto = useCallback(
    (slotId: string) => {
      mutateWarehouse((current) => ({
        ...current,
        slots: current.slots.map((s) => {
          if (s.id !== slotId) return s;
          const subSlots = s.subSlots ?? [{ id: `${s.id}.1`, pallets: [] }];
          let targetIndex = 0;
          let fewest = Infinity;
          subSlots.forEach((ss, i) => {
            if (ss.pallets.length <= fewest) {
              fewest = ss.pallets.length;
              targetIndex = i; // later (deeper) indices win ties
            }
          });
          const nextSubSlots = subSlots.map((ss, i) => {
            if (i !== targetIndex) return ss;
            const palletId = `${ss.id}-P${ss.pallets.length + 1}`;
            return { ...ss, pallets: [...ss.pallets, { id: palletId, items: [{ id: `${palletId}-I1` }] }] };
          });
          return { ...s, subSlots: nextSubSlots };
        }),
      }));
      commit(`Add pallet to ${slotId}`);
    },
    [mutateWarehouse, commit],
  );

  const removePallet = useCallback(
    (slotId: string, subSlotIndex: number, palletIndex: number) => {
      mutateWarehouse((current) => ({
        ...current,
        slots: current.slots.map((s) =>
          s.id !== slotId
            ? s
            : mapSubSlot(s, subSlotIndex, (ss) => ({
                ...ss,
                pallets: ss.pallets.filter((_, pi) => pi !== palletIndex),
              })),
        ),
      }));
      commit(`Remove pallet from ${slotId}`);
    },
    [mutateWarehouse, commit],
  );

  // Resizes one pallet's item count (1-10). Live-mutate only — caller commits on blur.
  const setPalletItemCount = useCallback(
    (slotId: string, subSlotIndex: number, palletIndex: number, count: number) => {
      const clamped = Math.max(1, Math.min(MAX_ITEMS_PER_PALLET, Math.round(count)));
      mutateWarehouse((current) => ({
        ...current,
        slots: current.slots.map((s) =>
          s.id !== slotId
            ? s
            : mapSubSlot(s, subSlotIndex, (ss) => ({
                ...ss,
                pallets: ss.pallets.map((p, pi) => {
                  if (pi !== palletIndex) return p;
                  const items = p.items.slice(0, clamped);
                  while (items.length < clamped) items.push({ id: `${p.id}-I${items.length + 1}` });
                  return { ...p, items };
                }),
              })),
        ),
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
    setState((s) => (s.cursor <= 0 ? s : { ...s, warehouse: s.entries[s.cursor - 1].warehouse, cursor: s.cursor - 1 }));
  }, []);

  const redo = useCallback(() => {
    setState((s) =>
      s.cursor >= s.entries.length - 1 ? s : { ...s, warehouse: s.entries[s.cursor + 1].warehouse, cursor: s.cursor + 1 },
    );
  }, []);

  const jumpTo = useCallback((index: number) => {
    setState((s) => (index < 0 || index >= s.entries.length ? s : { ...s, warehouse: s.entries[index].warehouse, cursor: index }));
  }, []);

  /**
   * "Reset warehouse": steps back over the simulation's own trailing stock
   * moves and stops at the first entry that wasn't one. Jumping straight to
   * the loaded state instead would also undo layout edits made before the
   * runs, which resetting the *simulation* has no business touching.
   */
  const revertSimulation = useCallback(() => {
    setState((s) => {
      let target = s.cursor;
      while (target > 0 && s.entries[target].origin === "simulation") target--;
      return target === s.cursor ? s : { ...s, warehouse: s.entries[target].warehouse, cursor: target };
    });
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
    const saved = warehouse;
    fileHandlesRef.current = await saveWarehouseFiles(saved, fileHandlesRef.current);
    // What was saved becomes the baseline — unless the history moved on while
    // the save dialog was open, in which case the disk is still behind it.
    setState((s) => (s.warehouse === saved ? { ...s, baseline: s.cursor, carriedEdits: false } : s));
  }, [warehouse]);

  // Every load starts a fresh history whose only entry is what was loaded —
  // the baseline unsaved changes are measured from.
  const resetHistory = useCallback((next: Warehouse, label: string, carriedEdits: boolean) => {
    setState({ warehouse: next, entries: [{ warehouse: next, label, origin: "load" }], cursor: 0, baseline: 0, carriedEdits });
    setSelectedSlotIds(new Set());
    setAddSlotMode(false);
  }, []);

  // A preset has no file behind it, so the previous file's handles are
  // dropped — otherwise the next Save would silently write the preset over
  // whatever file was open before.
  const loadWarehouse = useCallback(
    (next: Warehouse, lists: PickingList[]) => {
      fileHandlesRef.current = { configHandle: null, contentHandle: null };
      resetHistory(next, `Loaded ${next.name}`, false);
      setPickingLists(lists);
    },
    [resetHistory],
  );

  // A plan replaces the building, so it loads empty — its stock is the
  // separate content file. Picking lists survive only a reload of the same
  // plant: another plant's orders name locations this one doesn't have.
  const applyPlan = useCallback(
    (config: WarehouseConfig, handle: FileHandle | null) => {
      fileHandlesRef.current = { configHandle: handle, contentHandle: null };
      if (config.id !== warehouse.id) setPickingLists([]);
      resetHistory(mergeWarehouse(config, null), `Loaded plan ${config.name}`, false);
    },
    [warehouse.id, resetHistory],
  );

  // Content lands on the plan already on screen. Unsaved edits made before it
  // can't be told apart from the stock it replaces, so they stay flagged
  // rather than being silently marked saved.
  const applyContent = useCallback((content: WarehouseContent, handle: FileHandle | null) => {
    fileHandlesRef.current = { ...fileHandlesRef.current, contentHandle: handle };
    setState((s) => {
      const next = mergeWarehouse(splitWarehouse(s.warehouse).config, content);
      return {
        warehouse: next,
        entries: [{ warehouse: next, label: "Loaded content", origin: "load" }],
        cursor: 0,
        baseline: 0,
        carriedEdits: hasUnsavedEdits(s),
      };
    });
    setSelectedSlotIds(new Set());
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
      setSlotDepth,
      addPalletAuto,
      removePallet,
      applySimulatedStock,
      setPalletItemCount,
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
      pickingLists,
      applyPlan,
      applyContent,
      applyPickingLists: setPickingLists,
      loadWarehouse,
      revertSimulation,
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
      setSlotDepth,
      addPalletAuto,
      removePallet,
      applySimulatedStock,
      setPalletItemCount,
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
      pickingLists,
      applyPlan,
      applyContent,
      loadWarehouse,
      revertSimulation,
    ],
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used within an EditorProvider");
  return ctx;
}
