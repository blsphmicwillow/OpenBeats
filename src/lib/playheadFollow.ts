/**
 * Keeps the playhead in view while the transport rolls.
 *
 * The marker is measured in screen space, so it works whether the surface
 * scrolls horizontally, vertically, or both, and regardless of track headers.
 */
export function keepPlayheadVisible(
  surface: HTMLElement | null,
  selector = '.playhead-line',
  margin = 64,
): void {
  if (!surface) return;
  const marker = surface.querySelector<HTMLElement>(selector);
  if (!marker) return;
  const view = surface.getBoundingClientRect();
  const box = marker.getBoundingClientRect();
  if (box.left < view.left + margin) {
    surface.scrollLeft = Math.max(0, surface.scrollLeft - (view.left + margin - box.left));
  } else if (box.right > view.right - margin) {
    surface.scrollLeft += box.right - (view.right - margin);
  }
}
