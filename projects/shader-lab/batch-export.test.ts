import { describe, expect, it, vi } from "vitest";
import { createDefaultPatch } from "./core";
vi.mock("./export", () => ({ exportClipToArtifact: vi.fn() }));
import { localBatchDependencies, runBatchExport, type BatchDependencies, type BatchManifest, type BatchPreset } from "./batch-export";

const preset = (id: string): BatchPreset => ({ id, bank: "new", name: id, description: "Fixture", patch: createDefaultPatch(), duration: 2, loopable: false, controls: [] });
const receipt = (id: string, kind: string) => ({ path: kind === "master" ? `masters/${id}.mp4` : kind === "patch" ? `patches/${id}.json` : kind === "poster" ? `posters/${id}.jpg` : `public/${id}.${kind}`, bytes: 1234 });
function sink() {
  let saved: BatchManifest | undefined;
  const operations: string[] = [];
  const dependencies: BatchDependencies = {
    loadManifest: async () => structuredClone(saved),
    saveManifest: async manifest => { saved = structuredClone(manifest); },
    savePatch: async item => { operations.push(`${item.id}:patch`); return receipt(item.id, "patch"); },
    encodeMaster: async (item, options) => {
      operations.push(`${item.id}:master`);
      expect(options).toMatchObject({ width: 1920, height: 1080, fps: 30, format: "mp4", duration: item.duration });
      options.onProgress?.(0.5);
      return receipt(item.id, "master");
    },
    derive: async (item, master, options) => {
      operations.push(`${item.id}:derive`);
      expect(master.path).toBe(`masters/${item.id}.mp4`);
      expect(options.posterTime).toBe(0.5);
      return { mp4: receipt(item.id, "mp4"), webm: receipt(item.id, "webm"), poster: receipt(item.id, "poster") };
    },
    now: () => new Date("2026-09-09T12:00:00Z"),
  };
  return { dependencies, operations, saved: () => saved! };
}

describe("resumable sequential batch export", () => {
  it("renders each preset only once and saves five artifact receipts before advancing", async () => {
    const service = sink();
    const progress: number[] = [];
    const catalog = [preset("first"), preset("second")];
    const snapshot = structuredClone(catalog);
    const manifest = await runBatchExport(catalog, service.dependencies, { onProgress: value => progress.push(value.overall) });
    expect(service.operations).toEqual(["first:patch", "first:master", "first:derive", "second:patch", "second:master", "second:derive"]);
    expect(Object.values(manifest.entries).every(entry => entry.status === "complete" && Object.keys(entry.artifacts).length === 5)).toBe(true);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1]!)).toBe(true);
    expect(catalog).toEqual(snapshot);
    expect(manifest.updatedAt).toBe("2026-09-09T12:00:00.000Z");
  });

  it("resumes after a derived rendition fails without repeating the master render", async () => {
    const service = sink();
    const catalog = [preset("first"), preset("second")];
    const derive = service.dependencies.derive;
    service.dependencies.derive = async () => { throw new Error("Encoder interrupted"); };
    await expect(runBatchExport(catalog, service.dependencies)).rejects.toThrow("Encoder interrupted");
    expect(service.saved().entries.first).toMatchObject({ status: "error", artifacts: { master: receipt("first", "master") } });
    service.dependencies.derive = derive;
    await runBatchExport(catalog, service.dependencies);
    expect(service.operations.filter(operation => operation === "first:master")).toHaveLength(1);
    expect(service.saved().entries.second?.status).toBe("complete");
  });

  it("skips complete matching entries but rebuilds changed patches", async () => {
    const service = sink();
    const catalog = [preset("first")];
    await runBatchExport(catalog, service.dependencies);
    service.operations.length = 0;
    await runBatchExport(catalog, service.dependencies);
    expect(service.operations).toEqual([]);
    catalog[0]!.patch.nodes[0]!.params.fold = 0.1;
    await runBatchExport(catalog, service.dependencies);
    expect(service.operations).toEqual(["first:patch", "first:master", "first:derive"]);
  });

  it("rebuilds a missing master and invalidates all derived receipts", async () => {
    const service = sink();
    const catalog = [preset("first")];
    await runBatchExport(catalog, service.dependencies);
    service.operations.length = 0;
    service.dependencies.artifactExists = async artifact => !artifact.path.startsWith("masters/");
    await runBatchExport(catalog, service.dependencies);
    expect(service.operations).toEqual(["first:master", "first:derive"]);
  });

  it("persists interruption after the current operation and starts no later preset", async () => {
    const service = sink();
    const controller = new AbortController();
    service.dependencies.encodeMaster = async item => { controller.abort(); return receipt(item.id, "master"); };
    await expect(runBatchExport([preset("first"), preset("second")], service.dependencies, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(service.saved().entries.first?.status).toBe("interrupted");
    expect(service.saved().entries.first?.artifacts.master).toEqual(receipt("first", "master"));
    expect(service.saved().entries.second).toBeUndefined();
    expect(service.operations).toEqual(["first:patch"]);
  });

  it("rejects invalid catalogs before opening any sink operation", async () => {
    const service = sink();
    const load = vi.spyOn(service.dependencies, "loadManifest");
    await expect(runBatchExport([preset("../unsafe")], service.dependencies)).rejects.toThrow("safe filenames");
    await expect(runBatchExport([preset("same"), preset("same")], service.dependencies)).rejects.toThrow("unique");
    expect(load).not.toHaveBeenCalled();
    expect(service.operations).toEqual([]);
  });

  it("does not trust malformed receipts from a save sink", async () => {
    const service = sink();
    service.dependencies.encodeMaster = async () => ({ path: "C:/outside.mp4", bytes: 100 });
    await expect(runBatchExport([preset("first")], service.dependencies)).rejects.toThrow("invalid artifact receipt");
    expect(service.saved().entries.first?.artifacts.master).toBeUndefined();
  });

  it("uses same-origin manifest, patch, and derive endpoints without downloading videos", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input, init = {}) => {
      const url = String(input); calls.push({ url, init });
      return new Response(JSON.stringify(url.endsWith("/manifest") ? undefined : { path: "patches/first.json", bytes: 123 }), { status: url.endsWith("/manifest") && !init.method ? 404 : 200 });
    }) as typeof fetch;
    try {
      const dependencies = localBatchDependencies();
      expect(await dependencies.loadManifest()).toBeUndefined();
      await dependencies.savePatch(preset("first"));
      expect(calls[1]?.url).toBe("/__visual-synth/batch/patches/first");
      expect(calls[1]?.init.headers).toMatchObject({ "X-Visual-Synth": "export-v1", "Content-Type": "application/json" });
      expect(JSON.parse(String(calls[1]?.init.body)).nodes.length).toBeGreaterThan(0);
    } finally { globalThis.fetch = original; }
  });
});
