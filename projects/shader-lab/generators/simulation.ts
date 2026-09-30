import type { ParameterManifest } from "../core";
const p = (
  label: string,
  min: number,
  max: number,
  value: number,
  step = 0.01,
  modulatable = true,
): ParameterManifest => ({
  label,
  min,
  max,
  default: value,
  step,
  modulatable,
});
const common = () => ({
  seed: {...p("Seed", 0, 65535, 42, 1, false),recordable:false},
  grid: {...p("Simulation grid", 128, 512, 256, 128, false),recordable:false},
  palette: p("Palette", 0, 8, 6, 1, false),
});
export const simulationDefinitions = {
  rules: {
    label: "Rule Garden",
    category: "Generators",
    params: {
      ...common(),
      states: {...p("Color states", 3, 24, 12, 1, false),recordable:false},
      threshold: p("Neighbor threshold", 1, 8, 1, 1, false),
      neighborhood: p("Moore / cross", 0, 1, 0, 1, false),
      rate: p("Ticks per second", 1, 30, 10, 1, false),
    },
  },
  chemical: {
    label: "Chemical Garden",
    category: "Generators",
    params: {
      ...common(),
      feed: p("Feed", 0.01, 0.08, 0.029, 0.001),
      kill: p("Kill", 0.03, 0.075, 0.057, 0.001),
      diffusionU: p("Diffusion U", 0.05, 0.22, 0.16, 0.005),
      diffusionV: p("Diffusion V", 0.02, 0.12, 0.08, 0.005),
      steps: p("Growth speed", 1, 8, 4, 1, false),
    },
  },
  slime: {
    label: "Slime Mold Wars",
    category: "Generators",
    params: {
      ...common(),
      species: p("Species", 1, 3, 3, 1, false),
      agents: p("Agent population", 0.1, 1, 0.8),
      sensorAngle: p("Sensor angle", 0.1, 1.4, 0.55),
      sensorDistance: p("Sensor distance (cells)", 2, 30, 9),
      turn: p("Turn speed", 0.05, 1, 0.35),
      speed: p("Agent speed (cells per step)", 0.3, 3, 1),
      deposit: p("Trail deposit", 0.5, 8, 3),
      aggression: p("Rival repulsion", 0, 3, 1.2),
      decay: p("Trail persistence", 0.8, 0.995, 0.93, 0.001),
      diffuse: p("Trail diffusion", 0, 1, 0.5),
      steps: p("Steps per tick", 1, 4, 2, 1, false),
      exposure: p("Exposure", 0.2, 4, 1),
    },
  },
  ink: {
    label: "Ink in Water",
    category: "Generators",
    params: {
      ...common(),
      curl: p("Vorticity (curl)", 0, 40, 14),
      stir: p("Stirrer strength", 0, 3, 1),
      emitters: p("Ink stirrers", 1, 4, 3, 1, false),
      swirl: p("Stirrer speed", 0.1, 3, 0.8),
      drag: p("Water memory", 0.9, 1, 0.995, 0.001),
      fade: p("Ink persistence", 0.95, 1, 0.996, 0.001),
      ink: p("Ink flow", 0, 3, 1),
      exposure: p("Exposure", 0.2, 4, 1),
    },
  },
};
export const isSimulation = (type: string): type is "rules" | "chemical" | "slime" | "ink" =>
  type === "rules" || type === "chemical" || type === "slime" || type === "ink";
