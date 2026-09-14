import { useCallback, useLayoutEffect, useState, type UIEvent } from "react";

/** Lists up to this many rows render every row; longer ones render only what's in view. */
const WINDOW_FROM = 150;

/**
 * Windowing for a scrolling list of fixed-pitch rows: only the rows in view,
 * plus `overscan` either side, are rendered, and two spacers stand in for the
 * rest — so a list of 20,000 costs what a list of thirty does. A batch of
 * thousands of picking lists had made the catalogue, the order list and the
 * board's per-run chart each mount tens of thousands of DOM nodes at once,
 * freezing the page for seconds after the routes themselves took a fraction
 * of one. Spacers rather than a transform, so a row's position: fixed
 * tooltip still places against the viewport.
 *
 * Attach `ref` and `onScroll` to the scrolling element; `rowHeight` is the
 * distance from one row's top to the next's (height plus any margin).
 */
export function useVirtualRows<T extends HTMLElement>(count: number, rowHeight: number, overscan = 8) {
  const [element, setElement] = useState<T | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  // A callback ref, not an object one: these lists mount and unmount with
  // their panels (collapsed, or swapped for a progress bar), and each new
  // element has to be measured — and starts scrolled to its top.
  useLayoutEffect(() => {
    if (!element) return;
    setScrollTop(element.scrollTop);
    setViewport(element.clientHeight);
    const observer = new ResizeObserver(() => setViewport(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  const onScroll = useCallback((event: UIEvent<T>) => setScrollTop(event.currentTarget.scrollTop), []);

  // A short list is rendered whole, as it always was — the browser's own find
  // still reaches every row — and only a long one is windowed.
  const windowed = count > WINDOW_FROM;
  // Before the first measurement, assume a generous viewport rather than none.
  const height = viewport || rowHeight * 30;
  const first = windowed ? Math.max(0, Math.min(count, Math.floor(scrollTop / rowHeight) - overscan)) : 0;
  const last = windowed ? Math.max(first, Math.min(count, Math.ceil((scrollTop + height) / rowHeight) + overscan)) : count;

  return {
    ref: setElement,
    element,
    onScroll,
    /** For code that scrolls the element itself (keyboard navigation), so the window follows at once. */
    setScrollTop,
    /** Rows [first, last) are the ones to render. */
    first,
    last,
    /** Heights of the spacers before and after them. */
    before: first * rowHeight,
    after: (count - last) * rowHeight,
  };
}
