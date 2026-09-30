import pulse from './pulse.wgsl?raw';
import operator from './operator.wgsl?raw';
import cells from './cells.wgsl?raw';
import resonance from './resonance.wgsl?raw';
import rules from './rules.wgsl?raw';
import chemical from './chemical.wgsl?raw';
import silk from "../silk.wgsl?raw";
import lattice from "../lattice.wgsl?raw";
import orbit from "./orbit.wgsl?raw";
import contour from "./contour.wgsl?raw";
import hyperbolic from "./hyperbolic.wgsl?raw";
import quasicrystal from "./quasicrystal.wgsl?raw";
import polytope from "./polytope.wgsl?raw";
import multigrid from "./multigrid.wgsl?raw";
import attractor from "./attractor.wgsl?raw";
import complex from "./complex.wgsl?raw";
import julia from "./julia.wgsl?raw";
import slime from "./slime.wgsl?raw";
import ink from "./ink.wgsl?raw";
import fizz from "./fizz.wgsl?raw";
import type { GeneratorType } from "./catalog";
import { labSourceShaders, type LabDeviceType } from "../lab-device";

/** Shader code stays out of the portable graph/manifest layer. */
export const generatorShaders: Record<GeneratorType | LabDeviceType, string> = {
  operator,
  pulse,cells,resonance,rules,chemical,
  silk,
  lattice,
  orbit,
  contour,
  hyperbolic,
  quasicrystal,
  polytope,
  multigrid,
  attractor,
  complex,
  julia,
  slime,
  ink,
  fizz,
  ...labSourceShaders,
};
