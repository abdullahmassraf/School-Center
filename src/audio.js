// ============================================================================
// src/audio.js — Voice Recording Engine, Web Audio Visualizer & Transcription
// ============================================================================

export class VoiceRecorder {
  constructor({ onStateChange, onTimeUpdate, onTranscriptUpdate }) {
    this.onStateChange = onStateChange || (() => {});
    this.onTimeUpdate = onTimeUpdate || (() => {});
    this.onTranscriptUpdate = onTranscriptUpdate || (() => {});

    this.state = 'idle'; // idle | recording | paused | stopped
    this.mediaRecorder = null;
    this.audioStream = null;
    this.audioChunks = [];
    this.audioBlob = null;
    this.audioUrl = null;

    // Web Audio API context & visualizer
    this.audioCtx = null;
    this.analyser = null;
    this.dataArray = null;
    this.animationFrameId = null;

    // Timer
    this.elapsedSeconds = 0;
    this.timerInterval = null;

    // Speech Recognition
    this.recognition = null;
    this.transcript = []; // array of { time: seconds, text: string }
    this.initSpeechRecognition();
  }

  initSpeechRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRec) {
      try {
        this.recognition = new SpeechRec();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event) => {
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcriptText = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              this.transcript.push({
                time: Math.floor(this.elapsedSeconds),
                text: transcriptText.trim()
              });
            } else {
              interim += transcriptText;
            }
          }
          this.onTranscriptUpdate({
            finalChunks: this.transcript,
            interimText: interim
          });
        };

        this.recognition.onerror = (err) => {
          console.warn('Speech recognition notice:', err.error);
        };
      } catch (e) {
        this.recognition = null;
      }
    }
  }

  async startRecording(canvasElement = null) {
    if (this.state === 'recording') return;

    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    } catch (err) {
      console.error('Microphone permission denied or unsupported:', err);
      throw new Error(err.name === 'NotAllowedError' 
        ? 'Microphone access was denied. Please allow microphone permissions in your browser.' 
        : 'Audio recording is not supported on this device.');
    }

    this.audioChunks = [];
    this.audioBlob = null;
    this.audioUrl = null;
    this.elapsedSeconds = 0;
    this.transcript = [];

    // Setup Web Audio Analyser
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      this.audioCtx = new AudioContextClass();
      const source = this.audioCtx.createMediaStreamSource(this.audioStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      source.connect(this.analyser);
      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);

      if (canvasElement) {
        this.startCanvasVisualizer(canvasElement);
      }
    }

    // Setup MediaRecorder
    this.mediaRecorder = new MediaRecorder(this.audioStream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.audioChunks.push(e.data);
      }
    };

    this.mediaRecorder.start(250); // Collect data every 250ms
    if (this.recognition) {
      try { this.recognition.start(); } catch (e) {}
    }

    this.state = 'recording';
    this.onStateChange(this.state);

    // Start timer
    this.timerInterval = setInterval(() => {
      this.elapsedSeconds++;
      this.onTimeUpdate(this.elapsedSeconds);
    }, 1000);
  }

  startCanvasVisualizer(canvas) {
    if (!canvas || !this.analyser) return;
    const ctx = canvas.getContext('2d');

    const draw = () => {
      if (this.state !== 'recording') return;
      this.animationFrameId = requestAnimationFrame(draw);

      this.analyser.getByteFrequencyData(this.dataArray);

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const barWidth = (width / this.dataArray.length) * 1.8;
      let x = 0;

      for (let i = 0; i < this.dataArray.length; i++) {
        const v = this.dataArray[i] / 255;
        const barHeight = Math.max(4, v * height * 0.9);

        // Purple-to-Cyan gradient
        const gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
        gradient.addColorStop(0, '#8B7CF6');
        gradient.addColorStop(1, '#34D1BF');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, height - barHeight, barWidth - 2, barHeight, 4);
        ctx.fill();

        x += barWidth;
      }
    };

    draw();
  }

  pauseRecording() {
    if (this.state !== 'recording' || !this.mediaRecorder) return;
    this.mediaRecorder.pause();
    if (this.recognition) {
      try { this.recognition.stop(); } catch (e) {}
    }
    clearInterval(this.timerInterval);
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);

    this.state = 'paused';
    this.onStateChange(this.state);
  }

  resumeRecording(canvasElement = null) {
    if (this.state !== 'paused' || !this.mediaRecorder) return;
    this.mediaRecorder.resume();
    if (this.recognition) {
      try { this.recognition.start(); } catch (e) {}
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    if (canvasElement) {
      this.startCanvasVisualizer(canvasElement);
    }

    this.state = 'recording';
    this.onStateChange(this.state);

    this.timerInterval = setInterval(() => {
      this.elapsedSeconds++;
      this.onTimeUpdate(this.elapsedSeconds);
    }, 1000);
  }

  stopRecording() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve(null);
        return;
      }

      this.mediaRecorder.onstop = () => {
        this.audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this.audioUrl = URL.createObjectURL(this.audioBlob);
        this.cleanupAudioStreams();

        this.state = 'stopped';
        this.onStateChange(this.state);

        resolve({
          blob: this.audioBlob,
          url: this.audioUrl,
          duration: this.elapsedSeconds,
          transcript: this.transcript
        });
      };

      clearInterval(this.timerInterval);
      if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
      if (this.recognition) {
        try { this.recognition.stop(); } catch (e) {}
      }

      if (this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
    });
  }

  cancelRecording() {
    clearInterval(this.timerInterval);
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    if (this.recognition) {
      try { this.recognition.stop(); } catch (e) {}
    }
    this.cleanupAudioStreams();
    this.audioChunks = [];
    this.audioBlob = null;
    this.audioUrl = null;
    this.elapsedSeconds = 0;
    this.transcript = [];
    this.state = 'idle';
    this.onStateChange(this.state);
  }

  cleanupAudioStreams() {
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }

  formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
}
