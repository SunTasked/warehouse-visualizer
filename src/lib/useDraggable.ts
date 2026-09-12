import { useCallback, useEffect, useRef, useState } from "react";

export interface DragPosition {
  left: number;
  top: number;
}

/** Keeps a dragged panel from being pushed somewhere it can't be grabbed back from. */
const EDGE_MARGIN = 8;
/** How much of the panel must stay on screen horizontally, so its drag handle is always reachable. */
const MIN_VISIBLE = 80;
/** Enough of the handle bar to grab. */
const HANDLE_HEIGHT = 60;

/**
 * Pointer-drag positioning for a floating panel (specs.md §5.4). Position
 * stays null until the first drag, so the panel keeps whatever resting place
 * CSS gives it; from then on it is explicitly placed and clamped so it can't
 * be pushed somewhere its own handle is unreachable.
 *
 * Coordinates are kept in the *offset parent's* space, not the viewport's.
 * Pointer events report viewport coordinates while `left`/`top` on an
 * absolutely positioned panel resolve against its containing block — mixing
 * the two makes the panel jump by the header's height on every grab.
 *
 * Uses left/top rather than a transform on purpose: a transformed ancestor
 * becomes the containing block for `position: fixed` descendants, which
 * would trap the step tooltip inside the panel's own clipped box.
 */
export function useDraggable(ref: React.RefObject<HTMLElement>) {
  const [position, setPosition] = useState<DragPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  // Where inside the panel the pointer grabbed it, so it doesn't jump.
  const grabRef = useRef({ x: 0, y: 0 });
  const sizeRef = useRef({ width: 0, height: 0 });
  /** The containing block's viewport offset, for converting pointer coords into the space `left`/`top` actually use. */
  const originRef = useRef({ x: 0, y: 0 });

  /** Takes a viewport point for the panel's top-left and returns a clamped position in parent space. */
  const clampFromViewport = useCallback((viewportLeft: number, viewportTop: number): DragPosition => {
    const { width, height } = sizeRef.current;
    const left = Math.min(Math.max(viewportLeft, MIN_VISIBLE - width), window.innerWidth - MIN_VISIBLE);
    const top = Math.min(
      Math.max(viewportTop, EDGE_MARGIN),
      window.innerHeight - Math.min(height, HANDLE_HEIGHT) - EDGE_MARGIN,
    );
    return { left: left - originRef.current.x, top: top - originRef.current.y };
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Let the panel's own controls work: only bare surface starts a drag.
      if ((event.target as HTMLElement).closest("button, input, select, a, label")) return;
      const element = ref.current;
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const parent = element.offsetParent?.getBoundingClientRect();
      originRef.current = { x: parent?.left ?? 0, y: parent?.top ?? 0 };
      grabRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      sizeRef.current = { width: rect.width, height: rect.height };
      setPosition(clampFromViewport(rect.left, rect.top));
      setDragging(true);
      // Deliberately no preventDefault: suppressing the default on
      // pointerdown also suppresses the compatibility mouse events, which
      // would stop the handle's own double-click-to-reset from ever firing.
      // Text selection during a drag is handled by user-select: none on the
      // handle instead.
    },
    [clampFromViewport, ref],
  );

  useEffect(() => {
    if (!dragging) return;

    const move = (event: PointerEvent) => {
      setPosition(clampFromViewport(event.clientX - grabRef.current.x, event.clientY - grabRef.current.y));
    };
    const stop = () => setDragging(false);

    // On window, not the element: the pointer routinely outruns a small panel
    // mid-drag, and losing the moves then would drop it wherever it lagged.
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging, clampFromViewport]);

  // A window resize can strand a panel outside the new viewport.
  useEffect(() => {
    const onResize = () => {
      const element = ref.current;
      if (!element) return;
      setPosition((current) => {
        if (!current) return null;
        const rect = element.getBoundingClientRect();
        const parent = element.offsetParent?.getBoundingClientRect();
        originRef.current = { x: parent?.left ?? 0, y: parent?.top ?? 0 };
        sizeRef.current = { width: rect.width, height: rect.height };
        return clampFromViewport(rect.left, rect.top);
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampFromViewport, ref]);

  const reset = useCallback(() => setPosition(null), []);

  const style = position ? { left: position.left, top: position.top, right: "auto", margin: 0 } : undefined;

  return { onPointerDown, style, dragging, reset };
}
