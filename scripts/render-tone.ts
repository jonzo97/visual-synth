// Headless audio-to-frames render: 10 s of a test tone (or a WAV you pass) drives the real
// Visual Synth renderer on a native GPU, one PNG per frame, plus evenly spaced stills and a
// contact sheet. No browser, no window. Linux and Windows alike.
//
//   npm run render:tone -- [options]
//   (= npx vite-node --config scripts/headless/vite.config.ts scripts/render-tone.ts -- [options])
//     --out DIR        output folder (default artifacts/render-tone; artifacts/ is gitignored)
//     --wav FILE       16-bit PCM WAV to analyse instead of the built-in test tone
//     --seconds N      length to render (default 10)
//     --fps N          frame rate (default 30)
//     --size WxH       frame size (default 640x360)
//     --stills N       evenly spaced stills copied to OUT/stills (default 6)
//   VGPU_ADAPTER=software forces the CPU renderer (run `npx vgpu install-software-renderer` once).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import { createNode, type Patch } from "../projects/shader-lab/core";
import { createRenderer } from "../projects/shader-lab/renderer";
import { screens } from "./headless/vgpu-node-shim";

const argv = process.argv.slice(2).filter((a) => a !== "--");
const opt = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const out = resolve(opt("out", "artifacts/render-tone"));
const seconds = Number(opt("seconds", "10"));
const fps = Number(opt("fps", "30"));
const [width, height] = opt("size", "640x360").split("x").map(Number) as [number, number];
const stillCount = Number(opt("stills", "6"));
const wavPath = opt("wav", "");
const RATE = 48_000;
if (![seconds, fps, width, height, stillCount].every((n) => Number.isFinite(n) && n > 0))
  throw new Error("--seconds, --fps, --size and --stills must be positive numbers");

/** The test tone: a sine gliding 110 -> 880 Hz with an octave overtone, pulsed at 120 BPM. */
function testTone(): Float32Array {
  const n = Math.round(seconds * RATE);
  const s = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const hz = 110 * Math.pow(8, t / seconds);
    phase += (2 * Math.PI * hz) / RATE;
    const beat = (t * 2) % 1; // 120 BPM
    const env = 0.25 + 0.75 * Math.exp(-beat * 6);
    s[i] = env * (0.7 * Math.sin(phase) + 0.3 * Math.sin(2 * phase)) * 0.8;
  }
  return s;
}

function writeWav(path: string, s: Float32Array) {
  const b = Buffer.alloc(44 + s.length * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + s.length * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(s.length * 2, 40);
  s.forEach((v, i) => b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
  writeFileSync(path, b);
}

/** 16-bit PCM WAV reader (first channel). Enough for pw-record / arecord / Audacity output. */
function readWav(path: string): { samples: Float32Array; rate: number } {
  const b = readFileSync(path);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") throw new Error("Not a WAV file");
  let off = 12;
  let channels = 1;
  let rate = RATE;
  let bits = 16;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === "fmt ") {
      channels = b.readUInt16LE(off + 10);
      rate = b.readUInt32LE(off + 12);
      bits = b.readUInt16LE(off + 22);
    }
    if (id === "data") {
      if (bits !== 16) throw new Error("Only 16-bit PCM WAV is supported");
      const end = Math.min(b.length, off + 8 + size);
      const frames = Math.floor((end - off - 8) / (2 * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = b.readInt16LE(off + 8 + i * 2 * channels) / 32768;
      return { samples, rate };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

/** Per-frame loudness (RMS) and pitch (zero-crossing estimate) from one frame-long window. */
function analyse(samples: Float32Array, rate: number) {
  const frames = Math.round(seconds * fps);
  const win = Math.max(2, Math.round(rate / fps));
  return Array.from({ length: frames }, (_, f) => {
    const start = Math.max(0, Math.round((f / fps) * rate) - (win >> 1));
    let sum = 0;
    let crossings = 0;
    let prev = samples[start] ?? 0;
    for (let i = start; i < start + win && i < samples.length; i++) {
      const v = samples[i]!;
      sum += v * v;
      if (prev < 0 !== v < 0) crossings++;
      prev = v;
    }
    return { rms: Math.sqrt(sum / win), hz: (crossings / 2) * (rate / win) };
  });
}

// Operator Bloom (the synth's FM-style generator) -> Glow -> Impulse reverb -> screen.
function basePatch(): Patch {
  const op = createNode("operator", "op");
  Object.assign(op.params, { frequency: 8, ratio: 1.5, depth: 2.4, palette: 6, smoothing: 0.3 });
  const glow = createNode("fx.glow", "glow");
  glow.params.amount = 0.5;
  const verb = createNode("fx.reverb", "verb");
  verb.params.amount = 0.35;
  return {
    version: 2,
    name: "Test tone (headless)",
    nodes: [op, glow, verb, createNode("output", "output")],
    connections: [
      { id: "a", from: { node: "op", port: "frame" }, to: { node: "glow", port: "in" } },
      { id: "b", from: { node: "glow", port: "frame" }, to: { node: "verb", port: "in" } },
      { id: "c", from: { node: "verb", port: "frame" }, to: { node: "output", port: "in" } },
    ],
    events: [],
    transport: { bpm: 120, loopSeconds: seconds },
    simulation: { tickHz: 60, warmupTicks: 0, events: [] },
  };
}

function writePng(path: string, rgba: Uint8Array, w: number, h: number) {
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(rgba);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
  writeFileSync(path, PNG.sync.write(png));
}

/** Grid of frames scaled to thumbnails (nearest neighbour), each with a loudness bar beneath. */
function contactSheet(frames: { rgba: Uint8Array; rms: number }[], cols: number, peak: number) {
  const tw = 320;
  const th = Math.round((tw * height) / width);
  const bar = 6;
  const pad = 4;
  const rows = Math.ceil(frames.length / cols);
  const W = cols * (tw + pad) + pad;
  const H = rows * (th + bar + pad) + pad;
  const png = new PNG({ width: W, height: H });
  png.data.fill(18);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
  frames.forEach(({ rgba, rms }, k) => {
    const ox = pad + (k % cols) * (tw + pad);
    const oy = pad + Math.floor(k / cols) * (th + bar + pad);
    for (let y = 0; y < th; y++)
      for (let x = 0; x < tw; x++) {
        const s = (Math.floor((y * height) / th) * width + Math.floor((x * width) / tw)) * 4;
        const d = ((oy + y) * W + ox + x) * 4;
        png.data[d] = rgba[s]!;
        png.data[d + 1] = rgba[s + 1]!;
        png.data[d + 2] = rgba[s + 2]!;
      }
    const filled = Math.round((tw * rms) / peak);
    for (let y = 0; y < bar - 2; y++)
      for (let x = 0; x < tw; x++) {
        const d = ((oy + th + 2 + y) * W + ox + x) * 4;
        png.data[d] = png.data[d + 1] = png.data[d + 2] = x < filled ? 220 : 60;
      }
  });
  return PNG.sync.write(png);
}

async function main() {
  mkdirSync(join(out, "frames"), { recursive: true });
  mkdirSync(join(out, "stills"), { recursive: true });
  let samples: Float32Array;
  let rate = RATE;
  if (wavPath) ({ samples, rate } = readWav(wavPath));
  else {
    samples = testTone();
    writeWav(join(out, "test-tone.wav"), samples);
  }
  const bands = analyse(samples, rate);
  const peak = Math.max(1e-6, ...bands.map((b) => b.rms));
  const base = basePatch();
  // Loudness -> modulation depth and glow; pitch (log scale, 110-880 Hz) -> carrier cycles and direction.
  const patchAt = (time: number): Patch => {
    const b = bands[Math.min(bands.length - 1, Math.max(0, Math.round(time * fps)))]!;
    const loud = b.rms / peak;
    const pitch = Math.min(1, Math.max(0, Math.log2(Math.max(b.hz, 1) / 110) / 3));
    const p = structuredClone(base);
    const [op, glow] = p.nodes;
    op!.params.depth = 0.4 + 4 * loud;
    op!.params.frequency = 2 + 8 * pitch;
    op!.params.angle = -1.2 + 2.4 * pitch;
    glow!.params.amount = 0.1 + 0.35 * loud;
    return p;
  };

  const renderer = await createRenderer({} as HTMLCanvasElement, { width, height, preview: false });
  await renderer.setPatch(base);
  const total = bands.length;
  const spaced = (n: number) => new Set(Array.from({ length: n }, (_, k) => Math.min(total - 1, Math.floor(((k + 0.5) * total) / n))));
  const stillAt = spaced(stillCount);
  const sheetAt = spaced(12);
  const sheet: { rgba: Uint8Array; rms: number }[] = [];
  const t0 = Date.now();
  for (let f = 0; f < total; f++) {
    const time = f / fps;
    await renderer.renderAt(time, { patchAt });
    await renderer.settled();
    const screen = screens.at(-1);
    if (!screen) throw new Error("Renderer created no offscreen screen");
    const rgba = await screen.read();
    const name = `frame-${String(f).padStart(4, "0")}.png`;
    writePng(join(out, "frames", name), rgba, width, height);
    if (stillAt.has(f)) copyFileSync(join(out, "frames", name), join(out, "stills", `still-${time.toFixed(2)}s.png`));
    if (sheetAt.has(f)) sheet.push({ rgba: rgba.slice(), rms: bands[f]!.rms });
    if (f % 60 === 0) console.info(`frame ${f}/${total} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  writeFileSync(join(out, "contact-sheet.png"), contactSheet(sheet, 4, peak));
  renderer.dispose();
  console.info(`Wrote ${total} frames, ${stillAt.size} stills and contact-sheet.png to ${out} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
