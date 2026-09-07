import warehouseData from "../schema/warehouse.example.json";
import type { Warehouse } from "./types/warehouse";
import { WarehouseScene } from "./components/WarehouseScene";
import "./App.css";

const warehouse = warehouseData as Warehouse;

export default function App() {
  return (
    <div className="app">
      <header className="app__header">
        <h1>{warehouse.name}</h1>
        <p>
          {warehouse.walls.length} wall loop{warehouse.walls.length === 1 ? "" : "s"} ·{" "}
          {warehouse.slots.length} slots · source: schema/warehouse.example.json
        </p>
      </header>
      <div className="app__scene">
        <WarehouseScene warehouse={warehouse} />
      </div>
    </div>
  );
}
