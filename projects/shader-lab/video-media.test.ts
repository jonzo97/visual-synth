import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createNode, validatePatch, migratePatch, type Patch } from './core';
import { textureSpecs, nodeTextureBytes } from './render-plan';
import { savePatch, listSavedPatches } from './persistence';

const mock = vi.hoisted(() => ({ supported: true, width: 320, end: 2, close: vi.fn(), dispose: vi.fn() }));
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [], BlobSource: class {},
  Input: class { dispose = mock.dispose; async getPrimaryVideoTrack() { return {
    canDecode: async () => mock.supported,
    getDisplayWidth: async () => mock.width, getDisplayHeight: async () => 180,
    getCodedWidth: async () => mock.width, getCodedHeight: async () => 180,
    getFirstTimestamp: async () => 0, computeDuration: async () => mock.end,
  }; } },
  VideoSampleSink: class { async getSample() { return { close: mock.close }; } },
}));
import { storeVideo, loadVideo, videoTime, MAX_VIDEO_BYTES } from './video-media';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('navigator', { storage: { estimate: async () => ({ quota: 1e9, usage: 0 }) } });
  mock.supported = true; mock.width = 320; mock.end = 2; vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());
const file = () => new File(['test bytes'], 'test.webm', { type: 'video/webm' });
function patch(): Patch {
  return { version: 2, name: 'Video test', nodes: [createNode('video', 'v'), createNode('output', 'o')],
    connections: [{ id: 'c', from: { node: 'v', port: 'frame' }, to: { node: 'o', port: 'in' } }],
    events: [], transport: { bpm: 120, loopSeconds: 12 } };
}
it('maps absolute forward/reverse/frozen time and negative preroll with ordinary repeat', () => {
  expect(videoTime(2, 1, 0, 2)).toBe(0);
  expect(videoTime(-0.5, 1, 0, 2)).toBe(1.5);
  expect(videoTime(0.5, -1, 0, 2)).toBe(1.5);
  expect(videoTime(50, 0, 0.25, 2)).toBe(0.25);
  expect(videoTime(0.25, 2, 0.5, 2)).toBe(1);
});
it('persists content IDs and media across named patch save/restore, deduplicating names', async () => {
  const media = await storeVideo(file());
  expect(media.id).toMatch(/^sha256-[a-f0-9]{64}$/);
  expect(await (await loadVideo(media.id)).text()).toBe('test bytes');
  expect((await storeVideo(new File(['test bytes'], 'renamed.mp4'))).id).toBe(media.id);
  const p = patch(); p.nodes[0]!.media = media;
  await savePatch(p);
  expect((await listSavedPatches())[0]).toEqual(migratePatch(p));
  expect(mock.close).toHaveBeenCalledTimes(2);
  expect(mock.dispose).toHaveBeenCalledTimes(2);
});
it('reports missing media and rejects a mismatched relink without changing the original', async () => {
  const original = await storeVideo(file());
  await expect(loadVideo('missing')).rejects.toThrow('relink');
  await expect(storeVideo(new File(['different'], 'test.webm'), original.id)).rejects.toThrow('different file');
  expect(await (await loadVideo(original.id)).text()).toBe('test bytes');
});
it('rejects unsupported codec, oversized dimensions and unbounded duration, disposing inputs', async () => {
  mock.supported = false; await expect(storeVideo(file())).rejects.toThrow('supported');
  mock.supported = true; mock.width = 4096; await expect(storeVideo(file())).rejects.toThrow('3840');
  mock.width = 320; mock.end = Infinity; await expect(storeVideo(file())).rejects.toThrow('finite');
  expect(mock.dispose).toHaveBeenCalledTimes(3);
});
it('rejects invalid size/type and insufficient browser quota before committing media', async () => {
  await expect(storeVideo(new File([], 'empty.mp4'))).rejects.toThrow('128 MiB');
  const oversized = file(); Object.defineProperty(oversized, 'size', { value: MAX_VIDEO_BYTES + 1 });
  await expect(storeVideo(oversized)).rejects.toThrow('128 MiB');
  await expect(storeVideo(new File(['x'], 'x.png'))).rejects.toThrow('MP4');
  vi.stubGlobal('navigator', { storage: { estimate: async () => ({ quota: 1, usage: 1 }) } });
  await expect(storeVideo(file())).rejects.toThrow('Not enough browser storage');
});
it('validates optional stable identity and bounds the source count', () => {
  const p = patch(); expect(validatePatch(p)).toEqual([]);
  p.nodes[0]!.media = { id: 'blob:expired', name: 'x' };
  expect(validatePatch(p).join()).toContain('invalid media');
  delete p.nodes[0]!.media;
  p.nodes.push(createNode('video', 'other'));
  expect(validatePatch(p).join()).toContain('one Video');
});
it('accounts for both the video upload texture and effect output target', () => {
  expect(textureSpecs(createNode('video'), 100, 50)).toHaveLength(2);
  expect(nodeTextureBytes(createNode('video'), 100, 50)).toBe(100 * 50 * 12);
});
