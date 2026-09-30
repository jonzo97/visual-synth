import { validatePatch, type Patch } from "./core";
import { exportClipToArtifact, type ExportArtifact, type ExportOptions } from "./export";

export interface BatchPreset {
  id: string;
  bank: string;
  name: string;
  description: string;
  patch: Patch;
  duration: number;
  loopable: boolean;
  controls: unknown;
}
export type BatchAssetKind = "patch" | "master" | "mp4" | "webm" | "poster";
export type BatchArtifacts = Partial<Record<BatchAssetKind, ExportArtifact>>;
export interface BatchEntry {
  fingerprint: string;
  name: string;
  status: "pending" | "running" | "complete" | "error" | "interrupted";
  artifacts: BatchArtifacts;
  error?: string;
}
export interface BatchManifest {
  version: 1;
  profile: "divergent-release-v1";
  updatedAt: string;
  entries: Record<string, BatchEntry>;
}
export interface BatchProgress {
  id: string;
  name: string;
  index: number;
  total: number;
  completed: number;
  stage: "patch" | "master" | "derive" | "complete" | "error" | "interrupted";
  fraction: number;
  overall: number;
  error?: string;
}
export interface BatchDependencies {
  loadManifest(): Promise<unknown>;
  saveManifest(manifest: BatchManifest): Promise<void>;
  savePatch(preset: BatchPreset, signal?: AbortSignal): Promise<ExportArtifact>;
  encodeMaster(preset: BatchPreset, options: ExportOptions): Promise<ExportArtifact>;
  derive(preset: BatchPreset, master: ExportArtifact, options: { posterTime: number; signal?: AbortSignal }): Promise<Required<Pick<BatchArtifacts, "mp4" | "webm" | "poster">>>;
  /** A filesystem sink can additionally recheck cached receipts before reuse. */
  artifactExists?(artifact: ExportArtifact): Promise<boolean>;
  now?(): Date;
}

const kinds: BatchAssetKind[] = ["patch", "master", "mp4", "webm", "poster"];
const safeId = /^[a-z0-9][a-z0-9-]{0,79}$/;
const profile = "divergent-release-v1" as const;
const aborted = () => new DOMException("Batch export cancelled.", "AbortError");
const checkAbort = (signal?: AbortSignal) => { if (signal?.aborted) throw aborted(); };
const isReceipt = (value: unknown): value is ExportArtifact => {
  if (!value || typeof value !== "object") return false;
  const receipt = value as ExportArtifact;
  return typeof receipt.path === "string" && /^(masters|public|posters|patches)\/[a-z0-9][a-z0-9-]*\.(mp4|webm|jpg|json)$/.test(receipt.path)
    && Number.isSafeInteger(receipt.bytes) && receipt.bytes > 0;
};
function checkedReceipt(value: ExportArtifact): ExportArtifact {
  if (!isReceipt(value)) throw new Error("Export sink returned an invalid artifact receipt.");
  return { path: value.path, bytes: value.bytes };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
async function fingerprint(preset: BatchPreset): Promise<string> {
  const bytes = new TextEncoder().encode(canonical({ profile, preset }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
function restore(value: unknown): BatchManifest {
  const empty: BatchManifest = { version: 1, profile, updatedAt: "", entries: {} };
  if (!value || typeof value !== "object") return empty;
  const saved = value as BatchManifest;
  if (saved.version !== 1 || saved.profile !== profile || !saved.entries || typeof saved.entries !== "object") return empty;
  for (const [id, entry] of Object.entries(saved.entries)) {
    if (!safeId.test(id) || !entry || typeof entry.fingerprint !== "string" || !entry.artifacts) continue;
    const artifacts = Object.fromEntries(kinds.filter(kind => isReceipt(entry.artifacts[kind])).map(kind => [kind, checkedReceipt(entry.artifacts[kind]!)]));
    empty.entries[id] = { fingerprint: entry.fingerprint, name: String(entry.name ?? id), status: "pending", artifacts };
  }
  return empty;
}

/** One GPU render per preset; each checkpoint follows a completed filesystem write. */
export async function runBatchExport(
  catalog: readonly BatchPreset[],
  dependencies: BatchDependencies,
  options: { signal?: AbortSignal; resume?: boolean; onProgress?: (progress: BatchProgress) => void } = {},
): Promise<BatchManifest> {
  checkAbort(options.signal);
  const presets = structuredClone(catalog);
  const ids = new Set<string>();
  for (const preset of presets) {
    if (!safeId.test(preset.id) || ids.has(preset.id)) throw new Error("Batch preset IDs must be unique safe filenames.");
    if (!Number.isFinite(preset.duration) || preset.duration < 1 || preset.duration > 60) throw new Error(`Invalid duration for ${preset.id}.`);
    const errors = validatePatch(preset.patch);
    if (errors.length) throw new Error(`${preset.id}: ${errors.join(" ")}`);
    ids.add(preset.id);
  }
  const manifest = restore(options.resume === false ? undefined : await dependencies.loadManifest());
  // Retire removed catalog entries; their existing disk files are not deleted.
  for (const id of Object.keys(manifest.entries)) if (!ids.has(id)) delete manifest.entries[id];
  const checkpoint = async () => {
    manifest.updatedAt = (dependencies.now?.() ?? new Date()).toISOString();
    await dependencies.saveManifest(structuredClone(manifest));
  };
  let completed = 0;
  for (const [index, preset] of presets.entries()) {
    checkAbort(options.signal);
    const hash = await fingerprint(preset);
    let entry = manifest.entries[preset.id];
    if (!entry || entry.fingerprint !== hash) {
      entry = { fingerprint: hash, name: preset.name, status: "pending", artifacts: {} };
      manifest.entries[preset.id] = entry;
    }
    const emit = (stage: BatchProgress["stage"], fraction: number, error?: string) => {
      const part = Math.max(0, Math.min(1, fraction));
      options.onProgress?.({ id: preset.id, name: preset.name, index, total: presets.length, completed, stage, fraction: part, overall: (completed + part) / Math.max(1, presets.length), ...(error ? { error } : {}) });
    };
    try {
      if (dependencies.artifactExists) {
        for (const kind of kinds) {
          const receipt = entry.artifacts[kind];
          if (receipt && !await dependencies.artifactExists(receipt)) delete entry.artifacts[kind];
        }
      }
      entry.status = "running";
      delete entry.error;
      await checkpoint();
      checkAbort(options.signal);
      if (!entry.artifacts.patch) {
        emit("patch", 0);
        entry.artifacts.patch = checkedReceipt(await dependencies.savePatch(preset, options.signal));
        await checkpoint();
      }
      checkAbort(options.signal);
      if (!entry.artifacts.master) {
        // A replaced or missing master also invalidates derived media.
        delete entry.artifacts.mp4; delete entry.artifacts.webm; delete entry.artifacts.poster;
        emit("master", 0.02);
        entry.artifacts.master = checkedReceipt(await dependencies.encodeMaster(preset, {
          width: 1920, height: 1080, fps: 30, duration: preset.duration, format: "mp4", signal: options.signal,
          onProgress: fraction => emit("master", 0.02 + 0.76 * fraction),
        }));
        await checkpoint();
      }
      checkAbort(options.signal);
      if (!entry.artifacts.mp4 || !entry.artifacts.webm || !entry.artifacts.poster) {
        emit("derive", 0.8);
        const derived = await dependencies.derive(preset, entry.artifacts.master, { posterTime: Math.min(3, preset.duration * 0.25), signal: options.signal });
        for (const kind of ["mp4", "webm", "poster"] as const) entry.artifacts[kind] = checkedReceipt(derived[kind]);
        await checkpoint();
      }
      checkAbort(options.signal);
      entry.status = "complete";
      await checkpoint();
      emit("complete", 1);
      completed++;
    } catch (error) {
      const cancelled = options.signal?.aborted || (error instanceof Error && error.name === "AbortError");
      entry.status = cancelled ? "interrupted" : "error";
      entry.error = error instanceof Error ? error.message : String(error);
      // Persist cancellation without its aborted signal so the next run can resume.
      await checkpoint().catch(() => {});
      emit(cancelled ? "interrupted" : "error", 0, entry.error);
      if (cancelled) throw aborted();
      throw error;
    }
  }
  if (presets.length === 0) await checkpoint();
  return structuredClone(manifest);
}

/** Same-origin local server sink; video remains in the server's artifact directory. */
export function localBatchDependencies(): BatchDependencies {
  const prefix = "/__visual-synth/batch";
  const json = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${prefix}${path}`, { ...init, headers: { "X-Visual-Synth": "export-v1", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
    if (response.status === 404 && path === "/manifest" && !init.method) return undefined;
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `Batch service returned HTTP ${response.status}.`);
    return body;
  };
  return {
    loadManifest: () => json("/manifest"),
    saveManifest: async manifest => { await json("/manifest", { method: "PUT", body: JSON.stringify(manifest) }); },
    savePatch: (preset, signal) => json(`/patches/${preset.id}`, { method: "PUT", body: JSON.stringify(preset.patch, null, 2), signal }),
    encodeMaster: (preset, options) => exportClipToArtifact(preset.patch, options, preset.id),
    derive: (preset, _master, options) => json(`/derive/${preset.id}`, { method: "POST", body: JSON.stringify({ posterTime: options.posterTime }), signal: options.signal }),
  };
}
