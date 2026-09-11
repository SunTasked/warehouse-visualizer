# Context Log

Chronological session log, maintained by the `context-keeper` agent. Newest entries at the
top. This is a log of what happened each session — the current-state snapshot lives in
`specs.md`.

## 2026-09-11 (cont'd) — forklift simulation follow-up: transport bar, lanes, occlusion

- User feedback on the just-shipped forklift simulation, six items with screenshots: (1)
  forgot to mention the forklift always starts at the lift station; (2) wants a
  music-player-style transport widget (play/pause, stop, next/previous step, a slider
  where each tick is a step); (3) the route should show direction arrows; (4) two
  opposite directions on the same path shouldn't visually merge; (5) step numbers should
  render above everything else; (6) slot labels get hidden again once pallets are on the
  slot.
- **Always start at the lift station**: `SimulationContext.tsx`'s new `stopsWithDepot()`
  prepends the warehouse's first `LiftStation` as an extra depot stop ahead of the list's
  own `stops`, computed once per run rather than requiring every test list to spell it
  out. The prepended stop needed no special-casing — it's just an ordinary depot stop
  under the existing pick/store/deliver/load event logic (a picking run's first
  "deliver" is a no-op since nothing is held yet).
- **Transport bar**: replaced the single `advanceLeg()` with one general `goToStep(target)`
  that both the vehicle's natural per-frame leg completion and the panel's
  Next/Previous/slider controls call. Moving forward applies every leg's arrival event
  along the way (real simulation progress, even when the slider skips several stops at
  once); moving backward only repositions the displayed vehicle, without undoing any
  already-applied mutation — flagged as a known limitation (no general "undo this exact
  pallet pick" exists) rather than silently pretending otherwise. Added `isPaused` to the
  active run, gating whether `Vehicle`'s `useFrame` advances `progressRef`, so Pause
  truly freezes in place and Resume continues from exactly there.
- **Direction arrows + lane separation**: `Forklift.tsx`'s new `offsetPolyline()` shifts
  every point of a leg's route a fixed distance perpendicular to its own local travel
  direction, always to the same side ("right of travel"). This one rule — no explicit
  overlap detection — is enough to separate two legs riding the same physical corridor
  in opposite directions into two parallel lanes, since "right of travel" for one
  direction is "left of travel" for its reverse. Periodic yellow cone arrows placed
  along each offset lane show the direction of travel; the vehicle itself now rides the
  offset lane too, not the raw centerline, for visual consistency.
- **Always-on-top labels**: both the forklift route's numbered stop markers and (back in
  `Slots.tsx`) a slot's own id label now render with `material-depthTest={false}` — the
  same fix for two separate but related occlusion complaints: a stop number could hide
  behind a tall pallet stack or another lane, and (after last round's fix moved the id
  label onto the entry marker) a *multi-tier* rack standing on that same slot could still
  hide the label itself.
- Verified via Playwright at a larger viewport (for finer visual inspection): the route
  now visibly starts from the lift station with stop "1"; a corridor traveled in both
  directions (a picking list revisiting the delivery point) renders as two distinct
  offset lanes with opposing arrows, not one merged line; stop numbers stay legible over
  tall pallet stacks and the mustard/purple facility pads; a slot's id label stays
  legible even with a full 3-tier stack directly behind it; the full transport bar (Play/
  Pause, Next, Previous, Stop, slider) all correctly drive the same underlying step state,
  including a slider drag that fast-forwards through several stops' mutations at once;
  edit mode unaffected, overlay still doesn't leak into it. `tsc --noEmit` clean
  throughout.
- specs.md updated: §5.3 rewritten for the depot-prepend/transport-bar/lane-offset
  design, §5.1's entry-marker paragraph updated for the label depthTest fix, a new open
  question (backward-stepping doesn't undo mutations), new decision log entry.

## 2026-09-11 (cont'd) — forklift picking-list simulation (major new feature)

- User request: "warehouse management" — simulate the warehouse's life via a forklift
  either **picking** (slots → delivery) or **storing** (delivery → slots), following
  a picking list (an ordered slot/depot sequence) with real constraints (max 3 pallets,
  must follow a path, must respect the given stop order); pathfinding between stops
  should be the quickest route, computed, not authored; a picking list's pallet must
  actually disappear from its slot when picked (and appear when stored); test picking
  lists (including one spanning both buildings) should come from an overlay menu, playable
  singly or queued; "playing" a list should show the forklift's route on the floor.
- Per the user's own explicit instruction, asked 4 clarifying questions before designing
  anything (playback scope, storing-list format, slot↔path connection precision,
  forklift count) — all four materially changed the architecture; answers are recorded
  verbatim in specs.md §5.3's opening and drove every subsequent design call.
- Used plan mode given the size (new pathfinding engine, new state/rendering/UI layers).
  Built `src/lib/pathGraph.ts`: `buildPathGraph()` dedupes every `Path`'s points into a
  node/edge graph (safe with no fuzzy matching thanks to the pre-existing "exact
  coincident point" convention); `connectPoint()` projects an arbitrary point onto the
  *nearest point along any edge*, not just onto nodes (using only nodes would route a
  slot to the nearest aisle *end*, sending every slot down a long aisle through the same
  corner); `routeBetween()` runs Dijkstra (not literal BFS as suggested — segments have
  unequal real lengths, so only Dijkstra actually minimizes travel distance) and returns
  `[from, ...network..., to]` — using the *exact* slot/facility point as `from`/`to`
  (not the snapped network point) means the polyline naturally notches into the slot,
  exactly the visual the user asked for, with no extra mechanism needed.
- `src/types/simulation.ts` + `src/data/pickingLists.ts`: five test lists — a simple
  pick, the user's own multi-trip/capacity-chaining example verbatim, a cross-building
  pick, a storing run, and a cross-building storing run.
- `src/state/SimulationContext.tsx`: the core state machine. `planEvents()` derives what
  each stop does (pick/store/deliver/load) from the list's explicit `mode` field;
  `EditorContext.tsx` gained `pickPalletAuto` (mirrors `addPalletAuto`'s deepest-first
  fill, in reverse — front-to-back sub-slot scan, topmost pallet). Playback progress for
  the animated mode lives in a `useRef`, not React state, so the vehicle doesn't trigger
  a re-render every frame; a `playNextRef` "always latest" ref pattern avoids a subtle
  staleness bug where a `setTimeout`-deferred queue-continuation (added so consecutive
  *static* runs are each actually visible, not just the last one) would otherwise close
  over pre-mutation warehouse state.
- `src/components/Forklift.tsx`: route highlight reuses `Paths.tsx`'s `segmentsForPath`
  (exported, parameterized on height, rather than duplicated) in an orange accent with
  numbered stop markers; the vehicle is a simple box + directional cone driven by
  `useFrame`, advancing `progressRef` and calling back into the context on reaching each
  leg's end. `src/components/PickingListPanel.tsx` (new Toolbar toggle, mirroring the
  `History` pattern) exposes per-list Play, "Play selected"/"Play all" queuing, the
  Animated/Static toggle, and a speed field.
- Found and fixed one real bug during verification: the route/vehicle overlay was
  rendering (and, worse, silently continuing to animate) even in edit mode, since
  `Forklift.tsx` had no mode gate at all. Fixed by gating the whole component on
  `mode === "view"` — unmounting (not just hiding) also correctly *pauses* an
  in-progress animated run's clock while edit mode is active, rather than letting it
  keep ticking in the background unseen.
- Verified via Playwright: static playback highlights the full route and applies
  inventory changes immediately (A02: 3→2 pallets after "Quick pick"; A05: 0→1 after
  "Restock"); animated playback shows the vehicle actually traveling leg by leg (speed
  bumped up during testing to keep runs short); the cross-building list's route
  correctly spans both buildings without truncation; "Play selected" with two lists
  chains them in sequence with a visible pause between static runs; edit mode
  (Inspector, slot selection, wall handles) unaffected, and the overlay no longer leaks
  into it. `tsc --noEmit` clean throughout.
- specs.md updated: new §5.3 (full design write-up), two new open-questions bullets
  (future multi-forklift rules; no picking-list validation), new decision log entry.

## 2026-09-11 (cont'd) — slot label redesign + a real click-handler regression found

- User feedback (English, with a screenshot): slot labels (e.g. "A04") are no longer
  readable, hidden behind a Path running through the aisle just past the slot's entry
  edge. Suggested enlarging the green entry-marker area to fit the label on it.
- Moved the id label from outside the slot's footprint onto the entry marker itself
  (`Slots.tsx`): enlarged `ENTRY_MARKER_DEPTH` (0.25m → 0.6m) so it comfortably holds the
  label, added a shared `entryMarkerCenterZ()` helper so the label always centers on the
  marker regardless of its depth, changed label color to black (was dark navy, tuned for
  the white floor). Deliberately moved the label *inward* rather than just raising its Y
  elevation to clear the path — a Path is only ever authored through open aisle space
  (never a slot's own footprint, per the routing work), so this sidesteps the whole
  category of problem for good, not just today's specific aisle width.
- While verifying this, found a real, previously-undetected regression: clicking a slot
  **directly from "plant"** (skipping "warehouse") was landing on "warehouse" instead of
  drilling to "slot". Traced it with temporary console logging in `Slots.tsx`/`Rack.tsx`/
  `Walls.tsx`: the slot's `onPointerDown` handler fired first (mutating focus to
  "slot"), and then, a few milliseconds later, the browser's separate "click" event
  re-raycast the scene and hit `BuildingFloor` underneath (still mounted at that instant,
  since React hadn't yet flushed the unmount) — its `onClick` handler ran and silently
  overwrote the slot selection with a "warehouse"-level one. This is the *same* category
  of bug already fixed for `BuildingFloor` itself yesterday, just from the other
  direction: mixing `onPointerDown` and `onClick` across *competing* handlers means
  whichever event type fires later in the pointerdown→pointerup→click sequence always
  wins, regardless of which object the raycast actually preferred.
- Fixed by moving every remaining "select/focus" handler in the view-mode system to
  `onClick`: `Slots.tsx` (slot click split into a new `onClick` for view-mode selection
  vs. `onPointerDown` kept only for edit-mode drag-start; sub-slot click), `Rack.tsx`
  (pallet click), `Walls.tsx` (wall segment click). `onPointerDown` is now reserved
  exclusively for actually starting an edit-mode drag gesture, never for a one-shot
  selection action, anywhere in the codebase.
- Verified via Playwright: direct slot click from plant now correctly reaches "Slot:
  A01"; sub-slot and pallet drill-down still work; wall click, floor click, and facility
  pad click-passthrough all still work; edit mode (Inspector, slot selection, wall-corner
  drag) unaffected. `tsc --noEmit` clean throughout; all temporary debug logging removed
  before committing.
- specs.md updated: the entry-marker/label paragraph rewritten, a new paragraph in the
  view-mode section explaining why `onClick` vs `onPointerDown` is load-bearing (not a
  style choice), and a new decision log entry.

## 2026-09-11 — path visual polish, floor-click bug, facility tooltips

- User feedback (French, with a screenshot) on the previous round's work, three items:
  (1) clicking a warehouse's open floor selects it then immediately deselects again;
  (2) paths look wrong at turns (square notches instead of a clean joint) — wants
  rounded corners, and wants paths repainted black; (3) add a hover tooltip on the lift
  station/delivery space pads explaining what they are.
- **Floor click bug**: root-caused via the pointerdown→click→onPointerMissed sequence —
  `BuildingFloor`'s click handler was on `onPointerDown`, which mutates `focus.level`
  away from `"plant"` before the browser's own "click" event fires; since
  `BuildingFloor` is only rendered at `"plant"`, it unmounts in between, so the click's
  own re-raycast (a fresh one, not a reuse of pointerdown's hit) finds nothing there and
  the Canvas's `onPointerMissed` fires `back()` — select, then immediate un-select.
  Fixed by moving the handler to `onClick` (the terminal event in that sequence, so
  nothing raycasts again afterward to miss). Verified via Playwright: floor-clicking
  both the main building and the annex now stays focused.
- **Path rendering**: `PATH_COLOR` changed to black; added a flat cylinder joint
  (radius = half the path's width) at every vertex in `Paths.tsx`, so a turn reads as a
  smooth rounded corner instead of the notch left where two perpendicular-cut box
  segments meet at an angle (skipped at a truncated path's arrow-capped tip, to avoid
  overlapping the cone).
- **Facility tooltips**: `FacilityPad`'s solid box is now raycastable in view mode (it
  wasn't before, like every other physical-layer decoration) so it can show an HTML
  tooltip on hover (new `FacilityTooltip.tsx`, mirroring `HoverCard.tsx`; `HoverPoint`
  gained an optional `facility: {id, description}`). Caught a correctness wrinkle before
  it shipped: once a mesh is raycastable, being *hit* alone (even with no handler)
  suppresses `onPointerMissed`, so a bare hover-only pad would have silently swallowed
  clicks that used to fall through it to the building floor/back() beneath. Fixed by
  giving `FacilityPad` an explicit click handler that replicates that passthrough:
  `focusWarehouse` at "plant" (matching the floor), `back()` otherwise (matching empty
  floor) — verified via Playwright that clicking CL01 at "plant" focuses the building,
  and clicking it again at "warehouse" level backs out to "plant".
- Verified via Playwright throughout; edit mode (Inspector, slot selection, wall-corner
  handles) unaffected. `tsc --noEmit` clean.
- specs.md updated (§5.1 rendering/floor-click/facility paragraphs revised, new decision
  log entry).

## 2026-09-10 (cont'd — path routing, wall openings, delivery space, cross-building link)

- User follow-up (English, with an annotated screenshot of the previous round's plant
  view) — six items, plus an explicit ask to keep the data shape pathfinding-friendly for
  a stated next step (chariot routing/BFS between slots): (1) paths were cutting straight
  through slot/lift-station geometry, reroute around it; (2) punch an actual hole in the
  wall at each door; (3) add a "delivery space" element, same 6x2 footprint as the lift
  station, yellow; (4) move the annex building beneath the main one (3m gap), add a door
  facing the main building's south door, connect them with a path; (5) make a building's
  floor (not just its wall) clickable at "plant" level, and truncate+arrow any path that
  would otherwise run into a now-hidden building; (6) the slot hover tooltip was missing
  a Height row.
- Used plan mode again given the scope (schema shape change, wall-gap geometry, a new
  cross-building visibility case). Key design calls: `Path.buildingId` became
  `buildingIds: string[]` (a path can now touch two buildings) with an optional
  `endpointBuildingIds: [string, string]` for the one connector that does, used by
  `Paths.tsx`'s truncation logic; `DeliverySpace` is its own type/component (matching the
  user's "a new warehouse element" framing) but shares box+edges+label rendering with
  `LiftStation` via a new `src/components/FacilityPad.tsx`.
- **Graph-readiness convention**, documented (not enforced) in `src/types/warehouse.ts`'s
  `Path` doc comment and specs.md: any point shared between two paths, or between a path
  and a door, must be an *exact* coincident coordinate, not just a visual overlap — so a
  future graph-extraction step can dedupe points into node ids and turn each path's
  consecutive points into edges mechanically. Redesigned the whole example corridor
  network around this rule (explicit tee/junction points at (24,13), (10,6), (10,-3),
  etc.) rather than leaving it implicit.
- `Walls.tsx` grew substantially: `segmentsForEdge` now splits a wall edge around any door
  projected onto its line (collinearity + projection-along-edge check), leaving an actual
  gap instead of a decorative marker on an unbroken wall; a new `BuildingFloor` per closed
  loop (a `THREE.Shape` built directly from the loop's own (x,y) points, `rotateX(-Math.PI/2)`
  mapping local (x,y,0) to world (x,0,-y) with no separate coordinate conversion needed)
  makes the whole floor clickable/hoverable at "plant" level, reusing the exact hover
  state and click routing a wall segment already had.
- Found and fixed a real bug while wiring the floor click-catcher in: `Slots.tsx`'s hover
  handlers never called `e.stopPropagation()` — harmless before (nothing sat beneath a
  slot), but once the floor catcher existed underneath, a slot hover's `setHover` call
  kept propagating down and the floor's own `setHover(buildingId)` silently overwrote it
  on every mouse-move, so the slot's hover card/highlight never showed. Caught via
  Playwright (hovering a slot lit up the building's wall instead of showing the tooltip)
  and fixed by stopping propagation, matching every other hover handler in the codebase.
- Also caught (same Playwright pass) that centering a path exactly on an obstacle's edge
  coordinate still overlaps it by half the path's own width — not zero, as first assumed
  — via a cropped screenshot showing the corridor cutting into the N block's leftmost
  column; fixed by offsetting the jog and the annex's internal aisle by a full path-width
  margin instead of sitting exactly on the obstacle's boundary coordinate.
- Reworked `scripts/generate-example-warehouse.js`: rerouted every path to run through
  clear floor only (verified via cropped screenshots); added `DS01` (delivery space) next
  to `CL01`, with a 2m gap between their footprints that the service corridor's
  north-south drop deliberately runs through; moved "Entrepot Annexe" to sit 3m south of
  the main building (translating its C01-C03 slots by the same offset), added
  `Door-Annex-North` facing the main building's `Door-South`, and added a `Path-Bridge`
  connector between them with `endpointBuildingIds` set.
- Verified via Playwright: wall gaps render at both doors and the bridge crossing; the
  corridor network no longer overlaps any slot/lift-station/delivery-space footprint;
  clicking open floor (not a wall) at "plant" level focuses the right building; the
  bridge path shows only a stub + arrow pointing toward the hidden building once either
  side is focused, mirrored correctly in both directions; the slot hover tooltip now
  shows Height; edit mode (Inspector, slot selection, wall-corner handles) unaffected.
  `tsc --noEmit` clean throughout.
- specs.md updated (§5.1 rewritten for the new shape/behavior, new decision log entry,
  open-questions bullets updated/added).

## 2026-09-10 (cont'd — doors, paths, carriage lift station)

- User request (English, with an annotated screenshot): add three new physical/
  circulation elements — doors (wall openings to the exterior or another building),
  paths (corridors connecting slot entry points), and a carriage lift station (a fixed
  6x2m purple rectangle, connected to a path).
- Used plan mode given the schema/design decisions involved. Key call: these are literal
  physical/visual objects (like walls), not the abstract simulation node/edge graph
  already sketched in specs.md §5.2 (which models routing with direction/capacity and is
  explicitly future work) — kept them simple and separate from that.
- Added `Door`/`Path`/`LiftStation` types (`src/types/warehouse.ts`), optional arrays on
  `WarehouseConfig` (old files load unchanged), required arrays on the merged
  `Warehouse` type; `mergeWarehouse`/`splitWarehouse` (`src/lib/warehouseFiles.ts`) carry
  them straight through; `schema/warehouse.schema.json` bumped to "v3" with new
  `door`/`path`/`liftStation` definitions.
- Design choice: each carries an explicit, required `buildingId` rather than a
  dynamically-computed one (unlike a slot's `findBuildingForSlot`) — they're
  config-authored only for now (no drag editing), and a door sits right on a wall
  boundary where point-in-polygon is unreliable. Plugs straight into the existing
  `isBuildingVisible` used for the plant/warehouse drill-down.
- New `src/components/Doors.tsx`/`Paths.tsx`/`LiftStations.tsx`: a green rectangle (door,
  matching the slot entry marker's "access point" green), a chain of thin flat boxes
  between path points (reusing `Walls.tsx`'s segment length/angle math), and a purple
  labeled pad (lift station, mirroring the slot pad+edges+label pattern). All three opt
  out of raycasting (`raycast={() => null}`) so they stay non-interactive and don't block
  the existing click-empty-floor `back()` behavior — deliberately, since interactive
  editing for these isn't built yet.
- Reworked `scripts/generate-example-warehouse.js`: added to the main building only (two
  exterior doors, a connected corridor network along the A/B and N/M aisles plus a south
  branch to a door, one lift station "CL01" sitting on that branch) — the annex building
  has none, so isolating it at "warehouse" level correctly shows a bare shell. Re-ran the
  script; `tsc --noEmit` clean.
- Verified via Playwright: plant/warehouse-level screenshots match the user's annotated
  topology (west/south doors, connected red corridor, purple "CL01" pad); confirmed
  clicking directly on the lift station while a building was focused still popped back to
  "plant" (the raycast opt-out works); confirmed edit mode still renders everything with
  no regression to slot selection/Inspector.
- specs.md updated (new §5.1 subsection, decision log entry, open-questions bullet
  about no editor UI / no enforced path-to-entry connection yet).

## 2026-09-10 (cont'd — building hover highlight)

- User follow-up: "hover highlighting should work for buildings as well." Added hover
  handlers to wall segments (`src/components/Walls.tsx`, `onPointerOver`/`onPointerMove`/
  `onPointerOut`) gated to `focus.level === "plant"` and `segment.isBuilding`, setting a
  new optional `buildingId` on `ViewFocusContext`'s `HoverPoint` (made `slotId` optional
  too, since a building hover has no slot).
- First attempt used a lightened-gray highlight (matching the slot/rack/pallet pattern)
  and looked like it wasn't working in screenshots — investigated with temporary debug
  logging (confirmed `onPointerOver` fired with correct conditions and `setHover` did
  update state/re-render) and a Python/PIL pixel-level comparison between hovered and
  non-hovered crops of the same wall region, which showed the color change WAS being
  applied (86,90,98 → 129,132,138 on the wall's outline pixels) — it was just too subtle
  to see by eye, since a wall at plant-level zoom is only a few screen pixels thick, so a
  same-hue lighten reads as noise. Switched to a hue-contrasting blue accent color
  instead, which is clearly visible in screenshots.
- Verified via Playwright: hovering each building's wall highlights only that building
  (not the other); moving off returns to plain gray; clicking through to a building right
  after hovering still correctly drills into "warehouse" level for that building, and the
  wall correctly reverts to unhovered gray once no longer at "plant" level. `tsc --noEmit`
  clean.
- specs.md updated (§5.1 hover paragraph extended, new decision log entry).

## 2026-09-10 (cont'd — camera consistency, deeper hover, second building)

- User request (French, with 4 reference screenshots): (1) camera angle must always be
  identical when clicking to focus something — plant/warehouse from directly above,
  slot/slot-space/pallet from a fixed above-and-to-the-side angle; (2) hover highlight
  should go one level deeper — at "slot" level, hovering a sub-slot's rack; at
  "slot-space" level, hovering a pallet; (3) on the example warehouse, add a second
  building (to give "plant" something to show and "warehouse" something to isolate) and
  vary pallet fill between full/partial (~90% full).
- Replaced `CameraControls.fitToBox` entirely with a new unified `frameBox(box, angle)`
  helper (`src/lib/focusBounds.ts`) that offsets the camera from a box's own center by a
  *fixed ratio* of the box's own span — angle is a pure function of the target, never of
  the camera's current position/orientation. Two angles: `"top"` and `"iso"`. First pass
  at `"top"` used a diagonal offset (`x:0.15, z:0.15`) which, geometrically, aligns the
  camera's screen-up with the world diagonal — verified via Playwright screenshot that
  this rendered as a 45°-rotated diamond grid, not a proper axis-aligned plan view;
  fixed by zeroing the x-component (`x:0, z:0.2`) so plant/warehouse now read as a true
  top-down site plan. `FocusCameraDriver` (`WarehouseScene.tsx`) rewritten around this
  single helper, deleting the old `fitToBox` iso path and the manual `setLookAt`
  workaround previously needed just for the "warehouse" level (that bug is now
  subsumed — "warehouse" just uses `"top"` like "plant").
- Hover highlight extended one level deeper each: `HoverPoint`
  (`src/state/ViewFocusContext.tsx`) gained optional `subSlotIndex`/`palletIndex`;
  `Slots.tsx` sets/reads them for sub-slot-rack hover (gated to "slot" level, mutually
  exclusive with the slot-pad highlight via `subSlotIndex === undefined`); `Rack.tsx`
  lightens the rack frame (`RACK_HOVER_COLOR`) on sub-slot hover and lightens the
  individual pallet block (`lighten()`, blending toward white) on pallet hover (gated to
  "slot-space" level).
- Reworked `scripts/generate-example-warehouse.js`: added a second building ("Entrepot
  Annexe", its own wall loop east of the main one, slots C01-C03) — main building
  renamed from a generic id to "Batiment 13A" to match its display name; replaced the
  fixed 6-items-per-pallet convention with a deterministic 90%-full/10%-partial split
  (`nextItemCount()`, a running counter across the whole file so the split holds
  file-wide, partial counts cycling through `[2,4,5,7,8]`) — same "no `Math.random()`"
  convention as the rest of the generator, so re-running it reproduces byte-identical
  output. Re-ran the script: 2 buildings, 21 slots, 19 stocked slots; spot-checked the
  actual distribution (65 full / 7 partial ≈ 90.3%).
- Verified via Playwright screenshots: plant level now shows both buildings as an
  axis-aligned top-down plan (not a diamond) with a visible red/orange fill-rate mix;
  drilling into a slot/slot-space/pallet shows the same consistent 3/4 angle at every
  level; hover-lightened the sub-slot rack frame at "slot" level and a pallet block at
  "slot-space" level; clicking the annex building's wall correctly isolates it (shows
  only C01-C03, breadcrumb reads "Warehouse: Entrepot Annexe"); Escape resets cleanly
  back to the full top-down plant view; edit mode (Inspector, slot selection) unaffected.
  `tsc --noEmit` clean throughout.
- specs.md updated (§5.1 camera-framing and hover paragraphs rewritten, new decision log
  entry).

## 2026-09-10

- User set a standing preference: always commit and push once a unit of work is done in
  this repo, without asking first — saved to persistent memory (feedback type) so future
  sessions pick it up automatically. Applied starting this entry's changes.
- Pallets now render as a simplified color-coded block everywhere except the exact
  "pallet" focus level (user request, in French): `RoundedBox` (drei) chamfered crate,
  red if full (10/10 items, the schema's per-pallet cap) else orange. Turns out to
  naturally extend the win beyond what was literally asked ("slot-space et au-delà") —
  since block-vs-detail is keyed off "is this the exact focused pallet", *every*
  shallower level (slot, warehouse, plant too) also gets the lighter block rendering,
  confirmed via screenshot at plant level showing the whole site in blocks. Also
  confirmed coexistence at pallet level: the focused pallet shows real tires, its
  sibling pallet in the same sub-slot shows as a block (not hidden) — a deliberate
  change from the pure hide-siblings rule used everywhere else in the hierarchy, since
  hiding pallet siblings would lose useful at-a-glance context.
- Changed: `src/lib/visibility.ts` (`isPalletVisible` → `isPalletDetailed`, a real
  semantic shift not just a rename — see specs.md), `src/components/Rack.tsx` (new
  `PalletBlock`, wired in place of the old show/hide branch).
- Verified via Playwright: bumped a pallet to 10 items via the edit-mode Inspector,
  confirmed it renders red in view mode while everything else (6 items in the example
  data) renders orange; confirmed the focused-pallet-shows-tires /
  sibling-pallet-shows-block coexistence at pallet level for a two-tier sub-slot.
  `tsc`/build clean, no console errors.
- specs.md updated (§5.1 + new decision log entry).
- Committed and pushed per the new standing instruction (see above) — no separate
  confirmation asked this time.
- Redesigned the view-mode focus system (user request, in French): 5 named levels —
  **plant → warehouse → slot → slot-space → pallet** — "warehouse" is new (one closed
  wall loop, derived from `walls` via point-in-polygon, no schema change); focused-level
  siblings now **disappear** (not just dim — a real behavior change, per explicit
  feedback: "les autres éléments du même niveau sont masqués... disparaissent"); a new
  left-side breadcrumb widget shows the full path with direct jump-to-level clicks; slots
  now also highlight in-scene on hover (not just the existing hover card). Entered Plan
  Mode given the scope (new hierarchy level, a real behavior change, a new widget); no
  blocking ambiguity found worth a separate question round this time, wrote the plan
  directly from analysis of the existing 4-level system.
- New: `src/lib/buildings.ts` (`listBuildings`/`findBuildingForSlot`),
  `src/lib/visibility.ts` (replaces the deleted `src/lib/emphasis.ts` — boolean
  show/hide instead of color-blend dimming), `src/components/FocusBreadcrumb.tsx`.
  Changed: `src/state/ViewFocusContext.tsx` (new `FocusLevel` union, `buildingId` on
  `Focus`, `back()` extended to 5 levels), `src/lib/focusBounds.ts` (+
  `buildingWorldBox`), `src/components/WarehouseScene.tsx` (warehouse-level camera
  branch), `src/components/Slots.tsx`/`Rack.tsx` (hide-via-early-return, hover
  highlight), `src/components/Walls.tsx` (exports `WALL_HEIGHT`, per-building
  hide/click-routing), `src/components/HoverCard.tsx` (now shows at plant *and*
  warehouse level), `src/App.tsx`/`App.css`.
- Two real bugs found and fixed while testing (Playwright, extensive — this took several
  rounds of coordinate-probing and console-log tracing before landing on the actual root
  causes, both now noted in specs.md so they don't get re-discovered blind next time):
  (1) a slot's decorative edge-outline `<lineSegments>` intercepted nearly all clicks
  once zoomed in on a single slot, because Three.js defaults line-raycasting to a
  1-world-unit threshold — fixed with `raycast={() => null}`; (2) the new "warehouse"
  level's `fitToBox` dollied absurdly close for a wide/deep/short building box — worked
  around by framing it manually via `setLookAt` with the same span-based formula the
  plant-level reset already uses.
- Verified via Playwright: full plant→warehouse→slot→slot-space→pallet drill-down with
  screenshots at each level confirming siblings actually vanish (not dim); breadcrumb
  shows the correct path at each level and clicking an ancestor crumb jumps straight
  there (tested from pallet level back to slot in one click); Escape resets fully to
  plant from any depth; hover highlight visible on a slot's pad; edit mode (Inspector,
  depth, pallets, drag) confirmed unaffected. `tsc`/build clean throughout.
- specs.md §5.1 rewritten for the new hierarchy + a new decision log entry, both noting
  the two bugs above for future reference.
- Rebuilt the example warehouse (`schema/warehouse.example.json` +
  `.content.example.json`) into a purpose-built demo per the user's spec: A01-A05
  (depth 3, up to 2 tiers, facing south) and B01-B05 (depth 2, up to 3 tiers, facing
  north) as a horizontal facing-pair across a 2m aisle; N01-N04/M01-M04 as the same
  pattern rotated 90°/270° ("vertical" racks, facing east/west) across their own 2m
  aisle. Pallet counts: 01->1, 02->3, 03->5, 04->6 (full capacity), 05->0 (A/B only, N/M
  only go to 04) — filled using the exact same deepest-first algorithm as the app's
  `addPalletAuto`, written as a small local function in the new generator script so the
  data is byte-identical to what clicking "+ Pallet" that many times would produce.
  Walls enlarged to 40x22m to fit both facing-pairs without overlap.
- New: `scripts/generate-example-warehouse.js` (run: `node scripts/generate-
  example-warehouse.js`), parallel to the existing `generate-batiment-13a.js`. Had to
  derive the `rotationDeg` -> compass-facing mapping from scratch by working through
  `Slots.tsx`'s actual Three.js rotation-around-Y math (not assumed): 0=North, 90=West,
  180=South, 270=East — cross-checked the entry-marker and sub-slot-offset formulas both
  independently, they agreed. This is now the first real usage of `rotationDeg` beyond
  90°-increment eyeballing.
- Verified via Playwright (screenshots + a data-summary dump comparing generated pallet
  distribution against hand-derived expectations for every slot — all matched exactly)
  and via the Inspector in edit mode (selected A01, confirmed Depth 3 / only A01.3 has a
  pallet, matching "A01 should contain 1 pallet" filling the deepest sub-slot first).
  `tsc`/full build clean, no console errors.
- specs.md updated (decision log + a new open question: "height"/max-tiers-per-sub-slot
  is a data-authoring convention only here, not a persisted or enforced schema field).
- Added a visible entry marker on each slot (user request, in French, with an
  annotated screenshot): a raised green threshold bar right at the slot's fixed entry
  edge (`EntryMarker` in `src/components/Slots.tsx`), sized/positioned so it still
  reads clearly even where a rack's corner posts stand on it, and dims along with the
  rest of the slot under the view-mode focus system. Verified visually (zoomed-out
  overview and zoomed-in via the click-to-focus flow) — reads clearly at both scales.
  specs.md §5.1 "Storage subdivision" + decision log updated.
- Split the physical asset layer into two files (user request, in French): a
  **configuration** file (layout — walls, slot positions, each slot's physical `depth`)
  and a **content** file (inventory — which sub-slots hold pallets/items), loaded in
  sequence, config first. New: `src/lib/warehouseFiles.ts` (`mergeWarehouse`/
  `splitWarehouse`, round-trip verified lossless via a Playwright Save-then-inspect
  pass), `schema/warehouse.content.schema.json`, `schema/warehouse.content.example.json`.
  Changed: `src/types/warehouse.ts` (added `SlotConfig`/`WarehouseConfig`/
  `SlotContent`/`WarehouseContent`, kept the merged runtime `Slot`/`Warehouse` as-is),
  `src/lib/file.ts` (`loadWarehouseFiles`/`saveWarehouseFiles`, two sequential
  pickers/saves with an `alert()` naming each one), `src/state/EditorContext.tsx`
  (`fileHandlesRef` now holds both handles), `src/App.tsx` (merges both example files
  on initial load), `schema/warehouse.example.json` (trimmed to config-only).
  `schema/warehouse.batiment-13a.json` needed no change (it never had subSlots data).
  No changes needed anywhere else — `Slots.tsx`/`Rack.tsx`/`Inspector.tsx`/
  `ViewFocusContext`/`focusBounds.ts` all still just work with the merged in-memory
  `Warehouse`, exactly as before.
- Verified via Playwright: initial app load renders pixel-identical to before the
  split; the two-file Load flow (sequential `<input type=file>` pickers, forcing the
  fallback path since this headless Chromium's `showOpenFilePicker` doesn't
  resolve/reject in this environment — a test-harness limitation, not an app issue)
  merges correctly; Save produces `bat-13a.json` + `bat-13a.content.json` whose content
  exactly reproduces the original split. Edit mode (Inspector, depth, pallets)
  unaffected. Did not commit/push this round — not asked to this time.
- specs.md updated (§5.1 intro + "Storage subdivision" + "Editor" Save/load bullet +
  decision log); this entry is the CONTEXT_LOG.md counterpart.
- Finished Milestones 3-4 of the plan referenced below: a view-mode-only hover card
  (`src/components/HoverCard.tsx`) and a click-to-zoom drill-down through
  Slot → sub-slot → pallet, with dimming and rollback. New:
  `src/state/ViewFocusContext.tsx` (focus state, separate from `EditorContext`),
  `src/lib/focusBounds.ts` (analytical world-space boxes for `fitToBox`, no ref
  registry), `src/lib/emphasis.ts` (dim/full color logic). Changed: `WarehouseScene.tsx`
  (swaps `OrbitControls` for drei's `CameraControls` in view mode only), `Slots.tsx`
  (hover handlers, slot/sub-slot click routing, dimming), `Rack.tsx` (per-tier click
  target + dimming, took `slotId`/`subSlotIndex` props), `Walls.tsx` (click-to-roll-back
  + dimming). Also factored the depth/footprint math shared by `Slots.tsx` and
  `focusBounds.ts` into `slotFootprint()` in `src/lib/geometry.ts`, to avoid the two
  drifting apart.
- Verified via Playwright with a temporary console.log of the focus state (removed
  before committing): overview → slot → sub-slot → pallet → overview (Escape) all
  transitioned correctly in one pass; wall-click-triggers-rollback confirmed separately.
  Clicking a different slot while zoomed in re-targets directly to it (by design — not
  literally "rolls back first"). Confirmed edit mode (Inspector, drag, selection) is
  unaffected by any of this. Not yet checked against the full 870-slot Batiment 13A file
  — see specs.md open question 12.
- Full design in specs.md §5.1 "View mode: hover card + click-to-zoom drill-down"; §6 and
  the decision log updated there too.
- Revised the storage-subdivision feature per user feedback (two screenshots + written
  critique of the first pass). Also retroactively covers an unlogged mid-session rework from
  the tail end of 2026-09-09's work (depth now multiplies the footprint instead of splitting
  it, sub-slots anchored at `subSlots[0]`, pale-vs-black divider contrast) — that work
  happened but was never written up here or in specs.md's decision log before this entry.
  Today's changes on top of that: tires span the full pallet width again (undoing a
  fixed-size/left-packed attempt that looked half-empty), rack tiers are now fully connected
  rail rectangles, "+ Pallet" is a single slot-level button enforcing deepest-first fill, id
  labels moved outside the footprint to the fixed entry edge, outline is solid black. Full
  detail in specs.md §5.1 "Storage subdivision" and its decision log entry.
- Entered formal Plan Mode for this request (multi-area ask: pallet/rack rendering, slot
  display, and a new view-mode hover/click-to-zoom drill-down through Slot → sub-slot →
  pallet). Asked 3 clarifying questions first (recorded as decisions): pallets auto-fill via
  one button using deepest-first/fewest-pallets-wins logic; "blur the rest" is dim +
  desaturate (no new render-pipeline dependency); the new hover/zoom interaction is
  **View-mode only**, Edit mode unchanged. Verified `@react-three/drei`'s `CameraControls`
  (and its `camera-controls` peer dep) is already installed — no new npm package needed for
  the smooth zoom. Plan saved at the session's plan-mode plan file; approved by the user.
- This entry covers Milestones 1-2 of that plan (pallet/rack rendering + slot display).
  Milestones 3-4 (view-focus state, hover card, camera drill-down, dimming, rollback/Escape)
  are still in progress this same session — see the next entry once done, or this repo's git
  log if this log hasn't caught up yet.
- Changed: `src/components/Rack.tsx` (full-width tire sizing, connected `RailFrame`),
  `src/state/EditorContext.tsx` (`addPallet` → `addPalletAuto`), `src/components/
  Inspector.tsx` (single slot-level "+ Pallet" button), `src/components/Slots.tsx` (label
  repositioned outside the footprint, edge color black), `src/App.css` (new button style).
- Verified visually via the same ad hoc Playwright screenshot workflow as 2026-09-09 (ports/
  scripts unchanged); `tsc --noEmit` clean.

## 2026-09-09

- Added a storage-content hierarchy inside a slot — **Slot → Sub-slot → Pallet → Item**
  (sub-slots = depth subdivision, pallets stack vertically, items = 1-10 per pallet, e.g.
  tires) — prompted by a top-view reference screenshot (AN01 depth 2, AN02 depth 4) and a
  tire-rack photo for the visual target. Full design/rationale in specs.md §5.1 "Storage
  subdivision"; §6 and decision log updated there too.
- New: `src/components/Rack.tsx` (rack frame + torus "tire" rendering). Changed:
  `src/types/warehouse.ts`, `schema/warehouse.schema.json` (added `Item`/`Pallet`/`SubSlot`,
  optional `slot.subSlots`), `src/state/EditorContext.tsx` (`setSlotDepth`/`addPallet`/
  `removePallet`/`setPalletItemCount`), `src/components/Inspector.tsx` (Depth field +
  per-sub-slot pallet/item controls), `src/components/Slots.tsx` (depth dividers + rack
  wiring), `schema/warehouse.example.json` (demo data on A01/A02).
- Verified end-to-end with a headless-browser (Playwright) pass: rack/tire rendering on
  A01/A02, depth resize, add/remove pallet, item-count clamp to 10 — all worked, no console
  errors. No project skill existed yet for running this app; used an ad hoc Playwright
  script rather than `chromium-cli` (not installed in this environment).
- Next: unchanged from before this session — simulation graph layer / scenario parameters,
  or an accurate Batiment 13A digitization (specs.md §9).

## 2026-09-07

- Project kicked off. Templated `specs.md` and `.claude/agents/context-keeper.md`.
- Clarified scope with the user: this is a **simulation + 3D visualization** tool, not a
  real-data analytics tool. See specs.md §10 for the full decision list.
- Key decisions: TypeScript across the whole stack; custom TS simulation engine (Node); 3D
  frontend (react-three-fiber, working assumption); warehouse layout is a grid-generated
  node/edge graph, single-level for v1, zones carry simulation rules (full schema in
  specs.md §5). User deferred `git init` for now.
- No code written yet — this session was design/specs only.
- Next: either (a) design the scenario parameter set and simulation engine core (specs.md
  open question 3, which also fills in the rest of zone `rules` fields), or (b) scaffold
  the TS monorepo (frontend + engine + shared types/schema) using the §5 schema.
- Repo committed and pushed to https://github.com/SunTasked/warehouse-visualizer (main).
  Added MIT `LICENSE` (reuse allowed, must keep copyright/license notice), expanded
  `README.md`, and broadened `.gitignore` for the eventual TS/React/Three.js monorepo.
- User shared a screenshot of a real reference warehouse ("Batiment 13A", currently
  described in an unwieldy Excel sheet): irregular outline, notches, a detached block,
  black obstacle cells (pillars), and aisle-direction arrows. This showed the grid
  generator alone can't represent a real building, so the warehouse model was split into a
  **physical asset layer** (walls + slots — decided/implemented, specs.md §5.1) and a
  **simulation graph layer** (nodes/edges/zones — future, specs.md §5.2). Wrote
  `schema/warehouse.schema.json` + `schema/warehouse.example.json` (small illustrative
  example, not the full Batiment 13A digitization). Full Batiment 13A digitization and the
  simulation-graph authoring approach for real buildings are open (specs.md §9, items 8-10).
- Next: build the web viewer for `schema/warehouse.example.json` to validate the physical
  asset format renders correctly (this was the original ask alongside the schema).

## 2026-09-08

- Built the first 3D viewer: Vite + React + TypeScript + react-three-fiber, scaffolded at
  the repo root (`package.json`, `src/`) — a single app, not a monorepo, since there's only
  one piece of code so far. Renders `schema/warehouse.example.json` (walls as extruded
  boxes, slots as labeled pads) with orbit controls on a 1m grid. `npm run dev` to view.
  Verified with a Playwright screenshot (no console errors) — see specs.md §5.1 for the
  coordinate-mapping/rotation implementation notes.
- specs.md updated: §5.1 marked implemented, §6 3D-view item checked off (physical layer
  only — no aisles/lanes/zones yet), open question 5 (react-three-fiber choice) resolved.
- Next: either digitize more of the real Batiment 13A layout into the format (open question
  10), or move to designing the simulation graph layer / scenario parameters (open
  questions 3, 8).
- Added a warehouse editor to the viewer (edit mode toggle): drag wall corners to reshape
  the building; "Add Slot" + click floor to create one (prompts for id); click a slot to
  select/drag it, edit id/x/y/rotationDeg in a side panel, or delete it; Save/Load a JSON
  file (File System Access API, with download/upload fallback for browsers without it).
  New files: `src/state/EditorContext.tsx` (all editor state + mutations),
  `src/components/DragPlane.tsx` (the invisible ground plane that makes dragging
  continuous), `src/components/Toolbar.tsx`, `src/components/Inspector.tsx`,
  `src/lib/file.ts`. `Walls.tsx`/`Slots.tsx` gained handles/selection.
- Found and fixed a real bug during testing (Playwright + a dev-only console.log, not just
  visual inspection): `addSlot`/`updateSlot` read/wrote an outer `let` variable from inside
  a `setWarehouse` updater function. React 18 Strict Mode double-invokes updaters in dev to
  catch exactly this impurity, which was causing spurious "id already exists" errors on
  otherwise-valid adds. Fixed by reading `warehouse` directly for the pre-check instead of
  inspecting `current` inside the updater. Also fixed the camera/orbit target being
  recomputed (and re-applied by react-three-fiber) on every edit, which fought
  OrbitControls — it's now computed once per mount; loading a different file remounts the
  scene (keyed on `warehouse.id`) to get a fresh, appropriately-scaled camera framing.
- specs.md updated: §5.1 has a new "Editor" subsection, §6 editor item checked off, open
  questions 10-11 added/updated, decision log entry added.
- Next: same open items as before (simulation graph layer design, scenario parameters, or
  digitizing more of Batiment 13A — now easier via the editor itself).
- Added undo/redo (Ctrl+Z / Ctrl+Shift+Z + toolbar buttons) and enforced that every wall
  and slot edge lands on a whole-meter graduation mark. Design notes:
  - History is a stack of whole `Warehouse` snapshots in `EditorContext`'s `state`
    (`{warehouse, past, future}`), all updated via one pure `setState` call each (learned
    from the earlier impure-updater bug — no nested setState-inside-setState, no outer
    mutable variables).
  - A drag or an inspector-field edit is ONE undo step, not one per pointermove/keystroke:
    `beginChange()` snapshots history at gesture start (pointer-down on a handle, a field's
    onFocus), then `mutateWarehouse()` applies the continuous updates without pushing more
    history.
  - Snapping (coordinates to the nearest integer, rotation to the nearest 90°) moved from
    `DragPlane`'s own local snap constant into `updateWallPoint`/`addSlot`/`updateSlot`
    themselves, so it's enforced regardless of entry point (drag vs. typed inspector field).
- specs.md updated: §5.1 "Editor" describes undo/redo and snapping; §6 editor checklist item
  updated; new decision log entry.
- Next: unchanged from before this session's edits — simulation graph layer design,
  scenario parameters, or digitizing more of Batiment 13A.
- Generated an approximate full-scale Batiment 13A layout (870 slots) matching the
  reference screenshot's structure: `scripts/generate-batiment-13a.js` →
  `schema/warehouse.batiment-13a.json`. Block row/column counts and positions (N/L/K side
  blocks, A/B/D-E/G row bands with obstacle gaps, small end-cap clusters, detached block Z)
  were estimated by eye from the screenshot, not measured from real data — ids are
  arbitrary. Verified by loading it in the viewer (Playwright, `<input type=file>` fallback
  since the File System Access picker can't be automated) and visually confirming the
  overall shape/gaps/obstacles line up; also verified computationally that no block
  bounding boxes overlap.
- `warehouse.example.json` (the small hand-written one) stays the default the app loads —
  this new file is an additional sample, opened via Load.
- specs.md open question 10 updated to reflect this is a partial answer (an eyeballed
  approximation), not a real digitization from actual measurements; decision log entry
  added.
- Next: an accurate Batiment 13A digitization would need real measurements (not a
  screenshot estimate) — otherwise, same open items as before (simulation graph layer /
  scenario parameters).
- Added multi-select, box-select, bulk update/delete, and a History panel:
  - Selection is now `selectedSlotIds: Set<string>`. Ctrl/Cmd+click toggles membership;
    plain click on an unselected slot replaces the selection; plain click-and-drag on a
    slot that's already part of a multi-selection moves the whole group (computed via a
    per-slot origin snapshot + one shared anchor/delta, not "set every slot to the same
    point").
  - Box-select (`src/components/SelectionOverlay.tsx`): right-click-drag draws a rectangle;
    slot centers are projected to screen space via the live camera (`cameraRef`, captured
    from `Canvas.onCreated`) to test containment. It listens on the canvas's *container*
    div rather than rendering its own overlay layer, since a full-size div would either
    block left-click scene interaction (`pointer-events: auto`) or never receive the
    right-click at all (`pointer-events: none`) — native events from the canvas bubble up
    to the container either way, so listening there costs nothing.
  - Inspector now has a bulk mode (2+ slots selected): a Rotation field applied to all, and
    "Delete N slots" — both single history entries.
  - Undo/redo reworked from a past/future stack into a flat, labeled timeline (`entries` +
    `cursor`) specifically so the new History panel can jump to *any* past entry, not just
    step sequentially. `commit(label)` is called once per completed gesture (drag end,
    field blur, or immediately for atomic actions like add/delete); `mutateWarehouse`
    applies live updates without touching history in between.
  - Two real bugs found and fixed while testing this (Playwright, not just visual
    inspection): a plain click with zero pointer movement was still committing a spurious
    "Move slot X" history entry (fixed with a `moved` flag, set only on an actual
    pointermove, checked before committing in `DragPlane`'s `endDrag`); and — a test-script
    bug, not an app bug, but worth remembering — Playwright's raw `page.mouse.click()` does
    not support a `modifiers` option (only locator-based `.click()` does), so Ctrl+click
    tests need `page.keyboard.down("Control")` / `up("Control")` around the raw click.
  - specs.md §5.1 "Editor" rewritten to describe all of the above; §6 checklist and decision
    log updated.
- Next: same open items as always — simulation graph layer / scenario parameters, or an
  accurate Batiment 13A digitization.
