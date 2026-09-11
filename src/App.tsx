import { useRef } from "react";
import warehouseConfig from "../schema/warehouse.example.json";
import warehouseContent from "../schema/warehouse.content.example.json";
import type { WarehouseConfig, WarehouseContent } from "./types/warehouse";
import { mergeWarehouse } from "./lib/warehouseFiles";
import { EditorProvider, useEditor } from "./state/EditorContext";
import { ViewFocusProvider } from "./state/ViewFocusContext";
import { WarehouseScene } from "./components/WarehouseScene";
import { Toolbar } from "./components/Toolbar";
import { Inspector } from "./components/Inspector";
import { HistoryPanel } from "./components/HistoryPanel";
import { SelectionOverlay } from "./components/SelectionOverlay";
import { HoverCard } from "./components/HoverCard";
import { FacilityTooltip } from "./components/FacilityTooltip";
import { FocusBreadcrumb } from "./components/FocusBreadcrumb";
import "./App.css";

// First the warehouse configuration (layout) loads, then its content
// (inventory) — same two-file split as Toolbar's Load button (see
// src/lib/file.ts / src/lib/warehouseFiles.ts).
const initialWarehouse = mergeWarehouse(
  warehouseConfig as WarehouseConfig,
  warehouseContent as WarehouseContent,
);

function AppShell() {
  const { warehouse } = useEditor();
  const sceneRef = useRef<HTMLDivElement>(null);

  return (
    <div className="app">
      <header className="app__header">
        <h1>{warehouse.name}</h1>
        <p>
          {warehouse.walls.length} wall loop{warehouse.walls.length === 1 ? "" : "s"} ·{" "}
          {warehouse.slots.length} slots
        </p>
      </header>
      <Toolbar />
      <div className="app__scene" ref={sceneRef}>
        {/* Keyed on id so loading a different building remounts the scene
            (fresh camera framing); editing the current one does not. */}
        <WarehouseScene key={warehouse.id} />
        <Inspector />
        <HistoryPanel />
        <SelectionOverlay containerRef={sceneRef} />
        <HoverCard />
        <FacilityTooltip />
        <FocusBreadcrumb />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <EditorProvider initialWarehouse={initialWarehouse}>
      <ViewFocusProvider>
        <AppShell />
      </ViewFocusProvider>
    </EditorProvider>
  );
}
