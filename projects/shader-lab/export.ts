import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  canEncodeVideo,
} from "mediabunny";
import { frameInputs, isStatefulGenerator, topologicalNodes, validatePatch, type Patch } from "./core";
import { planFrames } from "./render-plan";
import { createRenderer, type SynthRenderer } from "./renderer";
import {
  performancePatchAt,
  validatePerformance,
  type PerformanceTake,
} from "./performance";

export type ExportOptions = {
  format: "mp4" | "webm";
  width: number;
  height: number;
  fps: number;
  duration: number;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
};
export type ExportArtifact = { path: string; bytes: number };
const endpoint = "/__visual-synth/export/jobs";
const abortError = () => new DOMException("Export cancelled.", "AbortError");
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

export function prerollSeconds(patch: Patch): number {
  const depths = new Map<string, number>();
  let longest = 0;
  for (const node of topologicalNodes(patch)) {
    const upstream = patch.connections.filter(
      (edge) =>
        edge.to.node === node.id && frameInputs(node).includes(edge.to.port),
    );
    const depth =
      Math.max(0, ...upstream.map((edge) => depths.get(edge.from.node) ?? 0)) +
      (["fx.delay", "fx.reverb"].includes(node.type) ? 1 : 0);
    depths.set(node.id, depth);
    longest = Math.max(longest, depth);
  }
  return Math.max(2, longest * 0.36 + 0.24);
}

function validateOptions(options: ExportOptions) {
  const { width, height, fps, duration, format } = options;
  if (
    ![width, height].every(
      (n) => Number.isInteger(n) && n >= 2 && n <= 3840 && n % 2 === 0,
    ) ||
    width * height > 3840 * 2160 ||
    ![30, 60].includes(fps) ||
    !Number.isFinite(duration) ||
    duration < 1 ||
    duration > 60 ||
    !["mp4", "webm"].includes(format)
  ) {
    throw new Error(
      "Choose even dimensions up to 4K, 30 or 60 FPS, and a duration from 1–60 seconds.",
    );
  }
}

export type ExportTimeline = { startTime: number; patchAt: (elapsed: number) => Patch };
export async function renderExportFrames(
  renderer: SynthRenderer,
  patch: Patch,
  options: ExportOptions,
  consume: (frame: number) => Promise<void>,
  timeline?: ExportTimeline,
) {
  // Stateful renderAt owns reconstruction from the persisted simulation origin.
  // Legacy history keeps its existing frame cadence and two-second preroll.
  const stateful = planFrames(patch).nodes.some(node => isStatefulGenerator(node.type) || ["fx.chrono", "fx.feedback"].includes(node.type));
  const warmup = stateful ? 0 : Math.ceil(prerollSeconds(patch) * options.fps);
  const count = Math.round(options.duration * options.fps);
  const reconstruction = stateful ? Math.ceil((Math.max(patch.simulation?.warmupTicks ?? 0, 120) / 60 + (timeline?.startTime ?? 0)) * options.fps) : 0;
  const total = warmup + reconstruction + count;
  const patchAt = timeline ? (time: number) => timeline.patchAt(time - timeline.startTime) : undefined;
  renderer.reset();
  for (let i = warmup === 0 ? 0 : -warmup; i < count; i++) {
    checkAbort(options.signal);
    await renderer.renderAt((timeline?.startTime ?? 0) + i / options.fps, {
      signal: options.signal,
      patchAt,
      onProgress: stateful && i === 0
        ? fraction => options.onProgress?.(0.98 * reconstruction * Math.max(0, Math.min(1, fraction)) / total)
        : undefined,
    });
    await renderer.settled();
    checkAbort(options.signal);
    if (i >= 0) await consume(i);
    options.onProgress?.((0.98 * (i + warmup + reconstruction + 1)) / total);
    // Keep cancellation/UI responsive even with fast software-only test renderers.
    if (i % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function browserExport(
  renderer: SynthRenderer,
  patch: Patch,
  options: ExportOptions,
  timeline?: ExportTimeline,
): Promise<Blob> {
  const codec = options.format === "mp4" ? "avc" : "vp9";
  const quality = new Quality({
    bitrate: Math.min(
      24_000_000,
      Math.max(4_000_000, options.width * options.height * options.fps * 0.16),
    ),
  });
  if (
    !(await canEncodeVideo(codec, {
      width: options.width,
      height: options.height,
      quality,
    }))
  )
    throw new Error(`Browser cannot encode ${codec}.`);
  const target = new BufferTarget();
  const output = new Output({
    format:
      options.format === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target,
  });
  const source = new CanvasSource(renderer.canvas, { codec, quality });
  output.addVideoTrack(source, { frameRate: options.fps });
  const cancel = () => {
    void output.cancel().catch(() => {});
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    checkAbort(options.signal);
    await output.start();
    await renderExportFrames(
      renderer,
      patch,
      options,
      (i) => source.add(i / options.fps, 1 / options.fps),
      timeline,
    );
    checkAbort(options.signal);
    await output.finalize();
    checkAbort(options.signal);
    if (!target.buffer) throw new Error("Encoder returned no video.");
    return new Blob([new Uint8Array(target.buffer)], {
      type: `video/${options.format}`,
    });
  } finally {
    options.signal?.removeEventListener("abort", cancel);
    if (output.state !== "finalized" && output.state !== "canceled")
      await output.cancel().catch(() => {});
  }
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    headers: { ...init.headers, "X-Visual-Synth": "export-v1" },
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      error.error ?? `Local encoder returned HTTP ${response.status}.`,
    );
  }
  return response;
}

async function localExport(
  renderer: SynthRenderer,
  patch: Patch,
  options: ExportOptions,
  timeline?: ExportTimeline,
  assetId?: string,
): Promise<Blob | ExportArtifact> {
  checkAbort(options.signal);
  // Do not abort job creation: obtain its ID so an abort always has a cleanup target.
  const created = await request(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      width: options.width,
      height: options.height,
      fps: options.fps,
      frames: Math.round(options.fps * options.duration),
      format: options.format,
    }),
  });
  const { id } = (await created.json()) as { id: string };
  const url = `${endpoint}/${id}`;
  const scratch = document.createElement("canvas");
  scratch.width = options.width;
  scratch.height = options.height;
  try {
    const context = scratch.getContext("2d", { willReadFrequently: true });
    if (!context)
      throw new Error("Cannot capture frames for the local encoder.");
    await renderExportFrames(
      renderer,
      patch,
      options,
      async () => {
        context.drawImage(renderer.canvas, 0, 0);
        const bytes = context.getImageData(
          0,
          0,
          scratch.width,
          scratch.height,
        ).data;
        await request(`${url}/frame`, {
          method: "POST",
          body: new Blob([new Uint8Array(bytes)]),
          signal: options.signal,
        });
      },
      timeline,
    );
    const result = await request(`${url}/finish`, {
      method: "POST",
      signal: options.signal,
      ...(assetId ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetId }) } : {}),
    });
    if (assetId) {
      const artifact = await result.json() as ExportArtifact;
      if (typeof artifact.path !== "string" || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0)
        throw new Error("Local encoder returned an invalid artifact receipt.");
      checkAbort(options.signal);
      return artifact;
    }
    const blob = await result.blob();
    checkAbort(options.signal);
    return blob;
  } finally {
    scratch.width = scratch.height = 1;
    await request(url, { method: "DELETE" }).catch(() => {});
  }
}

/** Immutable, fixed-step export; editor state and the visible renderer are never modified. */
export async function exportClip(
  patch: Patch,
  options: ExportOptions,
): Promise<Blob> {
  return exportTimeline(patch, options);
}

/** Render once into the local encoder's retained master file, without a video Blob. */
export async function exportClipToArtifact(
  patch: Patch,
  options: ExportOptions,
  assetId: string,
): Promise<ExportArtifact> {
  validateOptions(options);
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(assetId) || options.format !== "mp4")
    throw new Error("Retained masters require a safe preset ID and MP4 format.");
  checkAbort(options.signal);
  const snapshot = structuredClone(patch);
  const errors = validatePatch(snapshot);
  if (errors.length) throw new Error(errors.join(" "));
  const renderer = await createRenderer(document.createElement("canvas"), { width: options.width, height: options.height, preview: false, textureBudget: "offline" });
  try {
    checkAbort(options.signal);
    await renderer.setPatch(snapshot);
    options.onProgress?.(0);
    const artifact = await localExport(renderer, snapshot, options, undefined, assetId) as ExportArtifact;
    options.onProgress?.(1);
    return artifact;
  } finally {
    renderer.dispose();
  }
}

export async function exportPerformance(
  take: PerformanceTake,
  options: ExportOptions,
): Promise<Blob> {
  const errors = validatePerformance(take);
  if (errors.length) throw new Error(errors.join(" "));
  const snapshot = structuredClone(take);
  // Full-take export, rounded to complete frames; a sub-second gesture gets one second of tail.
  return exportTimeline(
    snapshot.patch,
    { ...options, duration: Math.min(60, Math.max(1, snapshot.duration)) },
    {
      startTime: snapshot.startTime,
      patchAt: (elapsed) => performancePatchAt(snapshot, elapsed),
    },
  );
}

async function exportTimeline(
  patch: Patch,
  options: ExportOptions,
  timeline?: ExportTimeline,
): Promise<Blob> {
  validateOptions(options);
  checkAbort(options.signal);
  const snapshot = structuredClone(patch);
  const errors = validatePatch(snapshot);
  if (errors.length) throw new Error(errors.join(" "));
  const renderer = await createRenderer(document.createElement("canvas"), {
    width: options.width,
    height: options.height,
    preview: false,
    textureBudget: "offline",
  });
  try {
    await renderer.setPatch(snapshot);
    options.onProgress?.(0);
    let blob: Blob;
    try {
      blob = await browserExport(renderer, snapshot, options, timeline);
    } catch (error) {
      checkAbort(options.signal);
      options.onProgress?.(0);
      try {
        blob = await localExport(renderer, snapshot, options, timeline) as Blob;
      } catch (fallback) {
        checkAbort(options.signal);
        throw new Error(
          `Video export failed. Browser: ${error instanceof Error ? error.message : error} Local FFmpeg: ${fallback instanceof Error ? fallback.message : fallback}`,
        );
      }
    }
    options.onProgress?.(1);
    return blob;
  } finally {
    renderer.dispose();
  }
}

export async function startRecording(
  canvas: HTMLCanvasElement,
  options: { fps: number; onStop?: (blob: Blob) => void },
): Promise<{ stop(): Promise<Blob>; cancel(): void }> {
  if (typeof MediaRecorder === "undefined" || !canvas.captureStream)
    throw new Error(
      "Live canvas recording is unavailable in this browser. Use Export instead.",
    );
  const mimeType = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/mp4",
  ].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType)
    throw new Error("No supported live video encoder. Use Export instead.");
  const stream = canvas.captureStream(options.fps);
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
    });
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  const chunks: Blob[] = [];
  let cancelled = false;
  let failure: Error | undefined;
  let timer: ReturnType<typeof setTimeout>;
  let resolve!: (blob: Blob) => void;
  let reject!: (reason: unknown) => void;
  const result = new Promise<Blob>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void result.catch(() => {});
  const cleanup = () => {
    clearTimeout(timer);
    stream.getTracks().forEach((track) => track.stop());
  };
  recorder.ondataavailable = (event) => {
    if (!cancelled && event.data.size) chunks.push(event.data);
  };
  recorder.onerror = () => {
    failure = new Error(
      "Live recording encoder failed. Try fixed-clip Export.",
    );
    cleanup();
    reject(failure);
  };
  recorder.onstop = () => {
    cleanup();
    if (failure) return reject(failure);
    if (cancelled) return reject(abortError());
    const blob = new Blob(chunks, { type: recorder.mimeType });
    if (!blob.size)
      return reject(new Error("The recording contained no video frames."));
    resolve(blob);
    options.onStop?.(blob);
  };
  const stop = () => {
    if (recorder.state !== "inactive") recorder.stop();
    return result;
  };
  try {
    recorder.start(1000);
    timer = setTimeout(() => {
      void stop();
    }, 60_000);
  } catch (error) {
    cleanup();
    throw error;
  }
  return {
    stop,
    cancel() {
      cancelled = true;
      chunks.length = 0;
      if (recorder.state !== "inactive") recorder.stop();
      cleanup();
    },
  };
}
