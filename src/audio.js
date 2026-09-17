// ============================================================================
// src/audio.js — Voice Recorder Engine + Real-Time Canvas Visualizer
// Standalone recorder only; persistence belongs to voice-memos.js.
// ============================================================================

export class VoiceRecorder {
  constructor({ onStateChange, onTimeUpdate, onTranscriptUpdate } = {}) {
    this.onStateChange = onStateChange || (() => {});
    this.onTimeUpdate = onTimeUpdate || (() => {});
    this.onTranscriptUpdate = onTranscriptUpdate || (() => {});

    this.state = 'idle';
    this.mediaRecorder = null;
    this.audioStream = null;
    this.audioChunks = [];
    this.audioBlob = null;
    this.audioUrl = null;

    this.audioCtx = null;
    this.analyser = null;
    this.sourceNode = null;
    this.dataArray = null;
    this.animationFrameId = null;
    this.canvas = null;

    this.elapsedSeconds = 0;
    this.timerInterval = null;
    this.startedAt = 0;
    this.accumulatedMs = 0;
    this.pauseStartedAt = 0;

    this.recognition = null;
    this.transcript = [];
    this.initSpeechRecognition();
  }

  initSpeechRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return;
    try {
      this.recognition = new SpeechRec();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';

      this.recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcriptText = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) {
            this.transcript.push({ time: Math.floor(this.elapsedSeconds), text: transcriptText.trim() });
          } else {
            interim += transcriptText;
          }
        }
        this.onTranscriptUpdate({ finalChunks: this.transcript, interimText: interim });
      };
      this.recognition.onerror = (err) => console.warn('Speech recognition notice:', err.error);
    } catch (_) {
      this.recognition = null;
    }
  }

  async startRecording(canvasElement = null) {
    if (this.state === 'recording') return;

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      throw new Error('Audio recording is not supported by this browser.');
    }

    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (err) {
      throw new Error(err?.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow microphone access and try again.'
        : 'Microphone access could not be started on this device.');
    }

    this.audioChunks = [];
    this.audioBlob = null;
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = null;
    this.elapsedSeconds = 0;
    this.accumulatedMs = 0;
    this.pauseStartedAt = 0;
    this.transcript = [];
    this.canvas = canvasElement || null;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      try {
        this.audioCtx = new AudioContextClass();
        this.sourceNode = this.audioCtx.createMediaStreamSource(this.audioStream);
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 128;
        this.analyser.smoothingTimeConstant = 0.82;
        this.sourceNode.connect(this.analyser);
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        if (this.canvas) this.startCanvasVisualizer(this.canvas);
      } catch (e) {
        console.warn('Web Audio visualizer unavailable:', e);
      }
    }

    const mimeType = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4'
    ].find(type => MediaRecorder.isTypeSupported?.(type)) || '';

    this.mediaRecorder = mimeType ? new MediaRecorder(this.audioStream, { mimeType }) : new MediaRecorder(this.audioStream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data?.size) this.audioChunks.push(e.data);
    };
    this.mediaRecorder.start(250);

    if (this.recognition) {
      try { this.recognition.start(); } catch (_) {}
    }

    this.startedAt = performance.now();
    this.state = 'recording';
    this.onStateChange(this.state);
    this.startTimer();
  }

  startTimer() {
    clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (this.state !== 'recording') return;
      const liveMs = this.accumulatedMs + (performance.now() - this.startedAt);
      this.elapsedSeconds = Math.floor(liveMs / 1000);
      this.onTimeUpdate(this.elapsedSeconds);
    }, 200);
  }

  startCanvasVisualizer(canvas) {
    if (!canvas || !this.analyser) return;
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };
    resizeCanvas();

    const draw = () => {
      if (this.state !== 'recording' || !this.analyser) return;
      this.animationFrameId = requestAnimationFrame(draw);
      resizeCanvas();
      this.analyser.getByteFrequencyData(this.dataArray);

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, '#8B7CF6');
      gradient.addColorStop(0.55, '#34D1BF');
      gradient.addColorStop(1, '#F0608A');
      ctx.fillStyle = gradient;

      const barGap = Math.max(2, width / this.dataArray.length * 0.2);
      const barWidth = Math.max(2, width / this.dataArray.length - barGap);
      for (let i = 0; i < this.dataArray.length; i++) {
        const magnitude = this.dataArray[i] / 255;
        const barHeight = Math.max(4, magnitude * height * 0.86);
        const x = i * (barWidth + barGap);
        const y = (height - barHeight) / 2;
        const radius = Math.min(5, barWidth / 2);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, barWidth, barHeight, radius);
        else ctx.rect(x, y, barWidth, barHeight);
        ctx.fill();
      }
    };

    cancelAnimationFrame(this.animationFrameId);
    draw();
  }

  pauseRecording() {
    if (this.state !== 'recording' || !this.mediaRecorder) return;
    this.accumulatedMs += performance.now() - this.startedAt;
    this.elapsedSeconds = Math.floor(this.accumulatedMs / 1000);
    this.pauseStartedAt = performance.now();
    this.mediaRecorder.pause();
    try { this.recognition?.stop(); } catch (_) {}
    clearInterval(this.timerInterval);
    cancelAnimationFrame(this.animationFrameId);
    this.state = 'paused';
    this.onStateChange(this.state);
  }

  resumeRecording(canvasElement = this.canvas) {
    if (this.state !== 'paused' || !this.mediaRecorder) return;
    this.mediaRecorder.resume();
    try { this.recognition?.start(); } catch (_) {}
    this.startedAt = performance.now();
    this.canvas = canvasElement || this.canvas;
    if (this.audioCtx?.state === 'suspended') this.audioCtx.resume().catch(() => {});
    if (this.canvas) this.startCanvasVisualizer(this.canvas);
    this.state = 'recording';
    this.onStateChange(this.state);
    this.startTimer();
  }

  async stopRecording() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve(null);
        return;
      }

      if (this.state === 'recording') {
        this.accumulatedMs += performance.now() - this.startedAt;
        this.elapsedSeconds = Math.floor(this.accumulatedMs / 1000);
      }

      const finish = () => {
        const type = this.audioChunks[0]?.type || this.mediaRecorder?.mimeType || 'audio/webm';
        this.audioBlob = new Blob(this.audioChunks, { type });
        this.audioUrl = URL.createObjectURL(this.audioBlob);
        this.cleanupAudioStreams();
        clearInterval(this.timerInterval);
        cancelAnimationFrame(this.animationFrameId);
        this.state = 'stopped';
        this.onStateChange(this.state);
        resolve({ blob: this.audioBlob, url: this.audioUrl, duration: this.elapsedSeconds, transcript: this.transcript });
      };

      this.mediaRecorder.onstop = finish;
      clearInterval(this.timerInterval);
      cancelAnimationFrame(this.animationFrameId);
      try { this.recognition?.stop(); } catch (_) {}
      if (this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
    });
  }

  cancelRecording() {
    clearInterval(this.timerInterval);
    cancelAnimationFrame(this.animationFrameId);
    try { this.recognition?.stop(); } catch (_) {}
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
    } catch (_) {}
    this.cleanupAudioStreams();
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audioChunks = [];
    this.audioBlob = null;
    this.audioUrl = null;
    this.elapsedSeconds = 0;
    this.accumulatedMs = 0;
    this.transcript = [];
    this.state = 'idle';
    this.onStateChange(this.state);
  }

  cleanupAudioStreams() {
    this.audioStream?.getTracks().forEach(track => track.stop());
    this.audioStream = null;
    try { this.sourceNode?.disconnect(); } catch (_) {}
    this.sourceNode = null;
    try {
      if (this.audioCtx && this.audioCtx.state !== 'closed') this.audioCtx.close();
    } catch (_) {}
    this.audioCtx = null;
    this.analyser = null;
  }

  formatTime(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    const h = Math.floor(total / 3600);
    if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
}
