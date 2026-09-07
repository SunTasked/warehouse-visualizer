# Context Log

Chronological session log, maintained by the `context-keeper` agent. Newest entries at the
top. This is a log of what happened each session — the current-state snapshot lives in
`specs.md`.

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
