export interface SwipePoint {
  x: number;
  y: number;
  /** Milliseconds, from any clock */
  time: number;
}

/** What makes a touch a swipe between heats: a deliberate, quick, mostly horizontal stroke over a good part of the screen, or a short but fast flick. */
export const SWIPE = {
  /** At least this far, in pixels, and at least this fraction of the viewport width */
  minDistance: 80,
  minFraction: 0.25,
  /** The horizontal distance is at least this many times the vertical one, so scrolling never counts */
  dominance: 2.5,
  /** A fast flick counts over a shorter stretch: at least this far, in pixels, at this speed in pixels per millisecond */
  flickDistance: 48,
  flickSpeed: 0.6,
  /** Slower strokes are drags or text selection, not swipes */
  maxMs: 700,
} as const;

/** 1 for a swipe to the left (on to the next heat), -1 for a swipe to the right (back to the previous one), 0 when the stroke is no swipe. */
export function swipeDirection(start: SwipePoint, end: SwipePoint, viewportWidth: number): -1 | 0 | 1 {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (end.time - start.time > SWIPE.maxMs) return 0;
  const ms = Math.max(1, end.time - start.time);
  const flick = Math.abs(dx) >= SWIPE.flickDistance && Math.abs(dx) / ms >= SWIPE.flickSpeed;
  if (!flick && Math.abs(dx) < Math.max(SWIPE.minDistance, SWIPE.minFraction * viewportWidth)) return 0;
  if (Math.abs(dx) < SWIPE.dominance * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}
