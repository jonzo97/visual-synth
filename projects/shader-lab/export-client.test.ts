import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDefaultPatch, createNode, type Patch } from "./core";
const state = vi.hoisted(() => ({
  times: [] as number[],
  encoded: [] as number[],
  disposed: false,
  onRender: undefined as undefined | (() => void),
  renderOptions: [] as { signal?: AbortSignal; patchAt?: (time: number) => Patch; onProgress?: (fraction: number) => void }[],
  active: 0,
  maximumActive: 0,
}));
vi.mock("./renderer", () => ({
  createRenderer: async (canvas: unknown) => ({
    canvas,
    setPatch() {},
    reset() {},
    async renderAt(t: number, options: { signal?: AbortSignal; patchAt?: (time: number) => Patch; onProgress?: (fraction: number) => void }) {
      state.active++;
      state.maximumActive = Math.max(state.maximumActive, state.active);
      state.times.push(t);
      state.renderOptions.push(options);
      options.onProgress?.(0.5);
      await Promise.resolve();
      state.onRender?.();
      state.active--;
    },
    settled: async () => {},
    dispose() {
      state.disposed = true;
    },
  }),
}));
vi.mock("mediabunny", () => ({
  canEncodeVideo: async () => true,
  Quality: class {},
  Mp4OutputFormat: class {},
  WebMOutputFormat: class {},
  BufferTarget: class {
    buffer = new Uint8Array([1, 2, 3]);
  },
  CanvasSource: class {
    async add(time: number) {
      state.encoded.push(time);
    }
  },
  Output: class {
    state = "pending";
    addVideoTrack() {}
    async start() {
      this.state = "started";
    }
    async finalize() {
      this.state = "finalized";
    }
    async cancel() {
      this.state = "canceled";
    }
  },
}));
import { exportClip, exportClipToArtifact, exportPerformance, prerollSeconds } from "./export";

beforeEach(() => {
  state.times = [];
  state.encoded = [];
  state.disposed = false;
  state.onRender = undefined;
  state.renderOptions = [];
  state.active = 0;
  state.maximumActive = 0;
  vi.stubGlobal("document", { createElement: () => ({}) });
});
afterEach(() => { vi.unstubAllGlobals(); });
it("renders deterministic preroll and exactly one second without encoding preroll", async () => {
  const patch = createDefaultPatch();
  const progress: number[] = [];
  expect(prerollSeconds(patch)).toBe(2);
  const blob = await exportClip(patch, {
    width: 1280,
    height: 720,
    fps: 30,
    duration: 1,
    format: "mp4",
    onProgress: (n) => progress.push(n),
  });
  expect(blob.type).toBe("video/mp4");
  expect(state.times).toHaveLength(90);
  expect(state.times[0]).toBe(-2);
  expect(state.times.at(-1)).toBe(29 / 30);
  expect(state.encoded).toEqual(Array.from({ length: 30 }, (_, i) => i / 30));
  expect(state.disposed).toBe(true);
  expect(progress.at(-1)).toBe(1);
  expect(state.maximumActive).toBe(1);
});
it("aborts during preroll, never falls back, and disposes GPU resources", async () => {
  const controller = new AbortController();
  state.onRender = () => controller.abort();
  await expect(
    exportClip(createDefaultPatch(), {
      width: 1280,
      height: 720,
      fps: 30,
      duration: 1,
      format: "webm",
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(state.encoded).toHaveLength(0);
  expect(state.disposed).toBe(true);
});
it("rejects unsupported sizes before allocating a renderer", async () => {
  await expect(
    exportClip(createDefaultPatch(), {
      width: 1279,
      height: 720,
      fps: 30,
      duration: 1,
      format: "mp4",
    }),
  ).rejects.toThrow("even dimensions");
  expect(state.times).toHaveLength(0);
});
it("accepts 4K export dimensions before the encoder capability check", async () => {
  await exportClip(createDefaultPatch(), {
    width: 3840,
    height: 2160,
    fps: 30,
    duration: 1,
    format: "mp4",
  });
  expect(state.times).toHaveLength(90);
});
it("exports a performance with absolute source time and zero-based video timestamps", async () => {
  await exportPerformance(
    {
      version: 1,
      patch: createDefaultPatch(),
      controls: [],
      gates: [],
      startTime: 12,
      duration: 1,
    },
    { width: 1280, height: 720, fps: 30, duration: 12, format: "webm" },
  );
  expect(state.times[0]).toBe(10);
  expect(state.times.at(-1)).toBe(12 + 29 / 30);
  expect(state.encoded).toHaveLength(30);
  expect(state.encoded[0]).toBe(0);
});

function statefulPatch(): Patch {
  const patch = createDefaultPatch();
  const source = createNode("rules", "rules");
  const output = createNode("output", "output");
  patch.version = 2;
  patch.nodes = [source, output];
  patch.connections = [{ id: "screen", from: { node: source.id, port: "frame" }, to: { node: output.id, port: "in" } }];
  patch.simulation = { tickHz: 60, warmupTicks: 360, events: [] };
  return patch;
}

it("lets renderAt reconstruct persisted warmup before consuming the first simulation frame", async () => {
  const progress: number[] = [];
  await exportClip(statefulPatch(), { width: 32, height: 32, fps: 30, duration: 1, format: "mp4", onProgress: value => progress.push(value) });
  expect(state.times).toEqual(Array.from({ length: 30 }, (_, i) => i / 30));
  expect(state.encoded).toHaveLength(30);
  expect(state.renderOptions[0]?.onProgress).toBeTypeOf("function");
  expect(progress.some(value => value > 0.3 && value < 0.5)).toBe(true);
  expect(progress.every((value, index) => index === 0 || value >= progress[index - 1]!)).toBe(true);
  expect(state.maximumActive).toBe(1);
});

it("supplies the full performance timeline at absolute simulation tick times", async () => {
  const patch = statefulPatch();
  await exportPerformance({ version: 2, patch, startTime: 12, duration: 1, controls: [{ time: 1 / 60, node: "rules", param: "threshold", value: 2 }], gates: [], simulation: [{ time: 1 / 60, node: "rules", kind: "reset" }] },
    { width: 32, height: 32, fps: 30, duration: 1, format: "mp4" });
  const patchAt = state.renderOptions[0]?.patchAt;
  expect(state.times[0]).toBe(12);
  expect(patchAt).toBeTypeOf("function");
  const before = patchAt!(12);
  const after = patchAt!(12 + 1 / 30);
  expect(before.simulation?.events).toEqual([]);
  expect(after.simulation?.events).toEqual([{ time: 12 + 1 / 60, node: "rules", kind: "reset" }]);
  expect(after.nodes[0]?.params.threshold).toBe(2);
  expect(state.encoded[0]).toBe(0);
});

function captureCanvas() {
  vi.stubGlobal("document", { createElement: () => ({ width: 32, height: 32, getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(32 * 32 * 4) }) }) }) });
}

it("retains a local master via a receipt and cleans its temporary job without loading a video blob", async () => {
  captureCanvas();
  const calls: { url: string; init: RequestInit }[] = [];
  const receipt = { path: "masters/first.mp4", bytes: 2048 };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
    calls.push({ url: input, init });
    return new Response(JSON.stringify(input.endsWith("/jobs") ? { id: "job-id" } : input.endsWith("/finish") ? receipt : {}));
  }));
  expect(await exportClipToArtifact(statefulPatch(), { width: 32, height: 32, fps: 30, duration: 1, format: "mp4" }, "first")).toEqual(receipt);
  expect(calls.filter(call => call.url.endsWith("/frame"))).toHaveLength(30);
  expect(JSON.parse(String(calls.find(call => call.url.endsWith("/finish"))?.init.body))).toEqual({ assetId: "first" });
  expect(calls.at(-1)).toMatchObject({ url: "/__visual-synth/export/jobs/job-id", init: { method: "DELETE" } });
  expect(state.disposed).toBe(true);
});

it("obtains a cleanup target if cancelled while the local encoder creates its job", async () => {
  captureCanvas();
  const controller = new AbortController();
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
    calls.push({ url: input, init });
    if (input.endsWith("/jobs")) { controller.abort(); return new Response(JSON.stringify({ id: "cancelled-job" })); }
    return new Response("{}");
  }));
  await expect(exportClipToArtifact(statefulPatch(), { width: 32, height: 32, fps: 30, duration: 1, format: "mp4", signal: controller.signal }, "first")).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toHaveLength(2);
  expect(calls.at(-1)?.init.method).toBe("DELETE");
  expect(state.times).toHaveLength(0);
  expect(state.disposed).toBe(true);
});
