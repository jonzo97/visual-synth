import { expect, it } from "vitest";
import {
  EXPORT_MAX_DIMENSION,
  EXPORT_MAX_PIXELS,
  exportSizeFor,
  shareFormats,
  type ShareFormatId,
} from "./share-formats";

it("keeps every share format id unique", () => {
  expect(new Set(shareFormats.map((format) => format.id)).size).toBe(shareFormats.length);
});

it("returns even dimensions for every format and scale", () => {
  for (const format of shareFormats) {
    for (const scale of [2 / 3, 1, 4 / 3, 2]) {
      const [width, height] = exportSizeFor(format.id, scale);
      expect(width % 2).toBe(0);
      expect(height % 2).toBe(0);
    }
  }
});

it("maps social baseline sizes and resolution scales", () => {
  expect(exportSizeFor("landscape")).toEqual([1920, 1080]);
  expect(exportSizeFor("vertical")).toEqual([1080, 1920]);
  expect(exportSizeFor("square")).toEqual([1080, 1080]);
  expect(exportSizeFor("portrait")).toEqual([1080, 1350]);
  expect(exportSizeFor("vertical", 1440 / 1080)).toEqual([1440, 2560]);
});

it("caps oversized requests to the encoder limits", () => {
  for (const id of shareFormats.map((format) => format.id as ShareFormatId)) {
    const [width, height] = exportSizeFor(id, 10);
    expect(width).toBeLessThanOrEqual(EXPORT_MAX_DIMENSION);
    expect(height).toBeLessThanOrEqual(EXPORT_MAX_DIMENSION);
    expect(width * height).toBeLessThanOrEqual(EXPORT_MAX_PIXELS);
  }
});
