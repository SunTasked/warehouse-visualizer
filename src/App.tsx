import { useRef } from "react";
import warehouseConfig from "../schema/warehouse.example.json";
import warehouseContent from "../schema/warehouse.content.example.json";
import warehousePickingLists from "../schema/warehouse.picking-lists.example.json";
import type { WarehouseConfig, WarehouseContent } from "./types/warehouse";
import type { PickingListsFile } from "./types/simulation";
import { mergeWarehouse } from "./lib/warehouseFiles";
import { EditorProvider, useEditor } from "./state/EditorContext";
import { ViewFocusProvider } from "./state/ViewFocusContext";
import { SimulationProvider } from "./state/SimulationContext";
import { WarehouseScene } from "./components/WarehouseScene";
import { Toolbar } from "./components/Toolbar";
import { Inspector } from "./components/Inspector";
import { HistoryPanel } from "./components/HistoryPanel";
import { SelectionOverlay } from "./components/SelectionOverlay";
import { HoverCard } from "./components/HoverCard";
import { FacilityTooltip } from "./components/FacilityTooltip";
import { FocusBreadcrumb } from "./components/FocusBreadcrumb";
import { PickingListPanel } from "./components/PickingListPanel";
import { RunConsole } from "./components/RunConsole";
import { UsageLegend } from "./components/UsageLegend";
import { LayerPanel } from "./components/LayerPanel";
import { LayerProvider } from "./state/LayerContext";
import { AnalyticsProvider } from "./state/AnalyticsContext";
import { AnalyticsBoard } from "./components/analytics/AnalyticsBoard";
import { AppHeader } from "./components/AppHeader";
import { useAnalytics } from "./state/AnalyticsContext";
import "./App.css";

// The Test plant preset, imported statically so the first paint already has a
// warehouse: its plan, its content (inventory) and its picking lists — the
// same three files Overview → Load reads one at a time (src/lib/file.ts,
// src/lib/warehouseFiles.ts) and a preset bundles (src/data/presets.ts).
const initialWarehouse = mergeWarehouse(
  warehouseConfig as WarehouseConfig,
  warehouseContent as WarehouseContent,
);
const initialPickingLists = (warehousePickingLists as unknown as PickingListsFile).lists;

function AppShell() {
  const { warehouse } = useEditor();
  const { tab } = useAnalytics();
  const sceneRef = useRef<HTMLDivElement>(null);

  // The scene stays mounted while the Performances tab is up, just hidden:
  // remounting it would throw away the camera and re-frame the warehouse
  // every time you glance at the numbers and come back.
  return (
    <div className="app">
      <AppHeader />
      <Toolbar />
      <AnalyticsBoard />
      <div className="app__scene" ref={sceneRef} hidden={tab === "performances"}>
        {/* Keyed on id so loading a different building remounts the scene
            (fresh camera framing); editing the current one does not. */}
        <WarehouseScene key={warehouse.id} />
        <Inspector />
        <HistoryPanel />
        <SelectionOverlay containerRef={sceneRef} />
        <HoverCard />
        <FacilityTooltip />
        {/* Docks: panels that share an edge stack in one column so neither
            has to be positioned around the other's height. */}
        <div className="app__dock app__dock--tl">
          <FocusBreadcrumb />
          <RunConsole />
        </div>
        {/* The right edge is a single column: the picking lists take
            whatever height the legend and layer panel leave and scroll
            inside it, rather than running underneath them — a plant with
            more lists otherwise buried "Reset warehouse" under the layers. */}
        <div className="app__dock app__dock--right">
          <PickingListPanel />
          <div className="app__dock-bottom">
            <UsageLegend />
            <LayerPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <EditorProvider initialWarehouse={initialWarehouse} initialPickingLists={initialPickingLists}>
      <ViewFocusProvider>
        <SimulationProvider>
          <LayerProvider>
            <AnalyticsProvider>
              <AppShell />
            </AnalyticsProvider>
          </LayerProvider>
        </SimulationProvider>
      </ViewFocusProvider>
    </EditorProvider>
  );
}
