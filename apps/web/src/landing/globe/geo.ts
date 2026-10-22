/**
 * Sphere geometry shared by the land-mask generator (Node) and the globe (browser), so the
 * generated mask and the rendered dots agree on every point. Unit sphere, y up, longitude 0 at +x,
 * east toward -z (three.js is right-handed with the camera looking down -z).
 */

export type Vec3 = readonly [x: number, y: number, z: number];

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Point `i` of an `n`-point Fibonacci lattice: near-uniform spacing, no pole clustering. */
export function fibonacciPoint(i: number, n: number): Vec3 {
  const y = 1 - ((i + 0.5) * 2) / n;
  const r = Math.sqrt(1 - y * y);
  const theta = i * GOLDEN_ANGLE;
  return [Math.cos(theta) * r, y, Math.sin(theta) * r];
}

const DEG = Math.PI / 180;

export function toLatLon([x, y, z]: Vec3): { lat: number; lon: number } {
  return { lat: Math.asin(y) / DEG, lon: Math.atan2(-z, x) / DEG };
}

export function fromLatLon(lat: number, lon: number): Vec3 {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  return [Math.cos(phi) * Math.cos(lambda), Math.sin(phi), -Math.cos(phi) * Math.sin(lambda)];
}
