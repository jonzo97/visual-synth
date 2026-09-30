import type { ParameterManifest } from "../core";

const p = (
  label: string,
  min: number,
  max: number,
  value: number,
  step = 0.01,
  modulatable = true,
): ParameterManifest => ({ label, min, max, default: value, step, modulatable });

/** Numeric modes keep patches portable; these are image maps, not physical fields. */
export const effectDefinitions = {
  "fx.warp": {
    label: "Field Warp",
    category: "Effects",
    frameInputs: ["in", "field"],
    params: {
      amount: p("Dry / wet", 0, 1, 1),
      strength: p("Displacement (UV)", 0, 0.5, 0.08),
      mode: p("Field: gradient / RG", 0, 1, 0, 1, false),
      boundary: p("Edges: clamp / wrap / mirror", 0, 2, 1, 1, false),
    },
  },
  "fx.mask": {
    label: "Mask Mixer",
    category: "Effects",
    frameInputs: ["in", "b", "mask"],
    params: {
      amount: p("Dry / wet", 0, 1, 1),
      mix: p("Layer B mix", 0, 1, 0.5),
      threshold: p("Mask threshold", 0, 1, 0.5),
      softness: p("Mask softness", 0, 1, 0.1),
      invert: p("Invert mask", 0, 1, 0, 1, false),
      blend: p("Blend: crossfade / multiply / difference", 0, 2, 0, 1, false),
    },
  },
  "fx.fold": {
    label: "Tone Fold",
    category: "Effects",
    frameInputs: ["in"],
    params: {
      amount: p("Dry / wet", 0, 1, 0.65),
      mode: p("Transfer: solarize / fold", 0, 1, 1, 1, false),
      folds: p("Fold count", 1, 8, 2, 0.01),
      threshold: p("Solarize pivot", 0.05, 0.95, 0.5),
      offset: p("Fold offset", -1, 1, 0),
      channels: p("Transfer: luma / RGB", 0, 1, 0, 1, false),
    },
  },
  "fx.kaleido": {
    label: "Kaleidoscope",
    category: "Effects",
    frameInputs: ["in"],
    params: {
      amount: p("Dry / wet", 0, 1, 1),
      segments: p("Wedges", 2, 16, 6, 1, false),
      rotation: p("Rotation (rad)", -3.1416, 3.1416, 0),
      zoom: p("Zoom", 0.25, 3, 1),
      twist: p("Spiral twist", -1, 1, 0),
    },
  },
  "fx.morph": {
    label: "Ink Morphology",
    category: "Effects",
    frameInputs: ["in"],
    params: {
      amount: p("Dry / wet", 0, 1, 1),
      mode: p("Operation: dilate / erode / outline", 0, 2, 2, 1, false),
      kernel: p("Kernel: 3×3 / 5×5", 0, 1, 0, 1, false),
      radius: p("Sample spacing (px)", 1, 4, 1, 1),
      lumaOnly: p("Output: source color / luma", 0, 1, 0, 1, false),
    },
  },
  "fx.chrono": {
    label: "Chrono Loom",
    category: "Effects",
    frameInputs: ["in"],
    params: {
      amount: p("Dry / wet", 0, 1, 0.8),
      seconds: p("Age span (s, 15 Hz)", 0, 31 / 15, 1.2),
      mode: p("Age field: horizontal / vertical / radial", 0, 2, 0, 1, false),
      spread: p("RGB age spread (s)", 0, 1, 0),
    },
  },
  "fx.hyperbolic": {
    label: "Hyperbolic Map",
    category: "Effects",
    frameInputs: ["in"],
    params: {
      amount: p("Dry / wet", 0, 1, 1),
      sides: p("Polygon sides p", 3, 12, 7, 1, false),
      meet: p("Polygons per vertex q", 3, 12, 3, 1, false),
      zoom: p("Disk zoom", 0.5, 3, 1),
      drift: p("Möbius drift", 0, 0.65, 0.35),
      spin: p("Spin turns per loop", -3, 3, 0, 1, false),
      scale: p("Input area per tile", 0.05, 2, 0.3),
      rotation: p("Texture rotation", -Math.PI, Math.PI, 0),
      edge: p("Seam darkness", 0, 1, 0.4),
      surround: p("Outside the disk: black / input", 0, 1, 0),
    },
  },
  "fx.droste": {
    label: "Droste Zoom",
    category: "Effects",
    frameInputs: ["in"],
    params: {
      amount: p("Dry / wet", 0, 1, 1),
      ratio: p("Scale ratio", 1.5, 8, 3),
      arms: p("Spiral arms", 0, 3, 1, 1, false),
      zoom: p("Zoom turns per loop", -4, 4, 1, 1, false),
      spin: p("Spin turns per loop", -3, 3, 0, 1, false),
      outer: p("Ring radius", 0.2, 0.9, 0.48),
      soft: p("Seam softness", 0, 0.5, 0.2),
    },
  },
  "fx.marble": {
    label: "Ink Marbling",
    category: "Effects",
    frameInputs: ["in"],
    params: {
      amount: p("Dry / wet", 0, 1, 1),
      strength: p("Drag strength (UV)", 0, 0.3, 0.08),
      warp: p("Noise bends noise", 0, 6, 3.5),
      scale: p("Vein scale", 0.5, 8, 2.4),
      flow: p("Flow orbit", 0, 2, 0.6),
      veins: p("Ink veins", 0, 1, 0.2),
      bands: p("Vein bands", 2, 14, 5),
    },
  },
  "fx.feedback": {
    label: "Feedback Chamber",
    category: "Effects",
    frameInputs: ["in"],
    params: {
      amount: p("Dry / wet", 0, 1, 0.7),
      zoom: p("Feedback zoom", 0.9, 1.1, 1.006, 0.001),
      rotate: p("Rotation per tick (rad)", -0.1, 0.1, 0.002, 0.001),
      shiftX: p("Horizontal shift per tick", -0.05, 0.05, 0, 0.001),
      shiftY: p("Vertical shift per tick", -0.05, 0.05, 0, 0.001),
      decay: p("History retention", 0, 0.999, 0.96, 0.001),
      injection: p("Source injection", 0, 1, 0.12),
      hue: p("Hue drift per tick (rad)", -0.25, 0.25, 0, 0.001),
      lighten: p("Composite: crossfade / lighten", 0, 1, 0, 1, false),
      centerX: p("Tunnel centre X", 0, 1, 0.5),
      centerY: p("Tunnel centre Y", 0, 1, 0.5),
    },
  },
};

export type EffectType = keyof typeof effectDefinitions;
