import type { ParameterManifest } from "./core";
import library from "./library/lab-devices.json";

export type LabDeviceKind = "effect" | "source";
export type LabDeviceStatus = "curated" | "candidate";
export type LabDeviceType = "lab.ripple" | "lab.moire";

export interface LabParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
}

export interface LabDeviceSpec {
  id: LabDeviceType | `lab.${string}`;
  name: string;
  kind: LabDeviceKind;
  status: LabDeviceStatus;
  description: string;
  params: LabParamSpec[];
  wgsl: string;
  source: { tool: string; run: string; model: string };
  added: string;
}

export interface LabLibrary {
  version: 1;
  devices: LabDeviceSpec[];
}

const MAX_BODY_LENGTH = 6000;
const ID_RE = /^lab\.[a-z0-9-]{3,40}$/;
const LAB_MAIN_RE = /fn\s+labMain\s*\(\s*uv\s*:\s*vec2f\s*\)\s*->\s*vec4f\b/;
export const rejectedLabTokens = [
  "@group", "@binding", "@compute", "@vertex", "@fragment", "@workgroup_size",
  "var<storage", "var<uniform", "var<workgroup", "var<private", "enable",
  "requires", "diagnostic", "textureStore", "atomic", "ptr<", "while", "loop",
] as const;

const p = (param: LabParamSpec): ParameterManifest => ({
  label: param.label,
  min: param.min,
  max: param.max,
  default: param.default,
  step: 0.01,
  modulatable: true,
});

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stripComments(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function matchingParen(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function loopIterations(start: number, op: "<" | "<=", limit: number, step: number): number {
  if (step <= 0) return Infinity;
  const span = op === "<" ? limit - start : limit - start + 1;
  return Math.max(0, Math.ceil(span / step));
}

function validateLoops(body: string): string[] {
  const errors: string[] = [];
  const loops: { start: number; end: number; iterations: number }[] = [];
  const forRe = /\bfor\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = forRe.exec(body))) {
    const parenOpen = body.indexOf("(", match.index);
    const parenClose = matchingParen(body, parenOpen);
    if (parenClose < 0) {
      errors.push("for loop is missing a closing parenthesis");
      continue;
    }
    const header = body.slice(parenOpen + 1, parenClose).trim();
    const loopRe = /^var\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\d+)\s*;\s*\1\s*(<|<=)\s*(\d+)\s*;\s*(?:\1\s*\+\+|\1\s*\+=\s*(\d+))$/;
    const parsed = loopRe.exec(header);
    if (!parsed) {
      errors.push("for loops must use a bounded integer-literal counter shape");
      continue;
    }
    const start = Number(parsed[2]);
    const op = parsed[3] as "<" | "<=";
    const limit = Number(parsed[4]);
    const step = parsed[5] ? Number(parsed[5]) : 1;
    const iterations = loopIterations(start, op, limit, step);
    if (iterations > 64) errors.push("for loop exceeds 64 iterations");
    const braceOpen = body.indexOf("{", parenClose);
    if (braceOpen < 0) {
      errors.push("for loop is missing a block body");
      continue;
    }
    const braceEnd = matchingBrace(body, braceOpen);
    if (braceEnd < 0) {
      errors.push("for loop block is missing a closing brace");
      continue;
    }
    // The bound only holds if the body never rewinds the counter, directly or through a pointer.
    const counter = parsed[1]!;
    const block = body.slice(braceOpen + 1, braceEnd);
    const writes = new RegExp(String.raw`&\s*${counter}\b|\b${counter}\s*(?:=(?!=)|[-+*/%&|^]=|<<=|>>=|\+\+|--)`);
    if (writes.test(block)) errors.push(`for loop body must not modify or take the address of its counter ${counter}`);
    loops.push({ start: match.index, end: braceEnd, iterations });
  }
  for (const loop of loops) {
    const product = loops
      .filter((candidate) => candidate.start >= loop.start && candidate.end <= loop.end)
      .reduce((value, candidate) => value * candidate.iterations, 1);
    if (product > 256) errors.push("nested for loop product exceeds 256 iterations");
  }
  return [...new Set(errors)];
}

// WGSL keywords and reserved words (WGSL spec, "Keywords" and "Reserved Words"). Tint refuses them as
// identifiers ("'ref' is a reserved keyword"), and Gemini reaches for ref, mod, type, filter and target.
const WGSL_RESERVED = new Set((
  "alias break case const const_assert continue continuing default diagnostic discard else enable false fn for if let " +
  "loop override requires return struct switch true var while " +
  "NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await become cast catch class " +
  "co_await co_return co_yield coherent column_major common compile compile_fragment concept const_cast consteval " +
  "constexpr constinit crate debugger decltype delete demote demote_to_helper do dynamic_cast enum explicit export " +
  "extends extern external fallthrough filter final finally friend from fxgroup get goto groupshared highp impl " +
  "implements import inline instanceof interface layout lowp macro macro_rules match mediump meta mod module move mut " +
  "mutable namespace new nil noexcept noinline nointerpolation non_coherent noncoherent noperspective null nullptr of " +
  "operator package packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public " +
  "readonly ref regardless register reinterpret_cast require resource restrict self set shared sizeof smooth snorm " +
  "static static_assert static_cast std subroutine super target template this thread_local throw trait try type typedef " +
  "typeid typename typeof union unless unorm unsafe unsized use using varying virtual volatile wgsl where with writeonly yield"
).split(" "));

function declaredIdentifiers(source: string): string[] {
  const names: string[] = [];
  // A narrow guard for model-written bodies (comments are already stripped): declaration heads,
  // var<...> names, fn parameters and struct members. Misses only cost a GPU compile failure.
  for (const m of source.matchAll(/\b(?:let|const|override|fn|struct|alias)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) names.push(m[1]!);
  for (const m of source.matchAll(/\bvar(?:\s*<[^>]*>)?\s+([A-Za-z_][A-Za-z0-9_]*)/g)) names.push(m[1]!);
  for (const m of source.matchAll(/\bfn\s+[A-Za-z_][A-Za-z0-9_]*\s*\(([^)]*)\)/g))
    for (const p of m[1]!.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) names.push(p[1]!);
  for (const m of source.matchAll(/\bstruct\s+[A-Za-z_][A-Za-z0-9_]*\s*\{([^}]*)\}/g))
    for (const p of m[1]!.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) names.push(p[1]!);
  return names;
}

export function validateLabBody(body: unknown): string[] {
  if (typeof body !== "string") return ["WGSL body must be a string"];
  const errors: string[] = [];
  if (body.length > MAX_BODY_LENGTH) errors.push("WGSL body exceeds 6000 characters");
  if (!LAB_MAIN_RE.test(body)) errors.push("WGSL body must define fn labMain(uv: vec2f) -> vec4f");
  const searchable = stripComments(body);
  for (const token of rejectedLabTokens)
    if (searchable.includes(token)) errors.push(`WGSL body uses rejected token ${token}`);
  errors.push(...validateLoops(searchable));
  for (const name of new Set(declaredIdentifiers(searchable)))
    if (WGSL_RESERVED.has(name)) errors.push(`WGSL body uses reserved word ${name} as an identifier; rename it`);
  return errors;
}

export function validateLabDeviceSpec(input: unknown, builtInTypes: ReadonlySet<string> = new Set()): string[] {
  const errors: string[] = [];
  if (!object(input)) return ["Lab device must be an object"];
  if (typeof input.id !== "string" || !ID_RE.test(input.id)) errors.push("Lab device id must match ^lab\\.[a-z0-9-]{3,40}$");
  else if (builtInTypes.has(input.id)) errors.push(`${input.id} clashes with a built-in device type`);
  if (typeof input.name !== "string" || !input.name.trim()) errors.push(`${input.id ?? "Lab device"} name is required`);
  if (input.kind !== "effect" && input.kind !== "source") errors.push(`${input.id ?? "Lab device"} kind must be effect or source`);
  if (input.status !== "curated" && input.status !== "candidate") errors.push(`${input.id ?? "Lab device"} status must be curated or candidate`);
  if (typeof input.description !== "string" || !input.description.trim()) errors.push(`${input.id ?? "Lab device"} description is required`);
  if (typeof input.added !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.added)) errors.push(`${input.id ?? "Lab device"} added must be YYYY-MM-DD`);
  if (!object(input.source) || typeof input.source.tool !== "string" || typeof input.source.run !== "string" || typeof input.source.model !== "string")
    errors.push(`${input.id ?? "Lab device"} source metadata is required`);
  if (!Array.isArray(input.params) || input.params.length < 1 || input.params.length > 6) {
    errors.push(`${input.id ?? "Lab device"} must declare 1-6 params`);
  } else {
    const keys = new Set<string>();
    for (const param of input.params) {
      if (!object(param)) {
        errors.push(`${input.id ?? "Lab device"} has an invalid param`);
        continue;
      }
      if (typeof param.key !== "string" || !/^[a-z][a-zA-Z0-9_]{0,31}$/.test(param.key)) errors.push(`${input.id ?? "Lab device"} has an invalid param key`);
      else if (keys.has(param.key)) errors.push(`${input.id ?? "Lab device"} has duplicate param key ${param.key}`);
      else keys.add(param.key);
      if (typeof param.label !== "string" || !param.label.trim()) errors.push(`${input.id ?? "Lab device"} param ${String(param.key)} label is required`);
      if (!finite(param.min) || !finite(param.max) || !finite(param.default) || !(param.min < param.max) || param.default < param.min || param.default > param.max)
        errors.push(`${input.id ?? "Lab device"} param ${String(param.key)} must have min < max and default within range`);
    }
  }
  errors.push(...validateLabBody(input.wgsl).map((reason) => `${input.id ?? "Lab device"}: ${reason}`));
  return errors;
}

export function validateLabLibrary(input: unknown, builtInTypes: ReadonlySet<string> = new Set()): string[] {
  if (!object(input)) return ["Lab library must be an object"];
  const errors: string[] = [];
  if (input.version !== 1) errors.push("Lab library version must be 1");
  if (!Array.isArray(input.devices)) return [...errors, "Lab library devices must be an array"];
  const ids = new Set<string>();
  for (const device of input.devices) {
    const id = object(device) && typeof device.id === "string" ? device.id : "Lab device";
    if (typeof id === "string" && ids.has(id)) errors.push(`${id} is duplicated`);
    if (typeof id === "string") ids.add(id);
    errors.push(...validateLabDeviceSpec(device, builtInTypes));
  }
  return errors;
}

export const labLibrary = library as LabLibrary;
export const labDevices = labLibrary.devices as (LabDeviceSpec & { id: LabDeviceType })[];

export function labParamManifest(device: LabDeviceSpec): Record<string, ParameterManifest> {
  return Object.fromEntries(device.params.map((param) => [param.key, p(param)]));
}

export function labDeviceDefinitions(): Record<LabDeviceType, {
  label: string;
  category: "Lab";
  params: Record<string, ParameterManifest>;
  frameInputs?: readonly string[];
}> {
  return Object.fromEntries(labDevices.map((device) => [
    device.id,
    {
      label: device.name,
      category: "Lab",
      params: labParamManifest(device),
      ...(device.kind === "effect" ? { frameInputs: ["in"] as const } : {}),
    },
  ])) as Record<LabDeviceType, {
    label: string;
    category: "Lab";
    params: Record<string, ParameterManifest>;
    frameInputs?: readonly string[];
  }>;
}

export function isLabDevice(type: string): type is LabDeviceType {
  return labDevices.some((device) => device.id === type);
}

export function labDevice(type: string): LabDeviceSpec | undefined {
  return labDevices.find((device) => device.id === type);
}

export function isLabEffect(type: string): boolean {
  return labDevice(type)?.kind === "effect";
}

export function isLabSource(type: string): type is LabDeviceType {
  return labDevice(type)?.kind === "source";
}

function paramLine(index: number): string {
  return `  p${index}:f32,`;
}

function paramsObject(values: Record<string, number>, device: LabDeviceSpec, time: number, width: number, height: number): Record<string, number> {
  return {
    p0: values[device.params[0]?.key ?? ""] ?? 0,
    p1: values[device.params[1]?.key ?? ""] ?? 0,
    p2: values[device.params[2]?.key ?? ""] ?? 0,
    p3: values[device.params[3]?.key ?? ""] ?? 0,
    p4: values[device.params[4]?.key ?? ""] ?? 0,
    p5: values[device.params[5]?.key ?? ""] ?? 0,
    time,
    width,
    height,
    _pad: 0,
  };
}

export function labParams(type: string, values: Record<string, number>, time: number, width: number, height: number): Record<string, number> {
  const device = labDevice(type);
  if (!device) throw new Error(`Unknown lab device ${type}`);
  return paramsObject(values, device, time, width, height);
}

export function assembleLabShader(device: LabDeviceSpec): string {
  const effectBindings = device.kind === "effect"
    ? "@group(0) @binding(0) var src:texture_2d<f32>;\n@group(0) @binding(1) var samp:sampler;\n"
    : "";
  const inputHelper = device.kind === "effect"
    ? "fn labInput(uv: vec2f) -> vec4f { return textureSampleLevel(src,samp,uv,0); }\n"
    : "fn labInput(uv: vec2f) -> vec4f { return vec4f(0.0,0.0,0.0,1.0); }\n";
  return `struct Params {
${Array.from({ length: 6 }, (_, index) => paramLine(index)).join("\n")}
  time:f32,
  width:f32,
  height:f32,
  _pad:f32,
}
${effectBindings}@group(0) @binding(6) var<uniform> params:Params;

${inputHelper}fn labParam(i: i32) -> f32 {
  if (i == 0) { return params.p0; }
  if (i == 1) { return params.p1; }
  if (i == 2) { return params.p2; }
  if (i == 3) { return params.p3; }
  if (i == 4) { return params.p4; }
  if (i == 5) { return params.p5; }
  return 0.0;
}
fn labTime() -> f32 { return params.time; }
fn labAspect() -> f32 { return params.width/max(params.height,1.0); }

${device.wgsl}

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  return labMain(uv);
}
`;
}

export const labShaders: Record<LabDeviceType, string> = Object.fromEntries(
  labDevices.map((device) => [device.id, assembleLabShader(device)]),
) as Record<LabDeviceType, string>;

export const labEffectShaders: Record<LabDeviceType, string> = Object.fromEntries(
  labDevices.filter((device) => device.kind === "effect").map((device) => [device.id, assembleLabShader(device)]),
) as Record<LabDeviceType, string>;

export const labSourceShaders: Record<LabDeviceType, string> = Object.fromEntries(
  labDevices.filter((device) => device.kind === "source").map((device) => [device.id, assembleLabShader(device)]),
) as Record<LabDeviceType, string>;

export function labBindings(type: string, values: Record<string, unknown>) {
  const device = labDevice(type);
  if (!device) return {};
  // Like built-in effects, omit keys the caller did not pass: the per-frame update carries no
  // sampler, and an explicit undefined samp made every lab effect fall back to pass-through.
  const keys = device.kind === "effect" ? ["src", "samp", "params"] : ["params"];
  return Object.fromEntries(keys.filter((key) => values[key] !== undefined).map((key) => [key, values[key]]));
}

export const labEffectFallbackShader = `@group(0) @binding(0) var src:texture_2d<f32>; @group(0) @binding(1) var samp:sampler;
@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f{return textureSampleLevel(src,samp,uv,0);}`;

export const labSourceFallbackShader = `@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f{return vec4f(0.0,0.0,0.0,1.0);}`;
