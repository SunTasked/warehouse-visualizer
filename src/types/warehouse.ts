// Mirrors schema/warehouse.schema.json (config) and
// schema/warehouse.content.schema.json (content) — the physical asset layer
// (walls + slots) is split from its storage content across two files that
// are loaded/saved separately and merged in memory. See specs.md §5.1 for
// the format's rationale and conventions, and src/lib/warehouseFiles.ts for
// the merge/split functions.

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

/** Every slot's footprint, and how high each of its depth positions stacks. */
export interface SlotDefaults extends SlotSize {
  /** Pallet tiers per depth position, so a slot holds depth × levels pallets. Default DEFAULT_LEVELS (src/lib/stock.ts). */
  levels?: number;
}

/**
 * Storage hierarchy within a slot (see specs.md §5.1 "Storage subdivision"):
 *   Slot → Sub-slot → Pallet → Item
 * - Sub-slot: one of a slot's `depth` positions, each occupying a *full*
 *   slotDefaults-sized footprint of its own (a depth-3 slot spans 3x the
 *   standard footprint, front-to-back — not the standard footprint split
 *   three ways). Depth itself is config (a physical/structural property);
 *   which positions currently hold stock is content.
 * - Pallet: a unit load; multiple pallets stack vertically within one
 *   sub-slot (rack tiers/levels).
 * - Item: an individual unit stored on a pallet (e.g. a tire, currently
 *   always rendered at a fixed "tourism" size regardless of count), 1-10 per
 *   pallet.
 */
export interface Item {
  id: string;
}

export interface Pallet {
  id: string;
  /** 1-10 items. */
  items: Item[];
}

// ---------------------------------------------------------------------------
// Config: the physical layout file (walls, slot positions/footprints, and
// each slot's physical depth). Rarely changes — this is "the building".
// ---------------------------------------------------------------------------

/**
 * Physical circulation elements (see specs.md §5.1 "Doors, paths & the
 * carriage lift station"): openings, corridor markings, and a fixed-footprint
 * lift station. All config-authored for now (no interactive editor UI yet),
 * so `buildingId` is an explicit field here — unlike a slot's `buildingId`,
 * computed dynamically via point-in-polygon (src/lib/buildings.ts) — since a
 * door in particular sits *on* a wall boundary where that test is unreliable.
 */
export interface Door {
  id: string;
  x: number;
  y: number;
  /** Orientation along the wall it's set into, in degrees — same convention as SlotConfig.rotationDeg. */
  rotationDeg?: number;
  /** Opening width in meters. Default DOOR_DEFAULT_WIDTH (src/components/Doors.tsx). */
  width?: number;
  /** Which building's wall this door is cut into. */
  buildingId: string;
  /** Another building's id, if this door connects two buildings rather than leading outside. */
  leadsTo?: string;
}

/**
 * A named point of the corridor network: where corridors meet, where one
 * ends, where one passes through a door, or where one bends. Corridors list
 * junctions by id, so two corridors connect exactly when they name the same
 * junction — never because two coordinates happen to coincide (specs.md §5.1).
 * `buildingId` is the building it stands in; a junction outdoors (a bend in a
 * link between buildings) has none.
 */
export interface Junction {
  id: string;
  x: number;
  y: number;
  buildingId?: string;
}

/** One named corridor — aisle AA, 13A's central aisle, the link from 13A to 12B — as the junctions it runs through, in order. */
export interface Corridor {
  id: string;
  junctions: string[];
  /** Corridor width in meters. Default PATH_DEFAULT_WIDTH (src/components/Paths.tsx). */
  width?: number;
}

/**
 * Where a slot or facility joins the corridor network: `offset` meters along
 * `corridor`, measured from its first junction. Stated in the plan, so which
 * aisle serves a slot is something the plan says — and can be checked —
 * rather than something the router infers from geometry.
 */
export interface Access {
  corridor: string;
  offset: number;
}

/**
 * A corridor resolved for drawing and routing: its junctions' coordinates in
 * order. Derived from `junctions` and `corridors` (src/lib/corridors.ts), never
 * saved.
 */
export interface Path {
  id: string;
  /** Polyline, like an open WallLoop. */
  points: Point[];
  /** The junction at each point — what the routing graph and the path heatmap are keyed on. */
  junctionIds: string[];
  width?: number;
  /** The buildings its junctions stand in: usually one, two for a link between buildings. */
  buildingIds: string[];
  /**
   * Links between buildings only: which building owns `points[0]` and which
   * the last point. Lets Paths.tsx truncate the path to a short stub + arrow
   * at whichever end's building is currently focused, instead of drawing into
   * a building that's hidden at that focus level.
   */
  endpointBuildingIds?: [string, string];
}

/**
 * The corridor format before junctions: polylines that connected only where
 * two of them shared an exact coordinate. Still read, and converted on load
 * (src/lib/corridors.ts), so older plan files open; never written.
 */
export interface LegacyPath {
  id: string;
  points: Point[];
  width?: number;
  buildingIds: string[];
  endpointBuildingIds?: [string, string];
}

export interface LiftStation {
  id: string;
  x: number;
  y: number;
  rotationDeg?: number;
  buildingId: string;
  /** Where it joins the corridors. Without it, the router uses the nearest point on any corridor. */
  access?: Access;
}

/** Same footprint as LiftStation (6x2, see src/components/DeliverySpaces.tsx) — a separate concept, just sharing the same fixed-pad rendering. */
export interface DeliverySpace {
  id: string;
  x: number;
  y: number;
  rotationDeg?: number;
  buildingId: string;
  /** Where it joins the corridors. Without it, the router uses the nearest point on any corridor. */
  access?: Access;
}

/**
 * A floor area forklifts can't enter — a lithium store, a tugger-train lane,
 * a "Zone MU" — marked on the plan but holding no slots (specs.md §5.7).
 * Axis-aligned: (x, y) is its centre, `width` runs along X and `depth` along Y.
 * Corridors are laid out around it, so no route ever crosses it.
 */
export interface InaccessibleZone {
  id: string;
  /** What the plan calls it ("Lithium", "Zone MU", "Train"). */
  label: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  buildingId: string;
}

export interface SlotConfig {
  id: string;
  /**
   * Center point when depth is 1. With depth > 1, (x, y) instead anchors the
   * frontmost (depth position 0) sub-slot's footprint specifically —
   * additional sub-slots extend the footprint outward from there, so a
   * slot's depth-1 corner never moves as its depth changes.
   */
  x: number;
  y: number;
  /** Counter-clockwise rotation around the center point, in degrees. Default 0. */
  rotationDeg?: number;
  /**
   * Number of sub-slot depth positions (front-to-back), each occupying its
   * own full slotDefaults footprint. Default 1 (no depth subdivision).
   */
  depth?: number;
  /** The corridor the slot is worked from. Without it, the router uses the nearest corridor in front of the slot. */
  access?: Access;
}

export interface WarehouseConfig {
  id: string;
  name: string;
  units: "m";
  walls: WallLoop[];
  /** Optional — absent in files predating this addition, treated as empty. */
  doors?: Door[];
  /** The corridor network's named points. */
  junctions?: Junction[];
  corridors?: Corridor[];
  /** Legacy corridor format, read only when `corridors` is absent. */
  paths?: LegacyPath[];
  liftStations?: LiftStation[];
  deliverySpaces?: DeliverySpace[];
  /** Optional — absent in files predating this addition, treated as empty. */
  inaccessibleZones?: InaccessibleZone[];
  slotDefaults: SlotDefaults;
  slots: SlotConfig[];
}

// ---------------------------------------------------------------------------
// Content: the inventory file (what's actually stocked, per slot/sub-slot).
// Changes constantly — this is "what's on the shelves right now". A slot
// absent from `slots`, or a sub-slot with no pallets, is simply empty.
// ---------------------------------------------------------------------------

export interface SubSlotContent {
  /** Stacked bottom-to-top; pallets[0] is the lowest tier. */
  pallets: Pallet[];
}

export interface SlotContent {
  /** References a WarehouseConfig slot id. */
  slotId: string;
  /** One entry per depth position (see SlotConfig.depth), front-to-back. */
  subSlots: SubSlotContent[];
}

export interface WarehouseContent {
  /** References the WarehouseConfig this content belongs to (its id). */
  warehouseId: string;
  slots: SlotContent[];
}

// ---------------------------------------------------------------------------
// Runtime: the merged, in-memory shape everything else in the app (rendering,
// editing, the view-mode drill-down) works with — config and content combined
// via mergeWarehouse(), split back apart via splitWarehouse() on save. See
// src/lib/warehouseFiles.ts.
// ---------------------------------------------------------------------------

export interface SubSlot {
  id: string;
  /** Stacked bottom-to-top; pallets[0] is the lowest tier. */
  pallets: Pallet[];
}

export interface Slot {
  id: string;
  x: number;
  y: number;
  rotationDeg?: number;
  /**
   * Depth subdivision of the slot's footprint (front-to-back). Depth =
   * subSlots.length. Undefined = depth 1, no storage detail merged in.
   */
  subSlots?: SubSlot[];
  access?: Access;
}

export interface Warehouse {
  id: string;
  name: string;
  units: "m";
  walls: WallLoop[];
  doors: Door[];
  junctions: Junction[];
  corridors: Corridor[];
  /** The corridors resolved to polylines — derived from `junctions` and `corridors`, for drawing and routing. */
  paths: Path[];
  liftStations: LiftStation[];
  deliverySpaces: DeliverySpace[];
  inaccessibleZones: InaccessibleZone[];
  slotDefaults: SlotDefaults;
  slots: Slot[];
}
