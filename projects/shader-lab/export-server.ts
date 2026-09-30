import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, mkdir, copyFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  createBatchMiddleware,
  releaseDirectory,
  validAssetId,
  artifactReceipt,
} from "./batch-server";

const PREFIX = "/__visual-synth/export/jobs";
type Settings = {
  width: number;
  height: number;
  fps: number;
  frames: number;
  format: "mp4" | "webm";
};
type Job = {
  settings: Settings;
  directory: string;
  path: string;
  process: ChildProcessWithoutNullStreams;
  done: Promise<string | null>;
  count: number;
  busy: boolean;
  timer: ReturnType<typeof setTimeout>;
};

export function validExportSettings(value: unknown): value is Settings {
  if (!value || typeof value !== "object") return false;
  const s = value as Settings;
  return (
    [s.width, s.height, s.fps, s.frames].every(Number.isInteger) &&
    s.width >= 2 &&
    s.width <= 3840 &&
    s.width % 2 === 0 &&
    s.height >= 2 &&
    s.height <= 3840 &&
    s.height % 2 === 0 &&
    s.width * s.height <= 3840 * 2160 &&
    [30, 60].includes(s.fps) &&
    s.frames >= s.fps &&
    s.frames <= 60 * s.fps &&
    ["mp4", "webm"].includes(s.format)
  );
}

export function trustedExportRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress;
  if (!address || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address))
    return false;
  try {
    const origin = new URL(req.headers.origin ?? "");
    return (
      origin.protocol === "http:" &&
      origin.host === req.headers.host &&
      ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) &&
      req.headers["x-visual-synth"] === "export-v1"
    );
  } catch {
    return false;
  }
}

async function readBody(
  req: IncomingMessage,
  maximum: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > maximum)
      throw new Error("Request body exceeds the export limit.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

/** Local development helper only: no paths, command lines, or codec arguments are accepted. */
export function createExportMiddleware() {
  const jobs = new Map<string, Job>();
  let creating = 0;
  async function remove(id: string) {
    const job = jobs.get(id);
    if (!job) return;
    jobs.delete(id);
    clearTimeout(job.timer);
    job.process.stdin.destroy();
    job.process.kill();
    await job.done;
    await rm(job.directory, { recursive: true, force: true });
  }
  const touch = (id: string, job: Job) => {
    clearTimeout(job.timer);
    job.timer = setTimeout(() => {
      void remove(id);
    }, 120_000);
    job.timer.unref();
  };
  const middleware = (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    if (!(req.url ?? "").startsWith(PREFIX)) return next();
    const json = (status: number, value: unknown) => {
      if (res.headersSent) return;
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    if (!trustedExportRequest(req)) {
      json(403, { error: "Export requires a same-origin loopback request." });
      return;
    }
    void (async () => {
      const route = (req.url ?? "").slice(PREFIX.length);
      if (route === "" && req.method === "POST") {
        if (jobs.size + creating >= 2)
          return json(429, { error: "Two export jobs are already active." });
        creating++;
        try {
          const settings: unknown = JSON.parse(
            (await readBody(req, 1024)).toString(),
          );
          if (!validExportSettings(settings))
            return json(400, {
              error: "Invalid export dimensions, frame count, format, or FPS.",
            });
          const id = randomUUID();
          const directory = await mkdtemp(
            join(tmpdir(), "visual-synth-export-"),
          );
          const path = join(directory, `clip.${settings.format}`);
          const args = [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "rawvideo",
            "-pixel_format",
            "rgba",
            "-video_size",
            `${settings.width}x${settings.height}`,
            "-framerate",
            String(settings.fps),
            "-i",
            "pipe:0",
            "-an",
            "-frames:v",
            String(settings.frames),
          ];
          args.push(
            ...(settings.format === "mp4"
              ? [
                  "-c:v",
                  "libx264",
                  "-preset",
                  "fast",
                  "-crf",
                  "18",
                  "-pix_fmt",
                  "yuv420p",
                  "-movflags",
                  "+faststart",
                ]
              : [
                  "-c:v",
                  "libvpx-vp9",
                  "-deadline",
                  "realtime",
                  "-cpu-used",
                  "6",
                  "-crf",
                  "24",
                  "-b:v",
                  "0",
                  "-pix_fmt",
                  "yuv420p",
                ]),
          );
          const process = spawn("ffmpeg", [...args, path], {
            windowsHide: true,
            stdio: "pipe",
          });
          let errorText = "";
          process.stderr.on("data", (chunk) => {
            errorText = (errorText + String(chunk)).slice(-3000);
          });
          process.stdin.on("error", () => {
            /* write callback / completion reports this */
          });
          const done = new Promise<string | null>((resolve) => {
            process.once("error", (error) =>
              resolve(`FFmpeg unavailable: ${error.message}`),
            );
            process.once("close", (code) =>
              resolve(
                code === 0 ? null : `FFmpeg failed: ${errorText || code}`,
              ),
            );
          });
          const job: Job = {
            settings,
            directory,
            path,
            process,
            done,
            count: 0,
            busy: false,
            timer: setTimeout(() => {}, 0),
          };
          jobs.set(id, job);
          touch(id, job);
          return json(201, { id });
        } finally {
          creating--;
        }
      }
      const match = /^\/([a-f0-9-]{36})(?:\/(frame|finish))?$/.exec(route);
      const id = match?.[1];
      const action = match?.[2];
      if (!id || !jobs.has(id))
        return json(404, { error: "Export job not found or expired." });
      const job = jobs.get(id)!;
      if (req.method === "DELETE" && !action) {
        await remove(id);
        return json(200, { cancelled: true });
      }
      if (req.method !== "POST" || !action)
        return json(405, { error: "Unsupported export operation." });
      if (job.busy)
        return json(409, { error: "Export requests must be sequential." });
      job.busy = true;
      touch(id, job);
      try {
        if (action === "frame") {
          if (job.count >= job.settings.frames)
            return json(409, {
              error: "All requested frames have already arrived.",
            });
          const size = job.settings.width * job.settings.height * 4;
          const body = await readBody(req, size);
          if (body.length !== size)
            return json(400, {
              error: "Frame byte length does not match dimensions.",
            });
          await new Promise<void>((resolve, reject) =>
            job.process.stdin.write(body, (error) =>
              error ? reject(error) : resolve(),
            ),
          );
          job.count++;
          return json(200, { frames: job.count });
        }
        if (job.count !== job.settings.frames)
          return json(409, { error: "The export is missing frames." });
        const finishBody = await readBody(req, 512);
        const finish = finishBody.length
          ? JSON.parse(finishBody.toString())
          : {};
        if (
          finish.assetId !== undefined &&
          (!validAssetId(finish.assetId) || job.settings.format !== "mp4")
        )
          return json(400, { error: "Invalid master artifact id or format" });
        job.process.stdin.end();
        const error = await job.done;
        if (error) throw new Error(error);
        if (finish.assetId) {
          await mkdir(join(releaseDirectory, "masters"), { recursive: true });
          const path = `masters/${finish.assetId}.mp4`,
            destination = join(releaseDirectory, path);
          await copyFile(job.path, destination + ".tmp");
          await rename(destination + ".tmp", destination);
          const receipt = await artifactReceipt(path);
          await remove(id);
          return json(200, receipt);
        }
        res.writeHead(200, {
          "Content-Type": `video/${job.settings.format}`,
          "Cache-Control": "no-store",
        });
        const stream = createReadStream(job.path);
        res.once("close", () => {
          stream.destroy();
          void remove(id);
        });
        stream.once("error", () => res.destroy());
        stream.pipe(res);
      } catch (error) {
        await remove(id);
        throw error;
      } finally {
        job.busy = false;
      }
    })().catch((error) =>
      json(500, {
        error: error instanceof Error ? error.message : "Export failed.",
      }),
    );
  };
  return {
    middleware,
    close: async () => {
      await Promise.all([...jobs.keys()].map(remove));
    },
  };
}

export function visualSynthExportPlugin(): Plugin {
  return {
    name: "visual-synth-local-export",
    configureServer(server) {
      const helper = createExportMiddleware();
      const batch = createBatchMiddleware();
      server.middlewares.use(helper.middleware);
      server.middlewares.use(batch);
      server.httpServer?.once("close", () => {
        void helper.close();
        batch.close();
      });
    },
  };
}
