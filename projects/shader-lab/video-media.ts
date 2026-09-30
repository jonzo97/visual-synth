import { Input, BlobSource, ALL_FORMATS, VideoSampleSink } from 'mediabunny';

export const MAX_VIDEO_BYTES = 128 * 1024 * 1024;
const MAX_LIBRARY_BYTES = 512 * 1024 * 1024;
export interface VideoReference { id: string; name: string }
interface MediaRecord extends VideoReference { blob: Blob }
export class VideoMediaError extends Error { override name = 'VideoMediaError'; }

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new VideoMediaError('Video storage is unavailable in this browser.')); return; }
    let rejected = false;
    const request = indexedDB.open('tinkerbox-visual-synth-media', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('videos', { keyPath: 'id' });
    request.onerror = () => { rejected = true; reject(new VideoMediaError('Could not open local Video storage.')); };
    request.onblocked = () => { rejected = true; reject(new VideoMediaError('Media storage is blocked by another tab.')); };
    request.onsuccess = () => {
      if (rejected) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close(); resolve(request.result);
    };
  });
}

export async function loadVideo(id: string): Promise<Blob> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('videos').objectStore('videos').get(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => request.result?.blob instanceof Blob ? resolve(request.result.blob) :
        reject(new VideoMediaError('Video file is missing on this browser. Select the Video device and relink the original MP4/WebM.'));
    });
  } finally { db.close(); }
}

/** One decoder per renderer/source; no shared playback clock or DOM media element. */
export async function openVideo(blob: Blob) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !await track.canDecode()) throw new Error('This file has no supported video track. Try H.264 MP4 or VP9 WebM.');
    const sizes = await Promise.all([track.getDisplayWidth(), track.getDisplayHeight(), track.getCodedWidth(), track.getCodedHeight()]);
    if (sizes.some(n => !Number.isFinite(n) || n < 1) || sizes[0]! > 3840 || sizes[1]! > 2160 || sizes[2]! > 3840 || sizes[3]! > 2160)
      throw new Error('Video exceeds the 3840 × 2160 source limit.');
    const first = Math.max(0, await track.getFirstTimestamp());
    const duration = await track.computeDuration() - first;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 600) throw new Error('Video must have a finite duration of at most 10 minutes.');
    const sink = new VideoSampleSink(track);
    return { input, sink, first, duration };
  } catch (e) { input.dispose(); throw new VideoMediaError(e instanceof Error ? e.message : String(e)); }
}

export async function storeVideo(file: File, expectedId?: string): Promise<VideoReference> {
  if (!/\.(mp4|webm)$/i.test(file.name)) throw new Error('Choose a local MP4 or WebM file.');
  if (!file.size || file.size > MAX_VIDEO_BYTES) throw new Error('Video must be between 1 byte and 128 MiB.');
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const id = `sha256-${Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('')}`;
  if (expectedId && expectedId !== id) throw new Error('That is a different file. Relink requires the original file; use Replace video to change material.');
  const decoder = await openVideo(file);
  try { const sample = await decoder.sink.getSample(decoder.first); if (!sample) throw new Error('The first video frame could not be decoded.'); sample.close(); }
  finally { decoder.input.dispose(); }
  const estimate = await navigator.storage?.estimate?.();
  if (estimate?.quota && estimate.quota - (estimate.usage ?? 0) < file.size * 1.1)
    throw new Error('Not enough browser storage for this video. Free space before retrying.');
  const db = await database();
  const reference = { id, name: file.name.slice(0, 255) };
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('videos', 'readwrite'), store = tx.objectStore('videos');
      tx.oncomplete = () => resolve();
      let failure = 'Video storage failed or quota was exceeded. The patch was not changed.';
      tx.onerror = tx.onabort = () => reject(new Error(failure));
      const all = store.getAll();
      all.onsuccess = () => {
        const bytes = (all.result as MediaRecord[]).reduce((sum, item) => sum + (item.id === id ? 0 : item.blob.size), 0);
        if (bytes + file.size > MAX_LIBRARY_BYTES) { failure = 'This browser’s Video library has reached its 512 MiB limit. Use a smaller file or another browser profile. The patch was not changed.'; tx.abort(); return; }
        store.put({ ...reference, blob: file });
      };
    });
  } finally { db.close(); }
  return reference;
}

/** Absolute-time mapping; speed changes are phase changes, not integrated velocity. */
export function videoTime(time: number, speed: number, start: number, duration: number): number {
  const value = time * speed + start;
  return ((value % duration) + duration) % duration;
}

export class VideoFrames {
  private decoders = new Map<string, Awaited<ReturnType<typeof openVideo>>>();
  private canvas?: OffscreenCanvas;
  private disposed = false;
  async draw(id: string, time: number, speed: number, start: number, width: number, height: number, check: () => void) {
    let decoder = this.decoders.get(id);
    if (!decoder) {
      decoder = await openVideo(await loadVideo(id));
      if (this.disposed) { decoder.input.dispose(); throw new Error('Video renderer disposed'); }
      this.decoders.set(id, decoder);
    }
    check();
    const sample = await decoder.sink.getSample(decoder.first + videoTime(time, speed, start, decoder.duration)).catch(e => {
      throw new VideoMediaError(`Video decoding failed: ${e instanceof Error ? e.message : String(e)}`);
    });
    if (!sample) throw new VideoMediaError('Video frame could not be decoded at the requested time.');
    try {
      check();
      const canvas = this.canvas ??= new OffscreenCanvas(width, height);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const context = canvas.getContext('2d')!;
      context.fillStyle = 'black'; context.fillRect(0, 0, width, height);
      const scale = Math.min(width / sample.displayWidth, height / sample.displayHeight);
      const w = sample.displayWidth * scale, h = sample.displayHeight * scale;
      sample.draw(context, (width - w) / 2, (height - h) / 2, w, h);
      return canvas;
    } finally { sample.close(); }
  }
  retain(ids: Set<string>) { for (const [id, decoder] of this.decoders) if (!ids.has(id)) { decoder.input.dispose(); this.decoders.delete(id); } }
  dispose() { this.disposed = true; this.retain(new Set()); this.canvas = undefined; }
}
