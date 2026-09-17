// ============================================================================
// src/ai-workspace.js — Integrated Gemini workspace helpers
// - Broad file picker support for Gemini multimodal inputs
// - Gemini Files API for larger media
// - Gemini Live API transcription using gemini-3.5-transcribe-live
// ============================================================================

export const GEMINI_FILE_ACCEPT = [
  '*/*',
  'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/avif',
  'application/pdf', 'application/json', 'text/plain', 'text/html', 'text/css', 'text/javascript', 'text/csv', 'text/markdown', 'text/xml', 'text/rtf',
  'audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/webm', 'audio/aiff', 'audio/m4a', 'audio/opus', 'audio/l16',
  'video/mp4', 'video/mpeg', 'video/quicktime', 'video/avi', 'video/x-flv', 'video/mpg', 'video/webm', 'video/wmv', 'video/3gpp',
  '.png','.jpg','.jpeg','.webp','.heic','.heif','.gif','.avif','.pdf','.txt','.html','.htm','.css','.js','.ts','.json','.csv','.md','.markdown','.rtf',
  '.mp4','.mpeg','.mpg','.mov','.avi','.flv','.webm','.wmv','.3gp','.3gpp','.mp3','.wav','.m4a','.aac','.ogg','.oga','.flac','.aiff','.opus'
].join(',');

const INLINE_LIMIT = 18 * 1024 * 1024;
const FILES_API_START = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

function inferMimeType(file) {
  if (file.type) return file.type;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const map = {
    heic:'image/heic', heif:'image/heif', pdf:'application/pdf', txt:'text/plain', md:'text/markdown', markdown:'text/markdown',
    json:'application/json', csv:'text/csv', html:'text/html', htm:'text/html', css:'text/css', js:'text/javascript', ts:'text/plain', rtf:'text/rtf',
    mp4:'video/mp4', mpeg:'video/mpeg', mpg:'video/mpg', mov:'video/quicktime', avi:'video/avi', flv:'video/x-flv', webm:'video/webm', wmv:'video/wmv',
    '3gp':'video/3gpp', '3gpp':'video/3gpp', mp3:'audio/mp3', wav:'audio/wav', m4a:'audio/m4a', aac:'audio/aac', ogg:'audio/ogg', oga:'audio/ogg', flac:'audio/flac', aiff:'audio/aiff', opus:'audio/opus'
  };
  return map[ext] || 'application/octet-stream';
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function uploadViaGeminiFilesApi(file, apiKey) {
  const mimeType = inferMimeType(file);
  const startResponse = await fetch(`${FILES_API_START}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(file.size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: file.name } })
  });

  if (!startResponse.ok) {
    const text = await startResponse.text();
    throw new Error(`Gemini file upload setup failed (${startResponse.status}): ${text.slice(0, 300)}`);
  }

  const uploadUrl = startResponse.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini did not return an upload URL for this file.');

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Length': String(file.size),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: file
  });

  const data = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || !data.file?.uri) {
    throw new Error(`Gemini file upload failed (${uploadResponse.status}).`);
  }

  return {
    file_data: {
      mime_type: data.file.mimeType || mimeType,
      file_uri: data.file.uri
    }
  };
}

async function fileToPart(file, apiKey) {
  const mimeType = inferMimeType(file);
  // Plain text/code is cheaper and cleaner when sent as text instead of binary bytes.
  if (mimeType.startsWith('text/')) {
    const text = await file.text();
    return { text: `\n[Attached file: ${file.name}]\n${text}\n[End attached file]\n` };
  }

  if (file.size <= INLINE_LIMIT) {
    return {
      inline_data: {
        mime_type: mimeType,
        data: bytesToBase64(await file.arrayBuffer())
      }
    };
  }

  return uploadViaGeminiFilesApi(file, apiKey);
}

export async function prepareGeminiFileParts(files, apiKey) {
  const parts = [];
  for (const file of files || []) {
    parts.push(await fileToPart(file, apiKey));
  }
  return parts;
}

function downsampleBuffer(input, inputRate, outputRate) {
  if (outputRate >= inputRate) return input;
  const ratio = inputRate / outputRate;
  const newLength = Math.round(input.length / ratio);
  const output = new Float32Array(newLength);
  let offset = 0;
  let inputOffset = 0;
  while (offset < output.length) {
    const nextInputOffset = Math.round((offset + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = inputOffset; i < nextInputOffset && i < input.length; i++) {
      accum += input[i];
      count++;
    }
    output[offset] = count ? accum / count : 0;
    offset++;
    inputOffset = nextInputOffset;
  }
  return output;
}

function float32ToPcm16Base64(buffer) {
  const view = new DataView(new ArrayBuffer(buffer.length * 2));
  for (let i = 0; i < buffer.length; i++) {
    const sample = Math.max(-1, Math.min(1, buffer[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytesToBase64(view.buffer);
}

export class GeminiLiveTranscriber {
  constructor({ apiKey, fetchEphemeralToken, customVocabulary = [], onStatus, onInterim, onFinal, onError } = {}) {
    this.apiKey = apiKey;
    this.fetchEphemeralToken = fetchEphemeralToken || null;
    this.customVocabulary = customVocabulary;
    this.onStatus = onStatus || (() => {});
    this.onInterim = onInterim || (() => {});
    this.onFinal = onFinal || (() => {});
    this.onError = onError || (() => {});
    this.ws = null;
    this.stream = null;
    this.audioContext = null;
    this.source = null;
    this.processor = null;
    this.sink = null;
    this.active = false;
    this.connected = false;
  }

  async resolveCredential() {
    if (this.fetchEphemeralToken) {
      try {
        const token = await this.fetchEphemeralToken();
        if (token) return { type: 'token', value: token };
      } catch (error) {
        console.warn('Ephemeral Live token unavailable; trying direct API key fallback:', error);
      }
    }
    if (this.apiKey) return { type: 'apiKey', value: this.apiKey };
    throw new Error('Connect Gemini and sign in to cloud sync in Settings before using the microphone.');
  }

  async start() {
    if (this.active) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is not supported in this browser.');
    if (!('WebSocket' in window)) throw new Error('WebSocket is not available in this browser.');

    const credential = await this.resolveCredential();
    this.onStatus('connecting');
    const MODEL = 'gemini-3.5-transcribe-live';
    const wsUrl = credential.type === 'token'
      ? `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(credential.value)}`
      : `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(credential.value)}`;

    this.ws = new WebSocket(wsUrl);

    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Timed out connecting to live transcription.'));
        }
      }, 12000);
      this.ws.onopen = () => {
        const setup = {
          setup: {
            model: `models/${MODEL}`,
            generationConfig: { responseModalities: ['TEXT'] },
            inputAudioTranscription: {
              languageCodes: [],
              mode: 'SMART',
              ...(this.customVocabulary.length ? { customVocabulary: this.customVocabulary.slice(0, 100) } : {})
            }
          }
        };
        this.ws.send(JSON.stringify(setup));
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      };
      this.ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('Could not connect to Gemini live transcription. Check the Gemini API key and Supabase Live Token function.'));
        }
      };
    });

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.error) {
          this.onError(message.error.message || 'Gemini live transcription error.');
          return;
        }
        const content = message.serverContent;
        if (content?.interimInputTranscription?.text) this.onInterim(content.interimInputTranscription.text);
        if (content?.inputTranscription?.text) this.onFinal(content.inputTranscription.text);
      } catch (e) {
        console.warn('Live transcription message parse skipped:', e);
      }
    };

    this.ws.onclose = (event) => {
      this.connected = false;
      if (this.active) {
        this.active = false;
        this.onError(event?.reason || 'Gemini live transcription connection closed.');
        this.onStatus('closed');
      }
    };
    this.ws.onerror = () => this.onError('Gemini live transcription connection error.');

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      await this.audioContext.resume();
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.processor = this.audioContext.createScriptProcessor(2048, 1, 1);
      this.sink = this.audioContext.createGain();
      this.sink.gain.value = 0;

      this.processor.onaudioprocess = (event) => {
        if (!this.active || this.ws?.readyState !== WebSocket.OPEN) return;
        const input = event.inputBuffer.getChannelData(0);
        const downsampled = downsampleBuffer(input, this.audioContext.sampleRate, 16000);
        if (!downsampled.length) return;
        const data = float32ToPcm16Base64(downsampled);
        try {
          this.ws.send(JSON.stringify({ realtimeInput: { audio: { data, mimeType: 'audio/pcm;rate=16000' } } }));
        } catch (_) {}
      };

      this.source.connect(this.processor);
      this.processor.connect(this.sink);
      this.sink.connect(this.audioContext.destination);
      this.active = true;
      this.connected = true;
      this.onStatus('listening');
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop() {
    const wasActive = this.active;
    this.active = false;
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      }
    } catch (_) {}
    try { this.processor?.disconnect(); } catch (_) {}
    try { this.sink?.disconnect(); } catch (_) {}
    try { this.source?.disconnect(); } catch (_) {}
    try { this.stream?.getTracks().forEach(t => t.stop()); } catch (_) {}
    try { if (this.audioContext && this.audioContext.state !== 'closed') await this.audioContext.close(); } catch (_) {}
    this.processor = null;
    this.sink = null;
    this.source = null;
    this.stream = null;
    try { this.ws?.close(); } catch (_) {}
    this.ws = null;
    this.connected = false;
    if (wasActive) this.onStatus('stopped');
  }
}
