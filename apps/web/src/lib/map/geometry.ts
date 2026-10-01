// Placing a vehicle pointer along a fleet map connection, with the same maths the Figma map used
// (point(t) and angle(t) in the design's map-fleet-overview.js). A connection's points are evenly spaced samples
// of its curve, so t runs from 0 at the depot to 1 at the district centre.

type Point = readonly [number, number];

// The point a fraction t of the way along the samples, straight between the two samples either side.
// t is held between 0 and 1.
export function pointAt(points: readonly Point[], t: number): [number, number] {
  if (points.length < 2) throw new RangeError('A connection needs at least two points.');
  const f = Math.min(1, Math.max(0, t)) * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(f));
  const u = f - i;
  return [points[i][0] * (1 - u) + points[i + 1][0] * u, points[i][1] * (1 - u) + points[i + 1][1] * u];
}

// The direction of travel at t, in degrees, as the rotation for a pointer drawn with its tip up: 0 heads up the
// screen, 90 right, 180 down. It looks a hundredth of the way either side of t, held inside the ends.
export function angleAt(points: readonly Point[], t: number): number {
  const a = pointAt(points, Math.max(0, t - 0.01));
  const b = pointAt(points, Math.min(1, t + 0.01));
  return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI + 90;
}
