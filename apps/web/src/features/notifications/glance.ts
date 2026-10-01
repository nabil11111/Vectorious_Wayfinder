// How the driver's glanceable answer goes (spec 025, AC-3b): by itself after 8 seconds, or at a tap or a swipe, a move
// of the finger this far in any direction.
export const GLANCE_MS = 8000;
const SWIPE_PX = 40;
export const swiped = (dx: number, dy: number) => Math.hypot(dx, dy) >= SWIPE_PX;
