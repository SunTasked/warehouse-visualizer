# warehouse-visualizer

A warehouse operator traffic simulation and 3D visualization tool. It simulates operator
movement through a warehouse under configurable, WMS-style parameters (slotting, lane
rules, operator count, order profiles, ...), then renders the result in 3D — operator
paths, congestion points, and slot/aisle usage — to help identify slotting and
aisle-management optimizations by comparing "what-if" scenarios.

**Status:** early stage — a first 3D viewer renders the warehouse physical asset format
(walls + slots, see `schema/`), the simulation engine doesn't exist yet. See
[specs.md](specs.md) for the full spec and [CONTEXT_LOG.md](CONTEXT_LOG.md) for the
session-by-session decision log — both are kept current by a dedicated
[context-keeper agent](.claude/agents/context-keeper.md).

## Running the viewer

```
npm install
npm run dev
```

Opens a 3D view of `schema/warehouse.example.json` (walls + slots) at
`http://localhost:5173` — orbit/pan/zoom with the mouse. This exists to validate the
physical asset format (specs.md §5.1) renders correctly before building anything on top of
it; it does not run any simulation yet.

## Planned stack

- TypeScript across the stack (single language for the simulation engine and frontend).
- A custom discrete-event simulation engine (Node) driven by a warehouse model + scenario
  config.
- React + Three.js (react-three-fiber) for the 3D visualization — in place for the viewer.

Details and rationale for these choices are in [specs.md](specs.md) §7.

## License

MIT — see [LICENSE](LICENSE). Free to use, modify, and redistribute; please keep the
copyright/license notice (i.e. cite this source) in copies.
