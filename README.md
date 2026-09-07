# warehouse-visualizer

A warehouse operator traffic simulation and 3D visualization tool. It simulates operator
movement through a warehouse under configurable, WMS-style parameters (slotting, lane
rules, operator count, order profiles, ...), then renders the result in 3D — operator
paths, congestion points, and slot/aisle usage — to help identify slotting and
aisle-management optimizations by comparing "what-if" scenarios.

**Status:** early stage — a first 3D viewer renders and edits the warehouse physical asset
format (walls + slots, see `schema/`), the simulation engine doesn't exist yet. See
[specs.md](specs.md) for the full spec and [CONTEXT_LOG.md](CONTEXT_LOG.md) for the
session-by-session decision log — both are kept current by a dedicated
[context-keeper agent](.claude/agents/context-keeper.md).

## Running the viewer

```
npm install
npm run dev
```

Opens a 3D view of `schema/warehouse.example.json` (walls + slots) at
`http://localhost:5173` — orbit/pan/zoom with the mouse. It does not run any simulation yet.

Click **Editing** to edit the layout:
- Drag an orange corner handle to reshape a wall.
- **Add Slot**, then click the floor to place one (you'll be asked for its id/location
  code).
- Click a slot to select it — drag to move it, or use the side panel to edit its
  id/x/y/rotation or delete it.
- **Save**/**Load** read and write the warehouse JSON file (in Chrome/Edge, Save writes
  back to the same file you loaded; other browsers download/upload instead).
- **Ctrl+Z** / **Ctrl+Shift+Z** (or the Undo/Redo buttons) undo/redo edits, one drag or one
  field edit at a time.
- Every coordinate snaps to a whole meter and every rotation to 90°, so wall and slot edges
  always land on a grid line.

## Planned stack

- TypeScript across the stack (single language for the simulation engine and frontend).
- A custom discrete-event simulation engine (Node) driven by a warehouse model + scenario
  config.
- React + Three.js (react-three-fiber) for the 3D visualization — in place for the viewer.

Details and rationale for these choices are in [specs.md](specs.md) §7.

## License

MIT — see [LICENSE](LICENSE). Free to use, modify, and redistribute; please keep the
copyright/license notice (i.e. cite this source) in copies.
