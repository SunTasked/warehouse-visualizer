# warehouse-visualizer

A warehouse operator traffic simulation and 3D visualization tool. It simulates operator
movement through a warehouse under configurable, WMS-style parameters (slotting, lane
rules, operator count, order profiles, ...), then renders the result in 3D — operator
paths, congestion points, and slot/aisle usage — to help identify slotting and
aisle-management optimizations by comparing "what-if" scenarios.

**Status:** early design phase, no application code yet. See [specs.md](specs.md) for the
full spec and [CONTEXT_LOG.md](CONTEXT_LOG.md) for the session-by-session decision log —
both are kept current by a dedicated [context-keeper agent](.claude/agents/context-keeper.md).

## Planned stack

- TypeScript across the stack (single language for the simulation engine and frontend).
- A custom discrete-event simulation engine (Node) driven by a warehouse model + scenario
  config.
- React + Three.js (react-three-fiber) for the 3D visualization.

Details and rationale for these choices are in [specs.md](specs.md) §7.

## License

MIT — see [LICENSE](LICENSE). Free to use, modify, and redistribute; please keep the
copyright/license notice (i.e. cite this source) in copies.
