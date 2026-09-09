import { useRef } from "react";
import warehouseData from "../schema/warehouse.example.json";
import type { Warehouse } from "./types/warehouse";
import { EditorProvider, useEditor } from "./state/EditorContext";
import { ViewFocusProvider } from "./state/ViewFocusContext";
import { WarehouseScene } from "./components/WarehouseScene";
import { Toolbar } from "./components/Toolbar";
import { Inspector } from "./components/Inspector";
import { HistoryPanel } from "./components/HistoryPanel";
import { SelectionOverlay } from "./components/SelectionOverlay";
import { HoverCard } from "./components/HoverCard";
import "./App.css";

const initialWarehouse = warehouseData as Warehouse;

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
