import {divergentDefinitions} from './divergent';
import {simulationDefinitions} from './simulation';
import type { ParameterManifest } from "../core";
import { orbitDefinition } from "./orbit";
import { contourDefinition } from "./contour";
import { geometryDefinitions } from "./geometry";
import { instrumentDefinitions } from "./instruments";

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
  step,
  default: value,
  modulatable,
});
export const generatorDefinitions = {
  operator: {
    label: 'Operator Bloom', category: 'Generators',
    params: {
      mode: p('Interaction', 0, 1, 0, 1, false),
      carrier: p('Carrier waveform', 0, 3, 0, 1, false),
      modulator: p('Modulator waveform', 0, 3, 0, 1, false),
      frequency: p('Carrier cycles', 1, 32, 8),
      ratio: p('Modulator ratio', 0.125, 8, 1.5),
      depth: p('Modulation depth', 0, 12, 2.4),
      angle: p('Carrier direction', -Math.PI, Math.PI, 0),
      crossing: p('Modulator direction', -Math.PI, Math.PI, 1.15),
      offset: p('Modulator phase', -Math.PI, Math.PI, 0),
      smoothing: p('Harmonic smoothing', 0, 1, 0.2),
      width: p('Contour width', 0.03, 0.6, 0.12),
      palette: p('Palette', 0, 8, 6, 1, false),
    },
  },
  ...divergentDefinitions,
  ...simulationDefinitions,
  ...geometryDefinitions,
  ...instrumentDefinitions,
  silk: {
    label: "Interference Silk",
    category: "Generators",
    params: {
      fold: p("Fold", 0, 1, 0.65),
      density: p("Thread density", 12, 100, 34, 1),
      palette: p("Palette", 0, 8, 6, 1, false),
      layers: p("Learning stage", 1, 3, 3, 1, false),
      offset: p("Phase offset", -Math.PI, Math.PI, 0),
      ratio: p("Frequency ratio", 0.25, 4, 8.2 / 4.8),
      strength: p("Pole strength", 0, 1, 0.35),
      mode: p("Pole mode", 0, 3, 0, 1, false),
      ax: p("Pole A X", 0, 1, 0.35),
      ay: p("Pole A Y", 0, 1, 0.45),
      bx: p("Pole B X", 0, 1, 0.65),
      by: p("Pole B Y", 0, 1, 0.55),
      crossing: p("Line structure", 0, 3, 3, 1, false),
      angle: p(
        "Crossing angle",
        (5 * Math.PI) / 180,
        (175 * Math.PI) / 180,
        (55 * Math.PI) / 180,
      ),
      mixAmount: p("Mutation blend", 0, 1, 1),
    },
  },
  lattice: {
    label: "Lattice Choir",
    category: "Generators",
    params: {
      density: p("Cell density", 4, 48, 18, 1),
      fold: p("Field warp", 0, 1, 0.45),
      palette: p("Palette", 0, 8, 7, 1, false),
      offset: p("Phase offset", -Math.PI, Math.PI, 0),
      ratio: p("Interference ratio", 0.25, 4, 1.5),
      morph: p("Grid / dots / rings", 0, 1, 0.55),
    },
  },
  orbit: { category: "Generators", ...orbitDefinition },
  contour: { category: "Generators", ...contourDefinition },
};
export type GeneratorType = keyof typeof generatorDefinitions;
export const generatorIds = Object.keys(
  generatorDefinitions,
) as GeneratorType[];
