import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createDefaultPatch, migratePatch } from './core';
import { deleteSaved, listSavedPatches, loadDraft, loadSavedLibrary, renameSaved, saveDraft, savePatch } from './persistence';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());

async function rawRecord(store: string, value?: unknown): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('tinkerbox-visual-synth', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, value === undefined ? 'readonly' : 'readwrite');
      const objectStore = tx.objectStore(store);
      const request = value === undefined ? objectStore.getAll()
        : store === 'draft' ? objectStore.put(value, 'working') : objectStore.put(value);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

it('round-trips a valid draft and name-sorted saved patches using the original schema', async () => {
  const patch = createDefaultPatch();
  await saveDraft(patch);
  await savePatch({ ...patch, name: 'Zebra' });
  await savePatch({ ...patch, name: 'Atlas' });
  expect(await loadDraft()).toEqual(migratePatch(patch));
  expect(await rawRecord('draft')).toEqual([patch]);
  expect((await listSavedPatches()).map(p => p.name)).toEqual(['Atlas', 'Zebra']);
  expect((await loadSavedLibrary()).warnings).toEqual([]);
});

it('restores the valid draft and saved patches while individually reporting corrupt library entries', async () => {
  const patch = createDefaultPatch();
  await saveDraft(patch);
  await savePatch(patch);
  await rawRecord('patches', { name: 'Broken one', version: 99 });
  await rawRecord('patches', { name: 'Broken two', nodes: [] });
  const before = await rawRecord('patches');
  const library = await loadSavedLibrary();
  expect(library.patches).toEqual([migratePatch(patch)]);
  expect(library.warnings).toHaveLength(2);
  expect(library.warnings[0]).toContain('Broken one');
  expect(library.warnings[1]).toContain('Broken two');
  expect(await loadDraft()).toEqual(migratePatch(patch));
  expect(await rawRecord('patches')).toEqual(before);
});

it('throws on an invalid draft without deleting, repairing, or overwriting it', async () => {
  await loadDraft();
  const corrupt = { version: 99, name: 'Keep for recovery' };
  await rawRecord('draft', corrupt);
  await expect(loadDraft()).rejects.toThrow('stored data was preserved');
  expect(await rawRecord('draft')).toEqual([corrupt]);
});

it('rejects invalid saves before replacing previously valid records', async () => {
  const patch = createDefaultPatch();
  await saveDraft(patch);
  await savePatch(patch);
  const invalid = { ...patch, nodes: [] };
  await expect(saveDraft(invalid)).rejects.toThrow();
  await expect(savePatch(invalid)).rejects.toThrow();
  expect(await loadDraft()).toEqual(migratePatch(patch));
  expect(await listSavedPatches()).toEqual([migratePatch(patch)]);
});

it('snapshots the save before caller mutations during asynchronous storage', async () => {
  const patch = createDefaultPatch();
  const original = structuredClone(patch);
  const pending = saveDraft(patch);
  patch.name = 'Changed while opening the database';
  patch.nodes.length = 0;
  await pending;
  expect(await loadDraft()).toEqual(migratePatch(original));
});

it('returns null for a missing draft and reports unavailable storage', async () => {
  expect(await loadDraft()).toBeNull();
  vi.stubGlobal('indexedDB', undefined);
  await expect(loadSavedLibrary()).rejects.toThrow('unavailable');
});

it('returns upgraded library copies without rewriting valid legacy records', async () => {
  const patch = createDefaultPatch();
  await savePatch(patch);
  const before = await rawRecord('patches');
  const loaded = await listSavedPatches();
  expect(loaded[0]!.version).toBe(2);
  expect(loaded[0]!.simulation).toEqual({ tickHz: 60, warmupTicks: 0, events: [] });
  loaded[0]!.nodes[0]!.params.palette = 1;
  expect(await rawRecord('patches')).toEqual(before);
  expect((await listSavedPatches())[0]).toEqual(migratePatch(patch));
});

it('deletes a saved patch without touching the draft or other saved patches', async () => {
  const patch = createDefaultPatch();
  await saveDraft(patch);
  await savePatch({ ...patch, name: 'Keep' });
  await savePatch({ ...patch, name: 'Remove' });
  await deleteSaved('Remove');
  expect((await listSavedPatches()).map((p) => p.name)).toEqual(['Keep']);
  expect(await loadDraft()).toEqual(migratePatch(patch));
});

it('renames a saved patch in one readwrite transaction', async () => {
  const patch = createDefaultPatch();
  await savePatch({ ...patch, name: 'Old name' });
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('tinkerbox-visual-synth', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const proto = Object.getPrototypeOf(db) as IDBDatabase;
  db.close();
  const original = proto.transaction;
  const transactions: { stores: string | string[]; mode?: IDBTransactionMode }[] = [];
  proto.transaction = function patchedTransaction(
    this: IDBDatabase,
    storeNames: string | string[],
    mode?: IDBTransactionMode,
    options?: IDBTransactionOptions,
  ) {
    transactions.push({ stores: storeNames, mode });
    return original.call(this, storeNames, mode, options);
  };
  try {
    await renameSaved('Old name', 'New name');
  } finally {
    proto.transaction = original;
  }
  expect(transactions).toEqual([{ stores: 'patches', mode: 'readwrite' }]);
  expect((await listSavedPatches()).map((p) => p.name)).toEqual(['New name']);
  expect((await rawRecord('patches'))).toEqual([{ ...patch, name: 'New name' }]);
});

it('preserves corrupt v2 simulation records for recovery', async () => {
  await loadDraft();
  const corrupt = migratePatch(createDefaultPatch());
  corrupt.simulation!.warmupTicks = -1;
  await rawRecord('draft', corrupt);
  await rawRecord('patches', corrupt);
  await expect(loadDraft()).rejects.toThrow('stored data was preserved');
  const library = await loadSavedLibrary();
  expect(library.patches).toEqual([]);
  expect(library.warnings[0]).toContain('stored data was preserved');
  expect(await rawRecord('draft')).toEqual([corrupt]);
  expect(await rawRecord('patches')).toEqual([corrupt]);
});
