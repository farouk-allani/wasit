import { describe, expect, it } from "vitest";
import { fibonacciPoint, fromLatLon, toLatLon } from "./geo";
import { isLand, LAND_SAMPLES } from "./landMask";

describe("globe geometry", () => {
  it("round-trips latitude and longitude", () => {
    for (const [lat, lon] of [
      [0, 0],
      [36.75, 3.06],
      [-33.9, 18.4],
      [25.2, 55.3],
      [41.0, 28.97],
    ] as const) {
      const back = toLatLon(fromLatLon(lat, lon));
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lon).toBeCloseTo(lon, 9);
    }
  });

  it("puts lattice points on the unit sphere", () => {
    for (const i of [0, 1, 777, LAND_SAMPLES - 1]) {
      const [x, y, z] = fibonacciPoint(i, LAND_SAMPLES);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
    }
  });

  it("marks land where land is and sea where sea is", () => {
    const nearest = (lat: number, lon: number) => {
      const [tx, ty, tz] = fromLatLon(lat, lon);
      let best = 0;
      let bestDot = -2;
      for (let i = 0; i < LAND_SAMPLES; i++) {
        const [x, y, z] = fibonacciPoint(i, LAND_SAMPLES);
        const dot = x * tx + y * ty + z * tz;
        if (dot > bestDot) [best, bestDot] = [i, dot];
      }
      return best;
    };
    expect(isLand(nearest(9, 20))).toBe(true); // Chad, central Africa
    expect(isLand(nearest(45, 100))).toBe(true); // Mongolia
    expect(isLand(nearest(-10, -55))).toBe(true); // Brazil
    expect(isLand(nearest(0, -30))).toBe(false); // mid-Atlantic
    expect(isLand(nearest(-20, 80))).toBe(false); // Indian Ocean
  });
});
