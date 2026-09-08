import { useEffect, useRef, useState, type RefObject } from "react";
import { Vector3 } from "three";
import { useEditor } from "../state/EditorContext";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CLICK_THRESHOLD = 4; // px — a right-click with less movement than this doesn't change selection

/**
 * Right-click-drag box select, like a Windows desktop rubber-band selection.
 *
 * Listens on containerRef (the div that hosts the <canvas>) via native
 * addEventListener rather than rendering its own hit-testable overlay: a
 * full-size div would either block left-click interaction with the 3D scene
 * beneath (pointer-events: auto) or never receive the right-click itself
 * (pointer-events: none) — there's no per-button middle ground in CSS.
 * Listening on the container instead works because pointer events from the
 * canvas (its child) bubble up to it, so left-clicks reach the canvas
 * completely unaffected and we only react to the right button here. This
 * component's own rendered `<div>` is purely the visual rectangle, and is
 * always pointer-events: none.
 */
export function SelectionOverlay({ containerRef }: { containerRef: RefObject<HTMLDivElement> }) {
  const { mode, warehouse, orbitRef, cameraRef, selectMany } = useEditor();
  const [rect, setRect] = useState<Rect | null>(null);
  const dragState = useRef<{ startX: number; startY: number; additive: boolean } | null>(null);
  const rectRef = useRef<Rect | null>(null);
  rectRef.current = rect;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mode !== "edit") return;

    const toLocal = (e: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      return { x: e.clientX - bounds.left, y: e.clientY - bounds.top, bounds };
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 2) return;
      e.preventDefault();
      const { x, y } = toLocal(e);
      dragState.current = { startX: x, startY: y, additive: e.ctrlKey || e.metaKey };
      setRect({ x, y, width: 0, height: 0 });
      if (orbitRef.current) orbitRef.current.enabled = false;
      (e.target as Element).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragState.current;
      if (!drag) return;
      const { x, y } = toLocal(e);
      setRect({
        x: Math.min(drag.startX, x),
        y: Math.min(drag.startY, y),
        width: Math.abs(x - drag.startX),
        height: Math.abs(y - drag.startY),
      });
    };

    const handlePointerUp = (e: PointerEvent) => {
      const drag = dragState.current;
      dragState.current = null;
      if (orbitRef.current) orbitRef.current.enabled = true;
      const finalRect = rectRef.current;
      setRect(null);
      if (!drag || !finalRect) return;
      if (finalRect.width < CLICK_THRESHOLD && finalRect.height < CLICK_THRESHOLD) return;

      const camera = cameraRef.current;
      if (!camera) return;
      const { bounds } = toLocal(e);
      const v = new Vector3();
      const matched: string[] = [];
      for (const slot of warehouse.slots) {
        v.set(slot.x, 0.03, -slot.y);
        v.project(camera);
        const sx = (v.x * 0.5 + 0.5) * bounds.width;
        const sy = (1 - (v.y * 0.5 + 0.5)) * bounds.height;
        if (
          sx >= finalRect.x &&
          sx <= finalRect.x + finalRect.width &&
          sy >= finalRect.y &&
          sy <= finalRect.y + finalRect.height
        ) {
          matched.push(slot.id);
        }
      }
      selectMany(matched, drag.additive);
    };

    const handleContextMenu = (e: MouseEvent) => e.preventDefault();

    container.addEventListener("pointerdown", handlePointerDown);
    container.addEventListener("pointermove", handlePointerMove);
    container.addEventListener("pointerup", handlePointerUp);
    container.addEventListener("contextmenu", handleContextMenu);
    return () => {
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerup", handlePointerUp);
      container.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [containerRef, mode, warehouse, orbitRef, cameraRef, selectMany]);

  if (mode !== "edit" || !rect) return null;

  return (
    <div
      className="selection-overlay__box"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    />
  );
}
