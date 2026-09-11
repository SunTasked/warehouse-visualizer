import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Which slice of the digital twin each layer draws (specs.md §5.4). Layers are
 * split by *subject* — what the data is — rather than by render style, so
 * "colors" and "numbers" for the same measurement aren't separate toggles
 * (you'd rarely want counts with no coloring); numeric labelling is a display
 * option applied to whichever heatmaps are on, see `labelCounts` below.
 *
 * Order here is the order the panel lists them: physical shell first, then
 * what's stored in it, then movement over it, then measurements of that
 * movement.
 */
export const LAYER_IDS = [
  "structure",
  "storage",
  "facilities",
  "paths",
  "route",
  "pathHeatmap",
  "slotHeatmap",
] as const;

export type LayerId = (typeof LAYER_IDS)[number];

export const LAYER_LABELS: Record<LayerId, { label: string; hint: string }> = {
  structure: { label: "Structure", hint: "Walls and doors" },
  storage: { label: "Storage", hint: "Slots, racks and pallets" },
  facilities: { label: "Facilities", hint: "Lift station, delivery spaces" },
  paths: { label: "Paths", hint: "The corridor network" },
  route: { label: "Route", hint: "Active picking run and forklift" },
  pathHeatmap: { label: "Path heatmap", hint: "Captured traffic, per direction" },
  slotHeatmap: { label: "Slot heatmap", hint: "Captured picks and stores per slot" },
};

// Everything physical on, measurements off: the default view answers "what is
// this warehouse" — a heatmap answers a question the user has to ask first,
// and (before any capture) would render as nothing anyway.
const DEFAULT_VISIBILITY: Record<LayerId, boolean> = {
  structure: true,
  storage: true,
  facilities: true,
  paths: true,
  route: true,
  pathHeatmap: false,
  slotHeatmap: false,
};

interface LayerContextValue {
  visible: Record<LayerId, boolean>;
  isVisible: (id: LayerId) => boolean;
  toggle: (id: LayerId) => void;
  /** Draws each heatmap's own counts as text alongside its coloring — applies to every heatmap layer that's currently on, rather than being a layer of its own. */
  labelCounts: boolean;
  setLabelCounts: (value: boolean) => void;
}

const LayerContext = createContext<LayerContextValue | null>(null);

export function LayerProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState<Record<LayerId, boolean>>(DEFAULT_VISIBILITY);
  const [labelCounts, setLabelCounts] = useState(false);

  const toggle = useCallback((id: LayerId) => {
    setVisible((current) => ({ ...current, [id]: !current[id] }));
  }, []);

  const isVisible = useCallback((id: LayerId) => visible[id], [visible]);

  const value = useMemo<LayerContextValue>(
    () => ({ visible, isVisible, toggle, labelCounts, setLabelCounts }),
    [visible, isVisible, toggle, labelCounts],
  );

  return <LayerContext.Provider value={value}>{children}</LayerContext.Provider>;
}

export function useLayers(): LayerContextValue {
  const ctx = useContext(LayerContext);
  if (!ctx) throw new Error("useLayers must be used within a LayerProvider");
  return ctx;
}
