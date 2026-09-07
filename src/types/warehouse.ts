// Mirrors schema/warehouse.schema.json — the physical asset layer (walls + slots).
// See specs.md §5.1 for the format's rationale and conventions.

export interface Point {
  x: number;
  y: number;
}

export interface WallLoop {
  id: string;
  closed: boolean;
  points: Point[];
}

export interface SlotSize {
  width: number;
  height: number;
}

export interface Slot {
  id: string;
  x: number;
  y: number;
  /** Counter-clockwise rotation around the center point, in degrees. Default 0. */
  rotationDeg?: number;
}

export interface Warehouse {
  id: string;
  name: string;
  units: "m";
  walls: WallLoop[];
  slotDefaults: SlotSize;
  slots: Slot[];
}
