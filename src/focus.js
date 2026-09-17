// ============================================================================
// src/focus.js — Distraction-Free Academic Focus Mode
// ============================================================================

import { notesManager } from './notes.js';

export class FocusMode {
  constructor({ onExit, onNoteSaved }) {
    this.onExit = onExit || (() => {});
    this.onNoteSaved = onNoteSaved || (() => {});

    this.isActive = false;
    this.selectedCourseId = 'math15325d';
    this.timerSeconds = 25 * 60; // 25 min default Pomodoro
    this.initialSeconds = 25 * 60;
    this.timerRunning = false;
    this.timerInterval = null;
    this.scratchpadText = '';
  }

  start(courseId = 'math15325d', durationMinutes = 25) {
    this.isActive = true;
    this.selectedCourseId = courseId;
    this.timerSeconds = durationMinutes * 60;
    this.initialSeconds = durationMinutes * 60;
    this.timerRunning = false;
    this.scratchpadText = '';
  }

  toggleTimer(onTick) {
    if (this.timerRunning) {
      clearInterval(this.timerInterval);
      this.timerRunning = false;
    } else {
      this.timerRunning = true;
      this.timerInterval = setInterval(() => {
        if (this.timerSeconds > 0) {
          this.timerSeconds--;
          if (onTick) onTick(this.timerSeconds);
        } else {
          clearInterval(this.timerInterval);
          this.timerRunning = false;
          if (onTick) onTick(0);
        }
      }, 1000);
    }
    return this.timerRunning;
  }

  resetTimer() {
    clearInterval(this.timerInterval);
    this.timerRunning = false;
    this.timerSeconds = this.initialSeconds;
  }

  saveScratchpadToNotes() {
    const text = this.scratchpadText.trim();
    if (!text) return null;

    const note = notesManager.createNote({
      title: `Focus Session Notes (${new Date().toLocaleDateString()})`,
      content: text,
      courseId: this.selectedCourseId,
      tags: ['focus-session']
    });

    this.scratchpadText = '';
    this.onNoteSaved(note);
    return note;
  }

  exit() {
    clearInterval(this.timerInterval);
    this.timerRunning = false;
    this.saveScratchpadToNotes();
    this.isActive = false;
    this.onExit();
  }

  formatTime() {
    const m = Math.floor(this.timerSeconds / 60);
    const s = Math.floor(this.timerSeconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
}
