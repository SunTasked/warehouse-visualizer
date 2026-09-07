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
