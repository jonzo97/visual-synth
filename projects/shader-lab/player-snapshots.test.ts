import { describe, expect, it } from "vitest";
import rawGeminiLibrary from "./library/gemini-racks.json";
import { playerSnapshots } from "./player-snapshots";

const NON_GEMINI_SNAPSHOT_COUNT = 52;
const rawCuratedGeminiInstruments = rawGeminiLibrary.items
  .filter((item) => item.kind === "instrument" && item.status === "curated")
  .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
const rawCandidateGeminiInstrumentIds = rawGeminiLibrary.items
  .filter((item) => item.kind === "instrument" && item.status === "candidate")
  .map((item) => item.id);

describe("player snapshots", () => {
  it("adds curated Gemini instruments and keeps candidates out", () => {
    const snapshots = playerSnapshots();
    const gemini = snapshots.filter((snapshot) => snapshot.bank === "Gemini");
    expect(snapshots).toHaveLength(NON_GEMINI_SNAPSHOT_COUNT + rawCuratedGeminiInstruments.length);
    expect(gemini.map((snapshot) => snapshot.id)).toEqual(rawCuratedGeminiInstruments.map((item) => item.id));
    for (const id of rawCandidateGeminiInstrumentIds)
      expect(snapshots.some((snapshot) => snapshot.id === id)).toBe(false);
    expect(gemini.every((snapshot) => snapshot.controls.length === 3)).toBe(true);
  });
});
