import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ScorableRun } from "../lib/metrics";
import { DEFAULT_TIME_MODEL, type TimeModelSettings } from "../lib/timeModel";

const STORAGE_KEY = "warehouse-opti.analytics.v1";

/**
 * A capture frozen for comparison (specs.md §5.5). Stores the runs in their
 * scorable form rather than the metrics themselves, so a snapshot taken
 * before a settings change is re-scored under the *new* settings alongside
 * the current capture — otherwise every comparison would silently mix two
 * different time models and the deltas would be meaningless.
 */
export interface AnalyticsSnapshot {
  id: string;
  name: string;
  at: number;
  /** What the warehouse looked like when this was taken, for labelling the comparison. */
  warehouseName: string;
  slotCount: number;
  runs: ScorableRun[];
}

interface StoredState {
  settings: TimeModelSettings;
  snapshots: AnalyticsSnapshot[];
}

function load(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { settings: DEFAULT_TIME_MODEL, snapshots: [] };
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return {
      // Merged over the defaults so a stored blob written by an older build,
      // missing a parameter added since, still loads.
      settings: { ...DEFAULT_TIME_MODEL, ...(parsed.settings ?? {}) },
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
    };
  } catch {
    return { settings: DEFAULT_TIME_MODEL, snapshots: [] };
  }
}

interface AnalyticsContextValue {
  settings: TimeModelSettings;
  setSetting: (key: keyof TimeModelSettings, value: number) => void;
  resetSettings: () => void;
  snapshots: AnalyticsSnapshot[];
  saveSnapshot: (snapshot: Omit<AnalyticsSnapshot, "id" | "at">) => void;
  removeSnapshot: (id: string) => void;
  /** Which top-level tab is showing (specs.md §5.6) — the board is a view of the app, not an overlay on the scene. */
  tab: "overview" | "performances";
  setTab: (value: "overview" | "performances") => void;
  /** Drops snapshots along with everything else — entering edit mode invalidates them, since their runs were routed over a layout that is about to change. */
  clearAll: () => void;
}

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StoredState>(load);
  const [tab, setTab] = useState<"overview" | "performances">("overview");

  // Settings and snapshots outlive a reload on purpose: comparing
  // configurations often means loading a different warehouse file, which
  // remounts everything else.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Private windows and blocked site data just lose persistence.
    }
  }, [state]);

  const setSetting = useCallback((key: keyof TimeModelSettings, value: number) => {
    setState((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  }, []);

  const resetSettings = useCallback(() => {
    setState((current) => ({ ...current, settings: DEFAULT_TIME_MODEL }));
  }, []);

  const saveSnapshot = useCallback((snapshot: Omit<AnalyticsSnapshot, "id" | "at">) => {
    setState((current) => ({
      ...current,
      snapshots: [...current.snapshots, { ...snapshot, id: `snap-${Date.now()}`, at: Date.now() }],
    }));
  }, []);

  const removeSnapshot = useCallback((id: string) => {
    setState((current) => ({ ...current, snapshots: current.snapshots.filter((s) => s.id !== id) }));
  }, []);

  const clearAll = useCallback(() => {
    setState((current) => ({ ...current, snapshots: [] }));
    setTab("overview");
  }, []);

  const value = useMemo<AnalyticsContextValue>(
    () => ({
      settings: state.settings,
      setSetting,
      resetSettings,
      snapshots: state.snapshots,
      saveSnapshot,
      removeSnapshot,
      tab,
      setTab,
      clearAll,
    }),
    [state, setSetting, resetSettings, saveSnapshot, removeSnapshot, tab, clearAll],
  );

  return <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>;
}

export function useAnalytics(): AnalyticsContextValue {
  const ctx = useContext(AnalyticsContext);
  if (!ctx) throw new Error("useAnalytics must be used within an AnalyticsProvider");
  return ctx;
}
