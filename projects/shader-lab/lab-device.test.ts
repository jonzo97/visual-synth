import { describe, expect, it } from "vitest";
import { buildDeviceCatalog } from "./rack-catalog";
import {
  assembleLabShader,
  labBindings,
  labDevices,
  labLibrary,
  rejectedLabTokens,
  validateLabBody,
  validateLabDeviceSpec,
  validateLabLibrary,
  type LabDeviceSpec,
} from "./lab-device";
import { manifests } from "./core";

const goodBody = `fn labMain(uv: vec2f) -> vec4f {
  var sum=0.0;
  for (var i = 0; i < 4; i++) { sum += f32(i); }
  return vec4f(uv, sum * 0.0, 1.0);
}`;

function spec(overrides: Partial<LabDeviceSpec> = {}): LabDeviceSpec {
  return {
    id: "lab.test-device",
    name: "Test Device",
    kind: "source",
    status: "candidate",
    description: "A small test device.",
    params: [{ key: "a", label: "A", min: 0, max: 1, default: 0.5 }],
    wgsl: goodBody,
    source: { tool: "test", run: "unit", model: "unit" },
    added: "2026-09-24",
    ...overrides,
  };
}

describe("lab device validator", () => {
  it("accepts a good lab body", () => {
    expect(validateLabBody(goodBody)).toEqual([]);
  });

  it.each(rejectedLabTokens)("rejects token %s", (token) => {
    expect(validateLabBody(`${goodBody}\n${token}`)).toContain(`WGSL body uses rejected token ${token}`);
  });

  it("rejects unbounded or oversized loops", () => {
    expect(validateLabBody(`fn labMain(uv: vec2f) -> vec4f { for (var i = 0; true; i++) { } return vec4f(uv,0.0,1.0); }`))
      .toContain("for loops must use a bounded integer-literal counter shape");
    expect(validateLabBody(`fn labMain(uv: vec2f) -> vec4f { for (var i = 0; i < 65; i++) { } return vec4f(uv,0.0,1.0); }`))
      .toContain("for loop exceeds 64 iterations");
  });

  it("rejects loops that rewind their counter", () => {
    const counterError = "for loop body must not modify or take the address of its counter i";
    for (const inner of ["i = 0;", "i -= 1;", "i--;", "let p = &i; *p = 0;"])
      expect(validateLabBody(`fn labMain(uv: vec2f) -> vec4f { for (var i = 0; i < 8; i++) { ${inner} } return vec4f(uv,0.0,1.0); }`))
        .toContain(counterError);
    expect(validateLabBody(`fn labMain(uv: vec2f) -> vec4f { var s = 0.0; for (var i = 0; i < 8; i++) { s += f32(i); if (i == 3) { s = s * 0.5; } } return vec4f(uv,s,1.0); }`))
      .toEqual([]);
  });

  it("rejects nested loop products above 256", () => {
    const body = `fn labMain(uv: vec2f) -> vec4f {
      for (var i = 0; i < 17; i++) { for (var j = 0; j < 16; j++) { } }
      return vec4f(uv,0.0,1.0);
    }`;
    expect(validateLabBody(body)).toContain("nested for loop product exceeds 256 iterations");
  });

  it("rejects bad params, bad ids, missing labMain, and over-length bodies", () => {
    expect(validateLabDeviceSpec(spec({ id: "fx.bad" as `lab.${string}` }))).toContain("Lab device id must match ^lab\\.[a-z0-9-]{3,40}$");
    expect(validateLabDeviceSpec(spec({ params: [{ key: "a", label: "A", min: 1, max: 1, default: 2 }] })))
      .toContain("lab.test-device param a must have min < max and default within range");
    expect(validateLabBody("fn other() -> vec4f { return vec4f(0.0); }")).toContain("WGSL body must define fn labMain(uv: vec2f) -> vec4f");
    expect(validateLabBody(`fn labMain(uv: vec2f) -> vec4f { return vec4f(uv,0.0,1.0); }\n${"x".repeat(6001)}`))
      .toContain("WGSL body exceeds 6000 characters");
  });

  it("rejects ids that clash with built-in device types", () => {
    expect(validateLabDeviceSpec(spec({ id: "lab.test-device" }), new Set(["lab.test-device"])))
      .toContain("lab.test-device clashes with a built-in device type");
  });
});

describe("lab device registration", () => {
  it("assembles the body exactly once", () => {
    const body = "fn labMain(uv: vec2f) -> vec4f { return vec4f(uv,0.0,1.0); }";
    const shader = assembleLabShader(spec({ wgsl: body }));
    expect(shader.split(body)).toHaveLength(2);
  });

  it("binds lab effects with a sampler", () => {
    const bindings = labBindings("lab.ripple", { src: "src", samp: "sampler", params: "params" });
    expect(bindings).toEqual({ src: "src", samp: "sampler", params: "params" });
    // Per-frame updates pass no sampler; the bind must keep the initial one rather than clear it.
    expect(labBindings("lab.ripple", { src: "src", params: "params" })).toEqual({ src: "src", params: "params" });
    expect(assembleLabShader(spec({ kind: "effect" }))).toContain("@binding(1) var samp:sampler");
  });

  it("validates the committed lab-devices.json", () => {
    expect(validateLabLibrary(labLibrary, new Set(Object.keys(manifests).filter((type) => !type.startsWith("lab."))))).toEqual([]);
  });

  it("registers committed lab devices in manifests and the generated catalog source", () => {
    for (const device of labDevices) expect(manifests[device.id]).toBeDefined();
    const catalog = buildDeviceCatalog();
    expect(catalog.map((entry) => entry.type)).toEqual(expect.arrayContaining(labDevices.map((device) => device.id)));
  });
});

describe("lab device reserved words", () => {
  it("rejects WGSL reserved words used as identifiers and accepts ordinary names", () => {
    const body = (name: string) => `fn labMain(uv: vec2f) -> vec4f { let ${name} = uv.x; return vec4f(${name}); }`;
    expect(validateLabBody(body("ref"))).toContain("WGSL body uses reserved word ref as an identifier; rename it");
    const helper = "fn shade(target: f32) -> f32 { return target; } fn labMain(uv: vec2f) -> vec4f { return vec4f(shade(uv.x)); }";
    expect(validateLabBody(helper).join(" ")).toContain("reserved word target");
    expect(validateLabBody(body("reflected")).filter((e) => e.includes("reserved"))).toEqual([]);
    const member = "struct Hit { ref: f32, dist: f32 } fn labMain(uv: vec2f) -> vec4f { var h: Hit; h.dist = uv.x; return vec4f(h.dist); }";
    expect(validateLabBody(member).join(" ")).toContain("reserved word ref");
    const memberAccess = "struct Hit { pos: f32 } fn labMain(uv: vec2f) -> vec4f { var h: Hit; h.pos = uv.x; return vec4f(h.pos); }";
    expect(validateLabBody(memberAccess).filter((e) => e.includes("reserved"))).toEqual([]);
  });
});
