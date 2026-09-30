import warp from "./warp.wgsl?raw";
import mask from "./mask.wgsl?raw";
import fold from "./fold.wgsl?raw";
import kaleido from "./kaleido.wgsl?raw";
import morph from "./morph.wgsl?raw";
import chrono from "./chrono.wgsl?raw";
import feedback from "./feedback.wgsl?raw";
import hyperbolic from "./hyperbolic.wgsl?raw";
import marble from "./marble.wgsl?raw";
import droste from "./droste.wgsl?raw";
import { labBindings, labEffectShaders, isLabEffect } from "../lab-device";
export const effectShaders: Record<string, string> = {
  "fx.warp": warp,
  "fx.mask": mask,
  "fx.fold": fold,
  "fx.kaleido": kaleido,
  "fx.morph": morph,
  "fx.chrono": chrono,
  "fx.feedback": feedback,
  "fx.hyperbolic": hyperbolic,
  "fx.marble": marble,
  "fx.droste": droste,
  ...labEffectShaders,
};
const inputs: Record<string, string[]> = {
  "fx.warp": ["src", "field", "samp", "params"],
  "fx.mask": ["src", "b", "mask", "samp", "params"],
  "fx.fold": ["src", "samp", "params"],
  "fx.kaleido": ["src", "samp", "params"],
  "fx.morph": ["src", "samp", "params"],
  "fx.chrono": ["src", "history", "samp", "params"],
  "fx.feedback": ["src", "history", "samp", "params"],
  "fx.hyperbolic": ["src", "samp", "params"],
  "fx.marble": ["src", "samp", "params"],
  "fx.droste": ["src", "samp", "params"],
};
export function effectBindings(type: string, values: Record<string, any>) {
  if (isLabEffect(type)) return labBindings(type, values);
  return Object.fromEntries(
    inputs[type]!.filter((key) => key in values).map((key) => [
      key,
      values[key],
    ]),
  );
}
