export interface MidiProfile {
  id: string;
  name: string;
  match: RegExp;
  knobs: number[];
  morph: number;
  pads: number[];
  tilt?: number[];
}

const genericPads = Array.from({ length: 16 }, (_, i) => 36 + i);

// Best-known factory defaults for the author's controllers. These numbers are
// unverified on the physical hardware; learn mode remains the ground truth.
export const profiles: MidiProfile[] = [
  {
    id: "launch-control-xl",
    name: "Novation Launch Control XL",
    match: /\b(launch\s*control\s*xl|lcxl\d*)\b/i,
    knobs: [13, 14, 15],
    morph: 77,
    pads: [41, 42, 43, 44, 57, 58, 59, 60, 73, 74, 75, 76, 89, 90, 91, 92],
  },
  {
    id: "launch-control",
    name: "Novation Launch Control",
    match: /\blaunch\s*control\b/i,
    knobs: [21, 22, 23],
    morph: 41,
    pads: [9, 10, 11, 12, 25, 26, 27, 28],
  },
  {
    id: "launchkey",
    name: "Novation Launchkey",
    match: /\blaunchkey\b/i,
    knobs: [21, 22, 23],
    morph: 1,
    pads: genericPads,
  },
  {
    id: "launchpad",
    name: "Novation Launchpad",
    match: /\blaunchpad\b/i,
    knobs: [21, 22, 23],
    morph: 1,
    pads: [11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28],
  },
  {
    id: "midi-fighter-3d",
    name: "DJ TechTools MIDI Fighter 3D",
    match: /\b(midi\s*fighter|mf3d)\b/i,
    knobs: [21, 22, 23],
    morph: 0,
    pads: genericPads,
    // Tilt/motion CC 0-3 on channel 4 is a best-known, unverified default.
    tilt: [0, 1, 2, 3],
  },
  {
    id: "generic",
    name: "Generic MIDI",
    match: /.*/,
    knobs: [21, 22, 23],
    morph: 1,
    pads: genericPads,
  },
];

export function pickProfile(inputNames: string[]): MidiProfile {
  const names = inputNames.filter(Boolean);
  return profiles.find((profile) => profile.id !== "generic" && names.some((name) => profile.match.test(name)))
    ?? profiles.find((profile) => profile.id === "generic")!;
}
