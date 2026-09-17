// ============================================================================
// src/voice-memos.js — Standalone Voice Memo Storage, Metadata & Playback Utils
// Uses IndexedDB for persistent audio Blobs so Voice Memos are independent of
// any course view or Linear Algebra Practice Studio state.
// ============================================================================

const DB_NAME = 'school-center-voice-memos';
const DB_VERSION = 1;
const STORE_NAME = 'memos';
const LEGACY_KEY = 'sc_voice_memos';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('savedAt', 'savedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open voice memo storage.'));
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

export async function buildWaveformPeaks(blob, sampleCount = 140) {
  if (!(blob instanceof Blob)) return [];
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return [];

  let ctx;
  try {
    ctx = new AudioContextClass();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const channel = audioBuffer.getChannelData(0);
    const blockSize = Math.max(1, Math.floor(channel.length / sampleCount));
    const peaks = [];

    for (let i = 0; i < sampleCount; i++) {
      const start = i * blockSize;
      const end = Math.min(channel.length, start + blockSize);
      if (start >= channel.length) {
        peaks.push(0.08);
        continue;
      }

      let peak = 0;
      for (let j = start; j < end; j++) {
        peak = Math.max(peak, Math.abs(channel[j]));
      }
      peaks.push(Math.max(0.08, Math.min(1, peak)));
    }
    return peaks;
  } catch (e) {
    console.warn('Waveform generation skipped:', e);
    return [];
  } finally {
    if (ctx && ctx.state !== 'closed') {
      try { await ctx.close(); } catch (_) {}
    }
  }
}

export class VoiceMemoStore {
  constructor() {
    this.dbPromise = null;
    this.initialized = false;
  }

  async db() {
    if (!this.dbPromise) this.dbPromise = openDb();
    return this.dbPromise;
  }

  async list() {
    const db = await this.db();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const rows = await idbRequest(store.getAll());
    return rows.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }

  async get(id) {
    const db = await this.db();
    const tx = db.transaction(STORE_NAME, 'readonly');
    return idbRequest(tx.objectStore(STORE_NAME).get(id));
  }

  async save(memo) {
    const db = await this.db();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await idbRequest(tx.objectStore(STORE_NAME).put(memo));
    return memo;
  }

  async update(id, patch) {
    const current = await this.get(id);
    if (!current) throw new Error('Voice memo not found.');
    const updated = { ...current, ...patch, updatedAt: Date.now() };
    return this.save(updated);
  }

  async remove(id) {
    const db = await this.db();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await idbRequest(tx.objectStore(STORE_NAME).delete(id));
  }

  async migrateLegacyLocalStorage() {
    let raw = null;
    try { raw = localStorage.getItem(LEGACY_KEY); } catch (_) {}
    if (!raw) return 0;

    let legacy = [];
    try { legacy = JSON.parse(raw); } catch (_) { legacy = []; }
    if (!Array.isArray(legacy) || !legacy.length) {
      try { localStorage.removeItem(LEGACY_KEY); } catch (_) {}
      return 0;
    }

    const existing = await this.list();
    const existingIds = new Set(existing.map(m => m.id));
    let migrated = 0;

    for (const old of legacy) {
      if (!old?.id || existingIds.has(old.id) || !old.dataUrl) continue;
      try {
        const blob = await dataUrlToBlob(old.dataUrl);
        const memo = {
          id: old.id,
          title: old.title || 'Voice Memo',
          createdAt: old.savedAt || Date.now(),
          savedAt: old.savedAt || Date.now(),
          duration: Number(old.durationSeconds || 0),
          courseId: old.courseId || null,
          mimeType: blob.type || 'audio/webm',
          blob,
          peaks: Array.isArray(old.peaks) ? old.peaks : []
        };
        await this.save(memo);
        migrated++;
      } catch (e) {
        console.warn('Legacy voice memo migration skipped:', old.id, e);
      }
    }

    try { localStorage.removeItem(LEGACY_KEY); } catch (_) {}
    return migrated;
  }

  async initialize() {
    if (this.initialized) return;
    await this.db();
    try { await this.migrateLegacyLocalStorage(); } catch (e) {
      console.warn('Voice memo migration unavailable:', e);
    }
    this.initialized = true;
  }
}

export function formatMemoTime(seconds = 0) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function revokeObjectUrl(url) {
  if (url) {
    try { URL.revokeObjectURL(url); } catch (_) {}
  }
}
