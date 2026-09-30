import { describe, expect, it } from "vitest";
import { outputSize, sizeLadder } from "./display-size";

const aspect = ([w, h]: [number, number]) => w / h;

describe("outputSize", () => {
  it("returns native 2K pixels at dpr 1", () => {
    expect(outputSize({ cssWidth: 2560, cssHeight: 1440, dpr: 1, maxDimension: 8192 })).toEqual([2560, 1440]);
  });

  it("caps scaled desktop output to the 2K pixel budget while keeping 16:9", () => {
    const size = outputSize({ cssWidth: 1920, cssHeight: 1080, dpr: 1.25, maxDimension: 8192 });
    expect(size[0] * size[1]).toBeLessThanOrEqual(2560 * 1440);
    expect(aspect(size)).toBeCloseTo(16 / 9, 2);
  });

  it("keeps 4K below the default cap and allows it with a 4K cap", () => {
    expect(outputSize({ cssWidth: 3840, cssHeight: 2160, dpr: 1, maxDimension: 8192 })).toEqual([2560, 1440]);
    expect(outputSize({ cssWidth: 3840, cssHeight: 2160, dpr: 1, maxDimension: 8192, maxPixels: 3840 * 2160 })).toEqual([3840, 2160]);
  });

  it("keeps portrait phone aspect", () => {
    const size = outputSize({ cssWidth: 390, cssHeight: 844, dpr: 3, maxDimension: 8192 });
    expect(aspect(size)).toBeCloseTo(390 / 844, 2);
  });

  it("respects maxDimension", () => {
    const size = outputSize({ cssWidth: 4000, cssHeight: 2000, dpr: 1, maxDimension: 1024, maxPixels: 4000 * 2000 });
    expect(size[0]).toBeLessThanOrEqual(1024);
    expect(size[1]).toBeLessThanOrEqual(1024);
  });

  it("rounds to multiples of 8", () => {
    const size = outputSize({ cssWidth: 1234, cssHeight: 777, dpr: 1.3, maxDimension: 8192 });
    expect(size[0] % 8).toBe(0);
    expect(size[1] % 8).toBe(0);
  });
});

describe("sizeLadder", () => {
  it("decreases strictly", () => {
    const ladder = sizeLadder([2560, 1440]);
    expect(ladder[0]).toEqual([2560, 1440]);
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]![0] * ladder[i]![1]).toBeLessThan(ladder[i - 1]![0] * ladder[i - 1]![1]);
    }
  });
});
