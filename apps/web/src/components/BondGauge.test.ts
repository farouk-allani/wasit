import { describe, expect, it } from "vitest";
import { coverageZone } from "./BondGauge";

describe("coverageZone", () => {
  it("uses the thresholds as inclusive lower bounds of the safer zone", () => {
    expect(coverageZone(13_000, 13_000, 11_500)).toBe("healthy");
    expect(coverageZone(12_999, 13_000, 11_500)).toBe("topUp");
    expect(coverageZone(11_500, 13_000, 11_500)).toBe("topUp");
    expect(coverageZone(11_499, 13_000, 11_500)).toBe("protect");
    expect(coverageZone(9_000, 13_000, 11_500)).toBe("protect");
  });
});
