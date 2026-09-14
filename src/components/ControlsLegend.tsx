import { useState, type ReactNode } from "react";
import { useEditor } from "../state/EditorContext";

interface Control {
  action: string;
  how: ReactNode;
}

// View mode drives drei's CameraControls with camera-controls' own default
// bindings (left rotates, right pans, wheel and middle zoom); the rest is
// the drill-down in ViewFocusContext.
const VIEW_CONTROLS: Control[] = [
  { action: "Zoom", how: "Scroll wheel" },
  { action: "Move around", how: "Right-drag" },
  { action: "Rotate", how: "Left-drag" },
  { action: "Details", how: "Hover anything" },
  {
    action: "Find a slot",
    how: (
      <>
        <kbd>/</kbd> or the search box
      </>
    ),
  },
  { action: "Zoom into", how: "Click a building, slot or pallet" },
  { action: "Back out", how: "Click empty floor" },
  {
    action: "Plant view",
    how: (
      <>
        <kbd>Esc</kbd> or the Plant crumb
      </>
    ),
  },
];

// Edit mode drives three's OrbitControls, whose right-drag pan is taken over
// by box select (SelectionOverlay) — panning is its Shift+left-drag instead.
const EDIT_CONTROLS: Control[] = [
  { action: "Zoom", how: "Scroll wheel" },
  {
    action: "Move around",
    how: (
      <>
        <kbd>Shift</kbd> + left-drag
      </>
    ),
  },
  { action: "Rotate", how: "Left-drag empty floor" },
  {
    action: "Select",
    how: (
      <>
        Click a slot · <kbd>Ctrl</kbd>+click to add
      </>
    ),
  },
  {
    action: "Find a slot",
    how: (
      <>
        <kbd>/</kbd> or the search box
      </>
    ),
  },
  {
    action: "Box select",
    how: (
      <>
        Right-drag · hold <kbd>Ctrl</kbd> to add
      </>
    ),
  },
  { action: "Move", how: "Drag a slot or a wall's corner handle" },
  {
    action: "Undo / redo",
    how: (
      <>
        <kbd>Ctrl</kbd>+<kbd>Z</kbd> · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>
      </>
    ),
  },
];

/** How to get around the scene, for whichever mode is on — bottom-left, and collapsible once learnt. */
export function ControlsLegend() {
  const { mode } = useEditor();
  const [collapsed, setCollapsed] = useState(false);
  const controls = mode === "view" ? VIEW_CONTROLS : EDIT_CONTROLS;

  return (
    <div className="controls-legend">
      <button
        className={collapsed ? "controls-legend__header" : "controls-legend__header controls-legend__header--open"}
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? "Show the controls" : "Hide the controls"}
      >
        <span>Controls</span>
        <span className="controls-legend__chevron">{collapsed ? "▴" : "▾"}</span>
      </button>
      {!collapsed && (
        <dl className="controls-legend__list">
          {controls.map((control) => (
            <div className="controls-legend__row" key={control.action}>
              <dt>{control.action}</dt>
              <dd>{control.how}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
