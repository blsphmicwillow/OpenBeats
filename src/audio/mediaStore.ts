/**
 * Binary media store for playlist audio clips.
 *
 * ENGINE: Web Audio path only. The bytes live in the WebView's IndexedDB in
 * both the browser demo and the desktop build.
 *
 * NATIVE LIMITATION (deliberate, documented in README and docs/AUDIO_CLIPS.md):
 * the Tauri app-data directory is not used yet. Streaming media through the
 * existing Rust filesystem commands would mean a new chunked read/write command
 * pair plus a migration; for 1.0.5 the media cache stays in the WebView.
 * "Media is cached in the WebView for 1.0.5; native app-data persistence is
 * planned for 1.1."
 *
 * Integrity: every stored file is hashed with SHA-256 (WebCrypto). The hash is
 * kept in the project (`MediaRef.hash`) and re-checked when a project reopens,
 * so a swapped or truncated cache is detected instead of silently played.
 */

import type { MediaRef } from '../model/audioClip';

const DB_NAME = 'openbeats-media';
const DB_VERSION = 1;
const STORE = 'samples';
const PATH_PREFIX = 'idb://openbeats-media/';

/** Fallback when IndexedDB is unavailable (private mode, some WebView builds). */
const memory = new Map<string, ArrayBuffer>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

/** SHA-256 of `data`, lowercase hex. Throws when WebCrypto is unavailable. */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('SHA-256 is unavailable in this WebView; media integrity cannot be verified');
  }
  const digest = await subtle.digest('SHA-256', data);
  const view = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < view.length; i += 1) out += view[i].toString(16).padStart(2, '0');
  return out;
}

export function mediaPath(hash: string): string {
  return `${PATH_PREFIX}${hash}`;
}

/** Extracts the content hash from a media locator. */
export function hashFromPath(path: string): string | null {
  if (!path.startsWith(PATH_PREFIX)) return null;
  const hash = path.slice(PATH_PREFIX.length);
  return /^[0-9a-f]{64}$/i.test(hash) ? hash.toLowerCase() : null;
}

export interface PutSampleInput {
  bytes: ArrayBuffer;
  name: string;
  mime: string;
}

/**
 * Stores the bytes under their SHA-256 and returns the reference a clip keeps.
 * Identical files collapse onto one entry, so two clips using the same sample
 * cost one copy.
 */
export async function putSample(input: PutSampleInput): Promise<MediaRef> {
  const hash = await sha256Hex(input.bytes);
  const db = await openDb();
  if (!db) {
    memory.set(hash, input.bytes.slice(0));
  } else {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(input.bytes.slice(0), hash);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not write media to IndexedDB'));
      tx.onabort = () => reject(tx.error ?? new Error('Media write was aborted'));
    });
  }
  return {
    path: mediaPath(hash),
    hash,
    mime: input.mime || 'application/octet-stream',
    bytes: input.bytes.byteLength,
    name: input.name,
  };
}

/** Reads stored bytes back, or null when the cache has no such hash. */
export async function getSample(ref: Pick<MediaRef, 'hash' | 'path'>): Promise<ArrayBuffer | null> {
  const hash = ref.hash || hashFromPath(ref.path) || '';
  if (!hash) return null;
  if (memory.has(hash)) return memory.get(hash)!.slice(0);
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(hash);
    request.onsuccess = () => {
      const value = request.result as ArrayBuffer | undefined;
      resolve(value ? value.slice(0) : null);
    };
    request.onerror = () => resolve(null);
  });
}

export async function deleteSample(hash: string): Promise<void> {
  memory.delete(hash);
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(hash);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

/** True when `bytes` still hash to the reference the project recorded. */
export async function verifySample(ref: MediaRef, bytes: ArrayBuffer): Promise<boolean> {
  try {
    return (await sha256Hex(bytes)) === ref.hash.toLowerCase();
  } catch {
    return false;
  }
}

export async function mediaStoreAvailable(): Promise<boolean> {
  return (await openDb()) !== null;
}
