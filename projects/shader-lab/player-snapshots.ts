import { presetCatalog, type CatalogPreset } from "./preset-catalog";
import { performanceBank } from "./performance-bank";
import { geminiPlayerSnapshots } from "./gemini-library";

// Newest instruments first; the frozen release catalog follows.
const newest = ["Instruments", "Geometry Studies", "Gemini"];

export function playerSnapshots(): CatalogPreset[] {
  const banked = [...geminiPlayerSnapshots, ...performanceBank];
  return [
    ...newest.flatMap((bank) => banked.filter((preset) => preset.bank === bank)),
    ...banked.filter((preset) => !newest.includes(preset.bank)),
    ...presetCatalog,
  ];
}
