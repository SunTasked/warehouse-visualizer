import warehouseData from "../schema/warehouse.example.json";
import type { Warehouse } from "./types/warehouse";
import { EditorProvider, useEditor } from "./state/EditorContext";
import { WarehouseScene } from "./components/WarehouseScene";
import { Toolbar } from "./components/Toolbar";
import { Inspector } from "./components/Inspector";
import "./App.css";

const initialWarehouse = warehouseData as Warehouse;

function AppShell() {
  const { warehouse } = useEditor();

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
      <div className="app__scene">
        {/* Keyed on id so loading a different building remounts the scene
            (fresh camera framing); editing the current one does not. */}
        <WarehouseScene key={warehouse.id} />
        <Inspector />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <EditorProvider initialWarehouse={initialWarehouse}>
      <AppShell />
    </EditorProvider>
  );
}
