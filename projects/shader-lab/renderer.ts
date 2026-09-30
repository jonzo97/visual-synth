import { VideoFrames, VideoMediaError } from "./video-media";
import { isSimulation } from "./generators/simulation";
import {
  createSimulationPass,
  type SimulationPass,
} from "./simulation-runtime";
import { effectShaders, effectBindings } from "./effects/shaders";
import { createAttractorPass, type AttractorPass } from "./attractor-runtime";
import {
  planFrames,
  checkTextureBudget,
  nodeTextureBytes,
  historySize,
  type TextureBudgetMode,
} from "./render-plan";
import {
  init,
  effect,
  frame,
  surface,
  target,
  sampler,
  type Effect,
  type Target,
  type Texture,
} from "vgpu";
import { generatorShaders } from "./generators/shaders";
import post from "./post.wgsl?raw";
import mixer4 from "./mixer4.wgsl?raw";
import {
  validatePatch,
  evaluateParameters,
  isEffect,
  isGenerator,
  isMixer,
  type Patch,
  type SynthNode,
  type SimulationEvent,
} from "./core";
import {
  isLabDevice,
  isLabEffect,
  isLabSource,
  labEffectFallbackShader,
  labParams,
  labSourceFallbackShader,
} from "./lab-device";

const copy = `@group(0) @binding(0) var src:texture_2d<f32>; @group(0) @binding(1) var samp:sampler;
@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f{return textureSampleLevel(src,samp,uv,0);}`;
const mixer = `@group(0) @binding(0) var a:texture_2d<f32>; @group(0) @binding(1) var b:texture_2d<f32>;
@group(0) @binding(2) var samp:sampler; @group(0) @binding(3) var<uniform> amount:f32;
@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f{return mix(textureSampleLevel(a,samp,uv,0),textureSampleLevel(b,samp,uv,0),amount);}`;
const kinds: Record<string, number> = {
  "fx.glow": 1,
  "fx.bayer": 2,
  "fx.delay": 3,
  "fx.reverb": 4,
  "fx.crush": 5,
  "fx.vhs": 6,
};
type OwnedTarget = Target & { destroy(): void };
interface DevicePass {
  node: SynthNode;
  out: OwnedTarget;
  fx: Effect;
  labFallback?: "effect" | "source";
  history: OwnedTarget[];
  copy?: Effect;
  simulation?: SimulationPass;
  attractor?: AttractorPass;
  videoTexture?: Texture;
  head: number;
  count: number;
}
export interface RenderAtOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  patchAt?: (time: number) => Patch;
}
export interface SynthRenderer {
  canvas: HTMLCanvasElement;
  setPatch(patch: Patch): Promise<void>;
  render(time: number): void;
  renderAt(time: number, options?: RenderAtOptions): Promise<void>;
  readFrame(): Promise<Uint8Array>;
  settled(): Promise<void>;
  reset(): void;
  /** Performance-only input: applied to the next simulation tick, never recorded in the patch. */
  live(event: Omit<SimulationEvent, "time">): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/** The caller supplies time. Preview and offline export execute this same graph. */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  options: { width?: number; height?: number; preview?: boolean; textureBudget?: TextureBudgetMode } = {},
): Promise<SynthRenderer> {
  const gpu = await init();
  try {
    let error: Error | undefined;
    gpu.onError((e) => {
      error = e;
    });
    const fit = (w: number, h: number): [number, number] => {
      if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1)
        throw new Error("Invalid render dimensions");
      const scale =
        options.preview === false ? 1 : Math.min(1, 1100 / w, 700 / h);
      if (
        w * scale > gpu.gpu.limits.maxTextureDimension2D ||
        h * scale > gpu.gpu.limits.maxTextureDimension2D
      )
        throw new Error("Render dimensions exceed this GPU�s texture limit");
      return [
        Math.max(1, Math.round(w * scale)),
        Math.max(1, Math.round(h * scale)),
      ];
    };
    let [width, height] = fit(options.width ?? 1100, options.height ?? 619);
    const screen = surface(gpu, canvas, {
      autoResize: false,
      size: [width, height],
      dpr: 1,
    });
    const samp = sampler(gpu, {
      minFilter: "linear",
      magFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    const make = (w = width, h = height) => {
      if (
        w > gpu.gpu.limits.maxTextureDimension2D ||
        h > gpu.gpu.limits.maxTextureDimension2D
      )
        throw new Error("History atlas exceeds this GPU texture limit");
      return target(gpu, {
        size: [w, h],
        format: "rgba16float",
      }) as OwnedTarget;
    };
    const black = target(gpu, {
      size: [1, 1],
      format: "rgba16float",
    }) as OwnedTarget;
    const output = effect(gpu, copy, { set: { src: black, samp } });
    await output.compile({ colors: [screen.format] });
    let patch: Patch | undefined,
      signature = "",
      passes: DevicePass[] = [],
      lastTime = -Infinity,
      lastTick = -Infinity,
      clear = true,
      disposed = false,
      stateTick: number | undefined,
      initialKey = "",
      busy = false,
      advancing = true,
      revision = 0,
      displayDirty = true;
    const liveEvents: Omit<SimulationEvent, "time">[] = [];
    const reset = () => {
      liveEvents.length = 0;
      clear = true;
      stateTick = undefined;
      lastTime = -Infinity;
      lastTick = -Infinity;
      for (const pass of passes) {
        pass.simulation?.reset();
        pass.head = 0;
        pass.count = 0;
      }
    };
    const destroy = (items: DevicePass[]) => {
      for (const p of items) {
        p.simulation?.dispose();
        p.attractor?.dispose();
        p.videoTexture?.destroy();
        p.out.destroy();
        p.history.forEach((t) => t.destroy());
      }
    };
    const effectPool = new Map<string, Effect[]>();
    const videos = new VideoFrames();
    let preparedVideoTime: number | undefined;
    const labCompilationError = async (shader: string): Promise<string | undefined> => {
      // gpu.gpu is the raw GPUDevice (gpu.device is vgpu's wrapper). The error scope keeps a bad
      // lab shader from reaching the device's uncaptured-error path, which would pause rendering.
      const device = gpu.gpu as GPUDevice | undefined;
      if (!device?.createShaderModule) return undefined;
      device.pushErrorScope("validation");
      const module = device.createShaderModule({ code: shader });
      const scoped = device.popErrorScope().catch(() => null);
      const info = await module.getCompilationInfo?.();
      const scopeError = await scoped;
      const message = info?.messages.find((item) => item.type === "error");
      return message?.message ?? scopeError?.message;
    };
    const firstLine = (error: unknown, fallback = "Lab device failed") =>
      (error instanceof Error ? error.message : String(error || fallback))
        .split("\n")[0]!
        .slice(0, 180);
    const fallbackLabEffect = (
      node: SynthNode,
      out: OwnedTarget,
      kind: "effect" | "source",
      reason: unknown,
    ) => {
      node.labError = firstLine(reason, "Lab shader compile failed");
      const fx = effect(
        gpu,
        kind === "effect" ? labEffectFallbackShader : labSourceFallbackShader,
        { set: kind === "effect" ? { src: black, samp } : {} },
      );
      fx.compileSync(out);
      return fx;
    };
    const prepareVideos = async (time: number, check: () => void) => {
      if (!patch) return;
      const values = evaluateParameters(patch!, time);
      videos.retain(new Set(patch.nodes.filter(n => n.media && passes.some(p => p.node.id === n.id)).map(n => n.media!.id)));
      for (const pass of passes) {
        if (pass.node.type !== "video") continue;
        const node = patch!.nodes.find(n => n.id === pass.node.id)!;
        if (!node.media) throw new VideoMediaError("Video has no file. Select the Video device and choose a local MP4/WebM, then press Play.");
        const params = values[node.id]!;
        const source = await videos.draw(node.media.id, time, params.speed!, params.start!, width, height, check);
        check();
        if (!pass.videoTexture) pass.videoTexture = gpu.device.createTexture({ size: [width, height], format: "rgba8unorm", usage: ["copy_dst", "render_attachment", "texture_binding"] });
        gpu.gpu.queue.copyExternalImageToTexture({ source }, { texture: pass.videoTexture.gpu }, [width, height]);
      }
      preparedVideoTime = time;
    };
    const api: SynthRenderer = {
      canvas,
      live(event) {
        // Bounded so a fast pointer cannot queue unbounded work between frames.
        if (liveEvents.length < 16) liveEvents.push(event);
      },
      async setPatch(next) {
        revision++;
        preparedVideoTime = undefined;
        displayDirty = true;
        const errors = validatePatch(next);
        if (errors.length) throw new Error(errors.join("\n"));
        const plan = planFrames(next),
          topology =
            plan.signature +
            JSON.stringify(
              plan.nodes
                .filter((n) => isSimulation(n.type))
                .map((n) => [n.id, n.params.grid]),
            );
        const nextInitialKey = JSON.stringify([
          next.simulation ?? null,
          plan.nodes.filter(n => n.type === "video").map(n => [n.id, n.media?.id]),
          plan.nodes
            .filter((n) => isSimulation(n.type))
            .map((n) => [n.id, n.params.seed, n.params.grid, n.params.states]),
        ]);
        if (nextInitialKey !== initialKey) {
          reset();
          initialKey = nextInitialKey;
        }
        if (topology !== signature) {
          const fresh: DevicePass[] = [],
            allocated: OwnedTarget[] = [];
          const reusable = new Map(passes.map((p) => [p.node.id, p]));
          const obsolete = passes.filter(
            (p) =>
              !plan.nodes.some(
                (n) =>
                  n.id === p.node.id &&
                  n.type === p.node.type &&
                  (!isSimulation(n.type) ||
                    n.params.grid === p.node.params.grid),
              ),
          );
          checkTextureBudget(
            plan.nodes,
            width,
            height,
            0,
            obsolete.reduce(
              (sum, p) => sum + nodeTextureBytes(p.node, width, height),
              0,
            ),
            options.textureBudget,
          );
          const slots = new Map<string, number>();
          const pooled = (
            family: string,
            create: () => Effect,
            preferred?: Effect,
          ) => {
            const slot = slots.get(family) ?? 0;
            slots.set(family, slot + 1);
            let items = effectPool.get(family);
            if (!items) {
              items = [];
              effectPool.set(family, items);
            }
            if (preferred) {
              const previous = items.indexOf(preferred);
              if (previous >= 0 && previous !== slot) {
                [items[slot], items[previous]] = [
                  items[previous]!,
                  items[slot]!,
                ];
              } else if (previous < 0) items.splice(slot, 0, preferred);
            }
            return items[slot] ?? (items[slot] = create());
          };
          try {
            for (const previous of passes) {
              if (previous.simulation && !obsolete.includes(previous))
                previous.simulation.reserve(pooled);
            }
            for (const node of plan.nodes) {
              if (
                !isGenerator(node.type) &&
                !isMixer(node.type) &&
                !isEffect(node.type)
              )
                continue;
              const allocate = (w = width, h = height) => {
                const t = make(w, h);
                allocated.push(t);
                return t;
              };
              const previous = reusable.get(node.id);
              const reuse =
                previous?.node.type === node.type &&
                (!isSimulation(node.type) ||
                  previous.node.params.grid === node.params.grid)
                  ? previous
                  : undefined;
              const out = reuse?.out ?? allocate(),
                history =
                  reuse?.history ??
                  (node.type === "fx.delay" || node.type === "fx.reverb"
                    ? Array.from({ length: 4 }, () => allocate())
                    : node.type === "fx.chrono"
                      ? [
                          allocate(
                            historySize(width, height)[0] * 8,
                            historySize(width, height)[1] * 4,
                          ),
                        ]
                      : node.type === "fx.feedback"
                        ? [allocate(...historySize(width, height))]
                        : []);
              const simulation =
                reuse?.simulation ??
                (isSimulation(node.type)
                  ? createSimulationPass(gpu, node, pooled)
                  : undefined);
              const attractor =
                reuse?.attractor ??
                (node.type === "attractor" ? createAttractorPass(gpu) : undefined);
              const shader = isGenerator(node.type)
                ? node.type === "video" ? copy : generatorShaders[node.type]!
                : isMixer(node.type)
                  ? node.type === "mixer4" ? mixer4 : mixer
                  : (effectShaders[node.type] ?? post);
              const initialSet = node.type === "video" ? { src: black, samp } : Object.hasOwn(effectShaders, node.type)
                ? effectBindings(node.type, {
                    src: black,
                    field: black,
                    b: black,
                    mask: black,
                    history: history[0] ?? black,
                    samp,
                    params: isLabEffect(node.type)
                      ? labParams(node.type, node.params, 0, width, height)
                      : {
                          ...node.params,
                          phase: 0,
                          width,
                          height,
                          valid: 0,
                          hasField: 0,
                          hasMask: 0,
                          head: 0,
                          count: 0,
                        },
                  })
                : isGenerator(node.type)
                  ? {
                      ...(simulation
                        ? { state: simulation.current() }
                        : {}),
                      ...(attractor
                        ? { bins: attractor.bins, peak: attractor.peak }
                        : {}),
                      params: isLabSource(node.type)
                        ? labParams(node.type, node.params, 0, width, height)
                        : {
                            ...node.params,
                            phase: 0,
                            aspect: width / height,
                          },
                    }
                  : node.type === "mixer4"
                    ? { a: black, b: black, c: black, d: black, samp, params: node.params }
                  : node.type === "mixer"
                    ? {
                        a: black,
                        b: black,
                        samp,
                        amount: node.params.mix,
                      }
                  : {
                      src: black,
                      hist1: black,
                      hist2: black,
                      hist3: black,
                      samp,
                      fx: {
                        kind: kinds[node.type],
                        amount: node.params.amount,
                        phase: 0,
                        width,
                        height,
                        valid: 0,
                        threshold: 0,
                        scale: 2,
                      },
                    };
              let labFallback: DevicePass["labFallback"];
              node.labError = undefined;
              let fx: Effect;
              try {
                fx = pooled(
                  // An attractor effect is bound to its node's own storage buffers, so it is
                  // never shared between attractor nodes; other generators pool by type.
                  node.type === "attractor"
                    ? `attractor:${node.id}`
                    : isGenerator(node.type)
                    ? node.type
                    : isMixer(node.type)
                      ? node.type
                      : Object.hasOwn(effectShaders, node.type)
                        ? node.type
                        : "post",
                  () =>
                    effect(
                      gpu,
                      shader,
                      { set: initialSet },
                    ),
                );
              } catch (bindingError) {
                if (!isLabDevice(node.type)) throw bindingError;
                labFallback = isLabEffect(node.type) ? "effect" : "source";
                fx = fallbackLabEffect(node, out, labFallback, bindingError);
              }
              if (isLabDevice(node.type)) {
                const labCompileMessage = await labCompilationError(shader);
                try {
                  if (labCompileMessage) throw new Error(labCompileMessage);
                  fx.compileSync(out);
                } catch (compileError) {
                  labFallback = isLabEffect(node.type) ? "effect" : "source";
                  fx = fallbackLabEffect(node, out, labFallback, compileError);
                }
              }
              const pass: DevicePass = {
                node,
                simulation,
                attractor,
                videoTexture: reuse?.videoTexture,
                out,
                fx,
                labFallback,
                history,
                head: 0,
                count: 0,
              };
              fresh.push(pass);
              if (!isLabDevice(node.type)) fx.compileSync(out);
              if (history.length) {
                pass.copy = pooled("history-copy", () =>
                  effect(gpu, copy, { set: { src: black, samp } }),
                );
                pass.copy.compileSync(out);
              }
            }
          } catch (e) {
            fresh
              .filter(
                (p) => !passes.some((old) => old.simulation === p.simulation),
              )
              .forEach((p) => p.simulation?.dispose());
            fresh
              .filter((p) => !passes.some((old) => old.attractor === p.attractor))
              .forEach((p) => p.attractor?.dispose());
            allocated.forEach((t) => t.destroy());
            throw e;
          }
          destroy(obsolete);
          passes = fresh;
          signature = topology;
          reset();
        }
        patch = structuredClone(next);
      },
      render(time) {
        if (disposed) throw new Error("Renderer disposed");
        if (error) throw error;
        if (!patch) return;
        if (!Number.isFinite(time))
          throw new Error("Render time must be finite");
        if (passes.some(p => p.node.type === "video") && preparedVideoTime !== time)
          throw new Error("Video sources require asynchronous renderAt(time).");
        if (time < lastTime) reset();
        const values = evaluateParameters(patch, time);
        const phase =
          ((((time % patch.transport.loopSeconds) +
            patch.transport.loopSeconds) %
            patch.transport.loopSeconds) /
            patch.transport.loopSeconds) *
          Math.PI *
          2;
        const tick = Math.floor((time + 1e-7) / 0.12),
          capture = tick > lastTick;
        const textures = new Map(passes.map((p) => [p.node.id, p.out]));
        const input = (id: string, port: string) => {
          const edge = patch!.connections.find(
            (e) => e.to.node === id && e.to.port === port,
          );
          return edge ? (textures.get(edge.from.node) ?? black) : black;
        };
        if (advancing)
          for (const p of passes) {
            if (!p.simulation) continue;
            const tick60 = Math.floor((time + 1e-7) * 60);
            const events = (patch.simulation?.events ?? []).filter(
              (e) =>
                e.node === p.node.id &&
                Math.ceil((e.time - 1e-7) * 60) === tick60,
            );
            for (const e of liveEvents) if (e.node === p.node.id) events.push({ ...e, time });
            // Aspect lets a simulation map screen-space inject points into its own field.
            p.simulation.step(values[p.node.id]!, tick60, events, width / height);
          }
        // Live input is for the very next advancing tick only; a paused, seeking or redrawn
        // frame drops it rather than holding it for some later step.
        liveEvents.length = 0;
        // Stateless exposures are recomputed for this exact time before the frame is encoded.
        for (const p of passes)
          p.attractor?.run(values[p.node.id]!, phase);
        frame(gpu, (f) => {
          if (clear) {
            f.pass({ target: black, clear: [0, 0, 0, 1] }, () => {});
            for (const p of passes)
              for (const t of p.history)
                f.pass({ target: t, clear: [0, 0, 0, 1] }, () => {});
            clear = false;
          }
          for (const p of passes) {
            if (
              !advancing &&
              !displayDirty &&
              ["fx.delay", "fx.reverb", "fx.chrono", "fx.feedback"].includes(
                p.node.type,
              )
            )
              continue;
            const params = values[p.node.id]!;
            try {
            if (p.node.type === "video") {
              p.fx.set({ src: p.videoTexture! });
            } else if (p.labFallback === "effect") {
              p.fx.set({ src: input(p.node.id, "in"), samp });
            } else if (p.labFallback === "source") {
              p.fx.set({});
            } else if (p.simulation) {
              p.fx.set({
                state: p.simulation.current(),
                params: { ...params, phase, aspect: width / height },
              });
            } else if (Object.hasOwn(effectShaders, p.node.type)) {
              const src = input(p.node.id, "in");
              const has = (port: string) =>
                patch!.connections.some(
                  (e) => e.to.node === p.node.id && e.to.port === port,
                );
              p.fx.set(
                effectBindings(p.node.type, {
                  src,
                  field: input(p.node.id, "field"),
                  b: has("b") ? input(p.node.id, "b") : src,
                  mask: input(p.node.id, "mask"),
                  history: p.history[0] ?? black,
                  params: {
                    ...(isLabEffect(p.node.type)
                      ? labParams(p.node.type, params, time, width, height)
                      : {
                          ...params,
                          phase,
                          width,
                          height,
                          valid: p.count > 0 ? 1 : 0,
                          hasField: has("field") ? 1 : 0,
                          hasMask: has("mask") ? 1 : 0,
                          head: p.head,
                          count: p.count,
                        }),
                  },
                }),
              );
            } else if (isGenerator(p.node.type))
              p.fx.set({
                // Pooled effects outlive passes: rebind this pass's own attractor buffers.
                ...(p.attractor ? { bins: p.attractor.bins, peak: p.attractor.peak } : {}),
                params: isLabSource(p.node.type)
                  ? labParams(p.node.type, params, time, width, height)
                  : { ...params, phase, aspect: width / height },
              });
            else if (p.node.type === "mixer4") {
              const levels = { ...params };
              for (const port of ["a", "b", "c", "d"])
                if (!patch!.connections.some(e => e.to.node === p.node.id && e.to.port === port))
                  levels[`level${port.toUpperCase()}`] = 0;
              p.fx.set({ a: input(p.node.id,"a"), b: input(p.node.id,"b"),
                c: input(p.node.id,"c"), d: input(p.node.id,"d"), params: levels });
            }
            else if (p.node.type === "mixer")
              p.fx.set({
                a: input(p.node.id, "a"),
                b: input(p.node.id, "b"),
                amount: params.mix,
              });
            else
              p.fx.set({
                src: input(p.node.id, "in"),
                hist1: p.history[(p.head + 3) % 4] ?? black,
                hist2: p.history[(p.head + 2) % 4] ?? black,
                hist3: p.history[(p.head + 1) % 4] ?? black,
                fx: {
                  kind: kinds[p.node.type],
                  amount: params.amount,
                  phase,
                  width,
                  height,
                  valid: p.count >= 3 ? 1 : 0,
                  threshold: params.threshold ?? 0,
                  scale: params.scale ?? 2,
                },
              });
            } catch (bindingError) {
              if (!isLabDevice(p.node.type) || p.labFallback) throw bindingError;
              p.labFallback = isLabEffect(p.node.type) ? "effect" : "source";
              p.fx = fallbackLabEffect(p.node, p.out, p.labFallback, bindingError);
              p.fx.set(p.labFallback === "effect" ? { src: input(p.node.id, "in"), samp } : {});
            }
            f.pass(p.out, p.fx);
            if (!advancing) continue;
            if (p.copy && p.node.type === "fx.chrono") {
              if (
                Math.floor((time + 1e-7) * 15) >
                Math.floor((lastTime + 1e-7) * 15)
              ) {
                const [w, h] = historySize(width, height);
                p.copy.set({ src: input(p.node.id, "in") });
                f.pass(
                  {
                    target: p.history[0]!,
                    clear: false,
                    viewport: {
                      x: (p.head % 8) * w,
                      y: Math.floor(p.head / 8) * h,
                      width: w,
                      height: h,
                    },
                  },
                  p.copy,
                );
                p.head = (p.head + 1) % 32;
                p.count = Math.min(32, p.count + 1);
              }
            } else if (p.copy && p.node.type === "fx.feedback") {
              p.copy.set({ src: p.out });
              f.pass(p.history[0]!, p.copy);
              p.count = 1;
            } else if (capture && p.copy) {
              p.copy.set({ src: input(p.node.id, "in") });
              f.pass(p.history[p.head]!, p.copy);
              p.head = (p.head + 1) % 4;
              p.count = Math.min(4, p.count + 1);
            }
          }
          const node = patch!.nodes.find((n) => n.type === "output")!;
          output.set({ src: input(node.id, "in") });
          f.pass(screen, output);
        });
        lastTime = time;
        if (capture && advancing) lastTick = tick;
      },
      async renderAt(time, options = {}) {
        if (!Number.isFinite(time))
          throw new Error("Render time must be finite");
        if (busy)
          throw new Error("A renderer can advance only one frame at a time");
        busy = true;
        const currentRevision = revision;
        const check = () => {
          if (disposed) throw new Error("Renderer disposed");
          if (options.signal?.aborted || revision !== currentRevision)
            throw new DOMException("Render cancelled", "AbortError");
        };
        try {
          check();
          const stateful = passes.some(
            (p) =>
              p.simulation ||
              p.node.type === "fx.chrono" ||
              p.node.type === "fx.feedback",
          );
          if (!stateful) {
            if (options.patchAt) patch = structuredClone(options.patchAt(time));
            await prepareVideos(time, check);
            check();
            api.render(time);
            return;
          }
          const targetTick = Math.floor((time + 1e-7) * 60);
          const origin = passes.some((p) => p.simulation)
            ? -(patch?.simulation?.warmupTicks ?? 0)
            : -120;
          if (stateTick === undefined || targetTick < stateTick) {
            reset();
            stateTick = Math.min(origin, targetTick) - 1;
          }
          const first = stateTick!,
            total = Math.max(1, targetTick - first);
          let cursor = first;
          for (; cursor < targetTick;) {
            check();
            const nextTick = cursor + 1,
              t = nextTick / 60;
            if (options.patchAt) patch = structuredClone(options.patchAt(t));
            await prepareVideos(t, check);
            check();
            api.render(t);
            cursor = nextTick;
            stateTick = nextTick;
            if ((cursor - first) % 8 === 0) {
              await api.settled();
              options.onProgress?.((cursor - first) / total);
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          }
          if(cursor>first)displayDirty=false;
          if (
            (first === targetTick && displayDirty) ||
            Math.abs(time - targetTick / 60) > 1e-7
          ) {
            advancing = false;
            try {
              if (options.patchAt)
                patch = structuredClone(options.patchAt(time));
              await prepareVideos(time, check);
              check();
              api.render(time);
            } finally {
              advancing = true;
            }
          }
          displayDirty = false;
          options.onProgress?.(1);
        } finally {
          busy = false;
        }
      },
      async readFrame() {
        await api.settled();
        const out = patch?.nodes.find((n) => n.type === "output");
        const id = patch?.connections.find(
          (e) => e.to.node === out?.id && e.to.port === "in",
        )?.from.node;
        const pass = passes.find((p) => p.node.id === id);
        if (!pass) throw new Error("No rendered output");
        return pass.out.read();
      },
      async settled() {
        await gpu.settled();
        await gpu.gpu.queue.onSubmittedWorkDone();
        if (error) throw error;
      },
      reset() {
        revision++;
        preparedVideoTime = undefined;
        reset();
      },
      resize(w, h) {
        revision++;
        preparedVideoTime = undefined;
        displayDirty = true;
        const dimensions = fit(w, h);
        checkTextureBudget(
          passes.map((p) => p.node),
          ...dimensions,
          0,
          0,
          options.textureBudget,
        );
        [width, height] = dimensions;
        screen.resize([width, height]);
        for (const p of passes) {
          p.out.resize([width, height]);
          p.videoTexture?.destroy();
          p.videoTexture = undefined;
          if (p.node.type === "fx.chrono") {
            const [w, h] = historySize(width, height);
            p.history[0]!.resize([w * 8, h * 4]);
          } else if (p.node.type === "fx.feedback")
            p.history[0]!.resize(historySize(width, height));
          else p.history.forEach((t) => t.resize([width, height]));
        }
        clear = true;
        lastTick = -Infinity;
        lastTime = -Infinity;
        for (const p of passes) {
          p.head = 0;
          p.count = 0;
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        videos.dispose();
        destroy(passes);
        black.destroy();
        screen.dispose();
        gpu.dispose();
      },
    };
    return api;
  } catch (e) {
    gpu.dispose();
    throw e;
  }
}
