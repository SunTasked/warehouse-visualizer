import { useEffect, useRef, useState } from "react";
import { useEditor } from "../state/EditorContext";
import { useSimulation } from "../state/SimulationContext";
import { useAnalytics } from "../state/AnalyticsContext";
import { useViewFocus } from "../state/ViewFocusContext";
import { WAREHOUSE_PRESETS, type WarehousePreset } from "../data/presets";
import { openJsonFile, type FileHandle } from "../lib/file";
import type { WarehouseConfig, WarehouseContent } from "../types/warehouse";
import type { PickingListsFile } from "../types/simulation";

type Submenu = "presets" | "load";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Title, warehouse identity and the two top-level tabs (specs.md §5.6).
 * Performances is gated on there being something to look at — the board is
 * meaningless without a recorded session, and a disabled tab says that more
 * plainly than an empty board would.
 */
export function AppHeader() {
  const {
    warehouse,
    mode,
    setMode,
    setAddSlotMode,
    dirty,
    save,
    pickingLists,
    applyPlan,
    applyContent,
    applyPickingLists,
    loadWarehouse,
  } = useEditor();
  const simulation = useSimulation();
  const analytics = useAnalytics();
  const { reset: resetFocus } = useViewFocus();
  const [showInfo, setShowInfo] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [openSub, setOpenSub] = useState<Submenu | null>(null);
  const [loadingPreset, setLoadingPreset] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const hasSession = simulation.capturedRuns.length > 0;
  const wallCount = warehouse.walls.length;
  const hasStock = warehouse.slots.some((slot) => slot.subSlots?.some((subSlot) => subSlot.pallets.length > 0));

  // A menu that stays open after you click past it is worse than no menu.
  useEffect(() => {
    if (!showMenu) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setShowMenu(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [showMenu]);

  // Reopening the menu starts from its top level, not a submenu left open.
  useEffect(() => {
    if (!showMenu) setOpenSub(null);
  }, [showMenu]);

  // One submenu at a time, so the menu never grows taller than it needs to.
  const toggleSub = (sub: Submenu) => setOpenSub((current) => (current === sub ? null : sub));

  const select = (tab: "overview" | "performances") => {
    if (tab === "performances" && !hasSession) return;
    analytics.setTab(tab);
  };

  /** What the current session would lose if its layout went away — the recorded runs were measured against it. */
  const sessionLosses = (): string[] => {
    const runs = simulation.sessionRuns.length;
    const snapshots = analytics.snapshots.length;
    return [
      runs > 0 ? `${plural(runs, "recorded run")} and both heatmaps` : null,
      snapshots > 0 ? plural(snapshots, "saved snapshot") : null,
    ].filter((loss): loss is string => loss !== null);
  };

  const discardSession = () => {
    simulation.clearSession();
    analytics.clearAll();
  };

  /**
   * Entering edit mode discards the session: every recorded route was
   * computed against the layout that is about to change, so keeping the runs
   * would mean scoring journeys that can no longer happen. The cost is
   * spelled out rather than left to a generic "are you sure" — losing a
   * baseline you were about to compare against is worth naming precisely.
   */
  const toggleMode = () => {
    setShowMenu(false);
    const next = mode === "view" ? "edit" : "view";
    if (next === "edit") {
      const lost = sessionLosses();
      if (lost.length > 0) {
        const ok = window.confirm(
          `Editing the layout discards the current session.

You will lose ${lost.join(", plus ")}.

The routes were measured against this layout, so they can't be compared against the edited one. Continue?`,
        );
        if (!ok) return;
      }
      discardSession();
    }
    setMode(next);
    if (next === "view") setAddSlotMode(false);
  };

  /**
   * Swapping in another warehouse loses more than editing does: unsaved
   * changes too, not just the session. Same principle as toggleMode — name
   * the cost, and only ask when there is one.
   */
  const confirmReplace = (action: string, extraLosses: (string | null)[] = []): boolean => {
    const lost = [dirty ? "unsaved changes" : null, ...extraLosses, ...sessionLosses()].filter(Boolean);
    if (lost.length === 0) return true;
    return window.confirm(`${action} replaces the current warehouse.

You will lose ${lost.join(", plus ")}.

Continue?`);
  };

  /** Everything tied to the outgoing warehouse: its session, and any drill-down into a building that won't exist in the next one. */
  const afterReplace = () => {
    discardSession();
    resetFocus();
  };

  const openPreset = async (preset: WarehousePreset) => {
    if (!confirmReplace(`Loading ${preset.label}`)) return;
    setLoadingPreset(preset.warehouseId);
    try {
      const loaded = await preset.load();
      loadWarehouse(loaded.warehouse, loaded.pickingLists);
      afterReplace();
      setShowMenu(false);
    } catch (err) {
      console.error(err);
      window.alert(`Couldn't load the ${preset.label} preset.`);
    } finally {
      setLoadingPreset(null);
    }
  };

  /** One JSON file from the picker — null when cancelled, or when it isn't JSON (which it says). */
  const pickFile = async <T,>(): Promise<{ data: T; handle: FileHandle | null } | null> => {
    setShowMenu(false);
    try {
      return await openJsonFile<T>();
    } catch (err) {
      console.error(err);
      window.alert("That file couldn't be read as JSON.");
      return null;
    }
  };

  const loadPlan = async () => {
    const picked = await pickFile<WarehouseConfig>();
    if (!picked) return;
    const config = picked.data;
    if (!Array.isArray(config?.walls) || !Array.isArray(config?.slots)) {
      window.alert("That file isn't a warehouse plan — it has no walls or slots.");
      return;
    }
    // A plan loads empty (its stock is the content file), and a different
    // plant's picking lists name locations the new plan won't have.
    const otherPlant = config.id !== warehouse.id;
    const ok = confirmReplace(`Loading the plan "${config.name}"`, [
      hasStock ? "the stock in the racks (load the plan's content next)" : null,
      otherPlant && pickingLists.length > 0 ? `this plant's ${plural(pickingLists.length, "picking list")}` : null,
    ]);
    if (!ok) return;
    applyPlan(config, picked.handle);
    afterReplace();
  };

  const loadContent = async () => {
    const picked = await pickFile<WarehouseContent>();
    if (!picked) return;
    const content = picked.data;
    if (!Array.isArray(content?.slots)) {
      window.alert("That file isn't warehouse content — it has no slots.");
      return;
    }
    const known = new Set(warehouse.slots.map((slot) => slot.id));
    const unknown = content.slots.filter((entry) => !known.has(entry.slotId)).length;
    const warnings = [
      content.warehouseId !== warehouse.id
        ? `It was written for "${content.warehouseId}", but the plan on screen is "${warehouse.id}".`
        : null,
      unknown > 0 ? `${unknown} of its ${plural(content.slots.length, "slot")} aren't in this plan and will be ignored.` : null,
      hasStock ? "It replaces the stock currently in the racks." : null,
    ].filter((warning): warning is string => warning !== null);
    if (warnings.length > 0 && !window.confirm(`Load this content?\n\n${warnings.join("\n")}`)) return;
    applyContent(content, picked.handle);
  };

  const loadPickingLists = async () => {
    const picked = await pickFile<PickingListsFile>();
    if (!picked) return;
    const file = picked.data;
    if (!Array.isArray(file?.lists)) {
      window.alert("That file isn't a picking lists file — it has no lists.");
      return;
    }
    const places = new Set([
      ...warehouse.slots.map((slot) => slot.id),
      ...warehouse.liftStations.map((station) => station.id),
      ...warehouse.deliverySpaces.map((space) => space.id),
    ]);
    const unknown = [...new Set(file.lists.flatMap((list) => (list.stops ?? []).map((stop) => stop.id)))].filter(
      (id) => !places.has(id),
    );
    const warnings = [
      file.warehouseId !== warehouse.id
        ? `They were written for "${file.warehouseId}", but the plan on screen is "${warehouse.id}".`
        : null,
      unknown.length > 0
        ? `${plural(unknown.length, "location")} they visit ${unknown.length === 1 ? "isn't" : "aren't"} in this plan (${unknown
            .slice(0, 4)
            .join(", ")}${unknown.length > 4 ? ", …" : ""}), so routes will skip ${unknown.length === 1 ? "it" : "them"}.`
        : null,
    ].filter((warning): warning is string => warning !== null);
    if (warnings.length > 0 && !window.confirm(`Load these picking lists?\n\n${warnings.join("\n")}`)) return;
    applyPickingLists(file.lists);
  };

  /** The three files a plant is made of, each loadable on its own. */
  const loadItems = [
    { key: "plan", label: "Warehouse plan…", description: "Layout: walls, slots, corridors, facilities", run: loadPlan },
    { key: "content", label: "Warehouse content…", description: "Stock: the pallets in each slot", run: loadContent },
    { key: "lists", label: "Picking lists…", description: "Work orders for the forklift", run: loadPickingLists },
  ];

  return (
    <header className="app__header">
      <div className="app__title-row">
        <h1>Warehouse benchmarker</h1>
        <div className="app__subtitle">
          <span>{warehouse.name}</span>
          <button
            className="app__info"
            onClick={() => setShowInfo((v) => !v)}
            onBlur={() => setShowInfo(false)}
            title="Warehouse details"
            aria-label="Warehouse details"
          >
            i
          </button>
          {showInfo && (
            <div className="app__info-card">
              <div className="app__info-row">
                <span>Buildings</span>
                <span>{wallCount}</span>
              </div>
              <div className="app__info-row">
                <span>Slots</span>
                <span>{warehouse.slots.length}</span>
              </div>
              <div className="app__info-row">
                <span>Paths</span>
                <span>{warehouse.paths.length}</span>
              </div>
              <div className="app__info-row">
                <span>Doors</span>
                <span>{warehouse.doors.length}</span>
              </div>
              <div className="app__info-row">
                <span>Lift stations</span>
                <span>{warehouse.liftStations.length}</span>
              </div>
              <div className="app__info-row">
                <span>Delivery spaces</span>
                <span>{warehouse.deliverySpaces.length}</span>
              </div>
              <div className="app__info-row">
                <span>Picking lists</span>
                <span>{pickingLists.length}</span>
              </div>
              <div className="app__info-row">
                <span>Recorded runs</span>
                <span>{simulation.capturedRuns.length}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <nav className="app__tabs">
        {/* Overview doubles as the app menu: selecting the tab and opening
            the file/edit actions are the same click, the way a menu-bar item
            behaves. */}
        <div className="app__menu" ref={menuRef}>
          <button
            className={analytics.tab === "overview" ? "app__tab app__tab--active" : "app__tab"}
            onClick={() => {
              select("overview");
              setShowMenu((v) => !v);
            }}
            title="Warehouse view · file and edit actions"
          >
            Overview
            {dirty && <span className="app__tab-dot" title="Unsaved changes" />}
            <span className="app__tab-caret">▾</span>
          </button>

          {showMenu && (
            <div className="app__menu-list">
              {dirty && <div className="app__menu-note">● unsaved changes</div>}

              <button
                className="app__menu-item app__menu-item--sub"
                onClick={() => toggleSub("presets")}
                aria-expanded={openSub === "presets"}
              >
                Presets
                <span className="app__menu-caret">{openSub === "presets" ? "▾" : "▸"}</span>
              </button>
              {openSub === "presets" && (
                <div className="app__submenu">
                  {WAREHOUSE_PRESETS.map((preset) => {
                    const current = warehouse.id === preset.warehouseId;
                    return (
                      <button
                        key={preset.warehouseId}
                        className="app__menu-item app__subitem"
                        disabled={loadingPreset !== null}
                        onClick={() => void openPreset(preset)}
                        title={current ? `${preset.description} · on screen now` : preset.description}
                      >
                        <span className="app__subitem-check">{current ? "✓" : ""}</span>
                        <span className="app__subitem-text">
                          <span className="app__subitem-label">
                            {preset.label}
                            {loadingPreset === preset.warehouseId && " …"}
                          </span>
                          <span className="app__subitem-desc">{preset.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <button
                className="app__menu-item app__menu-item--sub"
                onClick={() => toggleSub("load")}
                aria-expanded={openSub === "load"}
              >
                Load
                <span className="app__menu-caret">{openSub === "load" ? "▾" : "▸"}</span>
              </button>
              {openSub === "load" && (
                <div className="app__submenu">
                  {loadItems.map((item) => (
                    <button
                      key={item.key}
                      className="app__menu-item app__subitem"
                      onClick={() => void item.run()}
                      title={item.description}
                    >
                      <span className="app__subitem-check" />
                      <span className="app__subitem-text">
                        <span className="app__subitem-label">{item.label}</span>
                        <span className="app__subitem-desc">{item.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <button
                className="app__menu-item"
                onClick={() => {
                  setShowMenu(false);
                  void save();
                }}
              >
                Save
              </button>
              <div className="app__menu-sep" />
              <button className="app__menu-item" onClick={toggleMode}>
                {mode === "edit" ? "Done editing" : "Edit layout…"}
              </button>
            </div>
          )}
        </div>
        <button
          className={analytics.tab === "performances" ? "app__tab app__tab--active" : "app__tab"}
          onClick={() => select("performances")}
          disabled={!hasSession || mode === "edit"}
          title={
            mode === "edit"
              ? "Leave edit mode to see performances"
              : hasSession
                ? "Time and throughput for the recorded session"
                : "Record a session first — arm Capture and play some lists"
          }
        >
          Performances
        </button>
      </nav>
    </header>
  );
}
