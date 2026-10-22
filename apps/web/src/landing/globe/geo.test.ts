import { describe, expect, it } from "vitest";
import { fromLatLon, toLatLon } from "./geo";

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
});
