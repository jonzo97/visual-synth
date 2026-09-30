import { migratePatch, validatePatch, type Patch } from './core';

// Keep the original database and schema so existing patches remain readable.
const DB = 'tinkerbox-visual-synth';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('Patch storage is unavailable in this browser'));
      return;
    }
    let rejected = false;
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('patches')) db.createObjectStore('patches', { keyPath: 'name' });
      if (!db.objectStoreNames.contains('draft')) db.createObjectStore('draft');
    };
    request.onerror = () => {
      rejected = true;
      reject(request.error ?? new Error('Could not open patch storage'));
    };
    request.onblocked = () => {
      rejected = true;
      reject(new Error('Patch storage upgrade is blocked by another tab'));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (rejected) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

async function transaction<T>(
  store: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      let request: IDBRequest<T> | undefined;
      tx.oncomplete = () => resolve(request!.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? request?.error ?? new Error('Patch storage failed'));
      try {
        request = operation(tx.objectStore(store));
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  } finally {
    db.close();
  }
}

async function storeTransaction<T>(
  store: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      let result: T;
      let settled = false;
      tx.oncomplete = () => {
        settled = true;
        resolve(result);
      };
      tx.onerror = tx.onabort = () => {
        settled = true;
        reject(tx.error ?? new Error('Patch storage failed'));
      };
      try {
        Promise.resolve(operation(tx.objectStore(store), tx)).then(
          (value) => { result = value; },
          (error) => {
            if (!settled) {
              try { tx.abort(); } catch {}
            }
            reject(error);
          },
        );
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  } finally {
    db.close();
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Patch storage failed'));
  });
}

function checked(value: unknown): Patch {
  const errors = validatePatch(value);
  if (errors.length) throw new Error(errors.join('; '));
  return structuredClone(value as Patch);
}

export async function savePatch(patch: Patch): Promise<void> {
  // Validate and snapshot before opening the asynchronous transaction. A bad
  // patch cannot replace its earlier valid record, nor mutate while awaiting DB.
  const snapshot = checked(patch);
  await transaction('patches', 'readwrite', (store) => store.put(snapshot));
}

export async function deleteSaved(name: string): Promise<void> {
  await transaction('patches', 'readwrite', (store) => store.delete(name));
}

export async function renameSaved(from: string, to: string): Promise<void> {
  if (from === to) return;
  await storeTransaction('patches', 'readwrite', async (store) => {
    const record = await requestResult<unknown>(store.get(from));
    if (record === undefined) throw new Error(`Saved patch "${from}" was not found`);
    const renamed = checked({ ...(record as Patch), name: to });
    await requestResult(store.put(renamed));
    await requestResult(store.delete(from));
  });
}

export async function saveDraft(patch: Patch): Promise<void> {
  const snapshot = checked(patch);
  await transaction('draft', 'readwrite', (store) => store.put(snapshot, 'working'));
}

export async function loadSavedLibrary(): Promise<{ patches: Patch[]; warnings: string[] }> {
  const records = await transaction<unknown[]>('patches', 'readonly', (store) => store.getAll());
  const patches: Patch[] = [];
  const warnings: string[] = [];
  records.forEach((record, index) => {
    try {
      patches.push(migratePatch(record));
    } catch (error) {
      const name = record && typeof record === 'object' && 'name' in record && typeof record.name === 'string'
        ? `"${record.name.slice(0, 120)}"` : `record ${index + 1}`;
      warnings.push(`Saved patch ${name} could not be loaded; its stored data was preserved. ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return { patches: patches.sort((a, b) => a.name.localeCompare(b.name)), warnings };
}

/** Compatibility convenience; use loadSavedLibrary when displaying warnings. */
export async function listSavedPatches(): Promise<Patch[]> {
  return (await loadSavedLibrary()).patches;
}

export async function loadDraft(): Promise<Patch | null> {
  const value = await transaction<unknown>('draft', 'readonly', (store) => store.get('working'));
  if (value === undefined) return null;
  try {
    return migratePatch(value);
  } catch (error) {
    throw new Error(`The working draft could not be loaded; its stored data was preserved. ${error instanceof Error ? error.message : String(error)}`);
  }
}
