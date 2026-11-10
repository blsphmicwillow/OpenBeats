/** Axis-aligned edge auto-scroll shared by the timeline editors. */
export type ScrollEdge = 'left' | 'right' | 'top' | 'bottom';

export interface EdgeScrollOptions {
  /** Distance from an edge that starts scrolling, in pixels. */
  zone?: number;
  /** Top speed in pixels per frame. */
  maxSpeed?: number;
  x?: boolean;
  y?: boolean;
}

export interface ScrollDelta {
  dx: number;
  dy: number;
  edge: ScrollEdge | null;
}

/** Speed in px per frame for one axis; negative scrolls back towards the start. */
export function edgeSpeed(pos: number, min: number, max: number, zone: number, maxSpeed: number): number {
  if (zone <= 0 || max <= min) return 0;
  if (pos < min + zone) return -maxSpeed * Math.min(1, (min + zone - pos) / zone);
  if (pos > max - zone) return maxSpeed * Math.min(1, (pos - (max - zone)) / zone);
  return 0;
}

/**
 * Applies one frame of edge scrolling to a scroll container and reports what
 * actually scrolled, so a drag can keep its item under the pointer. The caller
 * owns the animation loop and decides when the pointer is close enough.
 */
export function scrollAtEdges(
  el: HTMLElement,
  pointerX: number,
  pointerY: number,
  options: EdgeScrollOptions = {},
): ScrollDelta {
  const { zone = 64, maxSpeed = 22, x = true, y = true } = options;
  const rect = el.getBoundingClientRect();
  let dx = 0;
  let dy = 0;

  if (x) {
    const before = el.scrollLeft;
    const speed = edgeSpeed(pointerX, rect.left, rect.right, zone, maxSpeed);
    if (speed) {
      el.scrollLeft = Math.max(0, before + speed);
      dx = el.scrollLeft - before;
    }
  }
  if (y) {
    const before = el.scrollTop;
    const speed = edgeSpeed(pointerY, rect.top, rect.bottom, zone, maxSpeed);
    if (speed) {
      el.scrollTop = Math.max(0, before + speed);
      dy = el.scrollTop - before;
    }
  }

  const edge: ScrollEdge | null =
    dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'top' : dy > 0 ? 'bottom' : null;
  return { dx, dy, edge };
}
