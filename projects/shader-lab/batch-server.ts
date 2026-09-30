import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rename, stat, rm } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { trustedExportRequest } from "./export-server";
import { validatePatch } from "./core";
import type { BatchAssetKind, BatchManifest } from "./batch-export";

export const releaseDirectory = resolve("artifacts/visual-synth/release");
export const validAssetId = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(id);
const abortError = () => new DOMException("Rendition encoding cancelled.", "AbortError");
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export async function artifactReceipt(path: string, directory = releaseDirectory) {
  const info = await stat(join(directory, path));
  if (!info.isFile() || info.size <= 0) throw new Error("Export artifact is empty or missing.");
  return { path, bytes: info.size };
}
async function readBody(req: IncomingMessage, maximum: number): Promise<string> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const part of req) {
    const bytes = Buffer.from(part); size += bytes.length;
    if (size > maximum) throw new HttpError(413, "Batch request too large.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function parse(text: string): unknown {
  try { return JSON.parse(text); } catch { throw new HttpError(400, "Invalid batch JSON."); }
}
async function atomic(directory: string, path: string, data: string) {
  const out = join(directory, path), temporary = `${out}.tmp`;
  await mkdir(dirname(out), { recursive: true });
  try { await writeFile(temporary, data); await rename(temporary, out); }
  finally { await rm(temporary, { force: true }); }
}
type Encode = (args: string[], signal: AbortSignal) => Promise<void>;
export const encodeRendition: Encode = (args, signal) => new Promise<void>((done, fail) => {
  if (signal.aborted) { fail(abortError()); return; }
  const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let detail = "", failure: Error | undefined;
  child.stderr.on("data", chunk => { detail = (detail + String(chunk)).slice(-2500); });
  const abort = () => { failure = abortError(); child.kill(); };
  const timer = setTimeout(() => { failure = new Error("Rendition encoding timed out."); child.kill(); }, 720_000);
  const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
  signal.addEventListener("abort", abort, { once: true });
  child.once("error", error => { cleanup(); fail(failure ?? error); });
  // Wait for close after cancellation so a resumed job cannot race a dying encoder.
  child.once("close", code => { cleanup(); if (failure) fail(failure); else if (code === 0) done(); else fail(new Error(detail || `Encoder exited ${code}.`)); });
  if (signal.aborted) abort();
});

const kinds: BatchAssetKind[] = ["patch", "master", "mp4", "webm", "poster"];
function expectedPath(id: string, kind: BatchAssetKind) {
  return kind === "patch" ? `patches/${id}.json` : kind === "master" ? `masters/${id}.mp4` : kind === "poster" ? `posters/${id}.jpg` : `public/${id}.${kind}`;
}
function validManifest(value: unknown): value is BatchManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as BatchManifest;
  if (manifest.version !== 1 || manifest.profile !== "divergent-release-v1" || typeof manifest.updatedAt !== "string"
    || !manifest.entries || typeof manifest.entries !== "object" || Array.isArray(manifest.entries) || Object.keys(manifest.entries).length > 100) return false;
  return Object.entries(manifest.entries).every(([id, entry]) => validAssetId(id) && entry && typeof entry === "object"
    && typeof entry.name === "string" && /^[a-f0-9]{64}$/.test(entry.fingerprint)
    && ["pending", "running", "complete", "error", "interrupted"].includes(entry.status)
    && entry.artifacts && typeof entry.artifacts === "object" && !Array.isArray(entry.artifacts)
    && Object.entries(entry.artifacts).every(([key, receipt]) => kinds.includes(key as BatchAssetKind) && receipt
      && receipt.path === expectedPath(id, key as BatchAssetKind) && Number.isSafeInteger(receipt.bytes) && receipt.bytes > 0));
}

/** Fixed local store. Directory/encoder injection is only for tests, never HTTP input. */
export function createBatchMiddleware(options: { directory?: string; encode?: Encode } = {}) {
  const directory = options.directory ? resolve(options.directory) : releaseDirectory;
  const encode = options.encode ?? encodeRendition;
  let active: AbortController | undefined;
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const prefix = "/__visual-synth/batch";
    if (!(req.url ?? "").startsWith(prefix)) return next();
    const json = (status: number, value: unknown) => {
      if (res.destroyed || res.headersSent) return;
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value));
    };
    // Browsers omit Origin on same-origin GET; a matching Referer supplies it.
    const originalOrigin = req.headers.origin;
    try { if (!originalOrigin && req.method === "GET") req.headers.origin = new URL(req.headers.referer ?? "").origin; } catch { /* Invalid/missing Referer remains untrusted. */ }
    const trusted = trustedExportRequest(req); req.headers.origin = originalOrigin;
    if (!trusted) { json(403, { error: "Batch export requires a same-origin loopback request." }); return; }
    void (async () => {
      const route = (req.url ?? "").slice(prefix.length);
      if (route === "/manifest" && req.method === "GET") {
        let value: unknown;
        try { value = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { json(404, { error: "No export batch yet." }); return; } throw error; }
        if (!validManifest(value)) throw new Error("Stored batch manifest is invalid.");
        for (const entry of Object.values(value.entries)) {
          for (const kind of kinds) {
            const receipt = entry.artifacts[kind]; if (!receipt) continue;
            try { if ((await artifactReceipt(receipt.path, directory)).bytes !== receipt.bytes) throw new Error("Artifact changed."); }
            catch { delete entry.artifacts[kind]; entry.status = "pending"; }
          }
        }
        json(200, value); return;
      }
      if (route === "/manifest" && req.method === "PUT") {
        const value = parse(await readBody(req, 1024 * 1024));
        if (!validManifest(value)) throw new HttpError(400, "Invalid batch manifest.");
        await atomic(directory, "manifest.json", JSON.stringify(value, null, 2)); json(200, { saved: true }); return;
      }
      const match = /^\/(patches|derive)\/([a-z0-9-]+)$/.exec(route);
      if (!match || !validAssetId(match[2])) throw new HttpError(404, "Unknown batch artifact.");
      const id = match[2];
      if (match[1] === "patches" && req.method === "PUT") {
        const patch = parse(await readBody(req, 256 * 1024));
        const errors = validatePatch(patch);
        if (errors.length) throw new HttpError(400, errors.join(" "));
        // Validate without migration: original v1 release JSON remains original.
        const path = `patches/${id}.json`;
        await atomic(directory, path, JSON.stringify(patch, null, 2)); json(200, await artifactReceipt(path, directory)); return;
      }
      if (match[1] === "derive" && req.method === "POST") {
        if (active) throw new HttpError(409, "Renditions are encoded one patch at a time.");
        const controller = new AbortController(); active = controller;
        const abort = () => { if (!res.writableEnded) controller.abort(); };
        res.once("close", abort); req.once("aborted", abort);
        const temporary: string[] = [];
        try {
          const value = parse(await readBody(req, 1024)) as { posterTime?: unknown } | null;
          if (!value || typeof value.posterTime !== "number" || !Number.isFinite(value.posterTime) || value.posterTime < 0 || value.posterTime > 60)
            throw new HttpError(400, "Invalid poster time.");
          const source = join(directory, "masters", `${id}.mp4`);
          try { await artifactReceipt(`masters/${id}.mp4`, directory); } catch { throw new HttpError(404, "Master artifact is missing."); }
          for (const dir of ["public", "posters"]) await mkdir(join(directory, dir), { recursive: true });
          const paths = { mp4: `public/${id}.mp4`, webm: `public/${id}.webm`, poster: `posters/${id}.jpg` };
          for (const format of ["mp4", "webm"] as const) {
            controller.signal.throwIfAborted();
            const destination = join(directory, paths[format]);
            const pending = destination.replace(`.${format}`, `.tmp.${format}`); temporary.push(pending);
            const common = ["-i", source, "-an", "-vf", "scale=1280:720,setsar=1", "-r", "30", "-map_metadata", "-1", "-pix_fmt", "yuv420p"];
            const codec = format === "mp4" ? ["-c:v", "libx264", "-preset", "fast", "-crf", "26", "-movflags", "+faststart"]
              : ["-c:v", "libvpx-vp9", "-deadline", "good", "-cpu-used", "5", "-crf", "36", "-b:v", "0"];
            await encode([...common, ...codec, pending], controller.signal);
            if ((await stat(pending)).size > 20 * 1024 * 1024) {
              const boundedCodec = format === "mp4" ? ["-c:v", "libx264", "-preset", "fast", "-b:v", "2000k", "-maxrate", "2200k", "-bufsize", "4400k", "-movflags", "+faststart"]
                : ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "6", "-b:v", "2000k", "-maxrate", "2200k", "-bufsize", "4400k"];
              await encode([...common, ...boundedCodec, pending], controller.signal);
            }
            controller.signal.throwIfAborted(); await rename(pending, destination);
          }
          const pendingPoster = join(directory, "posters", `${id}.tmp.jpg`); temporary.push(pendingPoster);
          await encode(["-ss", String(value.posterTime), "-i", source, "-frames:v", "1", "-vf", "scale=1280:720", "-q:v", "2", pendingPoster], controller.signal);
          controller.signal.throwIfAborted(); await rename(pendingPoster, join(directory, paths.poster));
          json(200, { mp4: await artifactReceipt(paths.mp4, directory), webm: await artifactReceipt(paths.webm, directory), poster: await artifactReceipt(paths.poster, directory) });
          return;
        } finally {
          res.removeListener("close", abort); req.removeListener("aborted", abort);
          await Promise.all(temporary.map(path => rm(path, { force: true }).catch(() => {})));
          active = undefined;
        }
      }
      throw new HttpError(405, "Unsupported batch operation.");
    })().catch(error => json(error instanceof HttpError ? error.status : error?.name === "AbortError" ? 499 : 500, { error: error instanceof Error ? error.message : "Batch export failed." }));
  };
  return Object.assign(middleware, { close: () => active?.abort() });
}
