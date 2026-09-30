import { describe, expect, test } from "vitest";
import { pickProfile, profiles } from "./midi-profiles";

describe("pickProfile", () => {
  test.each([
    ["Launch Control XL", "launch-control-xl"],
    ["LCXL3 1 MIDI", "launch-control-xl"],
    ["Launchkey Mini MK3 MIDI", "launchkey"],
    ["Midi Fighter 3D", "midi-fighter-3d"],
    ["Launchpad X", "launchpad"],
    ["unknown", "generic"],
  ])("chooses %s", (name, id) => {
    expect(pickProfile([name]).id).toBe(id);
  });
});

describe("profiles", () => {
  test("all profiles expose three macro knobs and unique pad notes", () => {
    for (const profile of profiles) {
      expect(profile.knobs, profile.id).toHaveLength(3);
      expect(new Set(profile.pads).size, profile.id).toBe(profile.pads.length);
    }
  });
});
