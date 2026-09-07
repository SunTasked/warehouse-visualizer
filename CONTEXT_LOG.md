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
