// ============================================================================
// src/notes.js — Unified Notes & AI Tutoring Capture System
// ============================================================================

import { detectCourseFromContent } from './course-detector.js';

const NOTES_STORAGE_KEY = 'schoolcenter_unified_notes_v1';

class NotesManager {
  constructor() {
    this.notes = [];
    this.listeners = new Set();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(NOTES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.notes = Array.isArray(parsed) ? parsed : this.getDefaultNotes();
      } else {
        this.notes = this.getDefaultNotes();
        this.save();
      }
    } catch (e) {
      this.notes = this.getDefaultNotes();
    }
  }

  getDefaultNotes() {
    return [
      {
        id: 'note_1',
        title: 'Linear Algebra: Eigenvalues & Diagonalization Strategy',
        courseId: 'math15325d',
        content: 'Key steps for diagonalization: 1. Solve characteristic polynomial det(A - lambda*I) = 0 for eigenvalues. 2. For each eigenvalue, find basis of null space (A - lambda*I)x = 0 to get eigenvectors. 3. If n linearly independent eigenvectors exist, matrix P = [v1 ... vn] diagonalizes A such that P^-1 A P = D.',
        attachments: [],
        tags: ['exam-prep', 'matrix-theory'],
        aiGenerated: {
          summary: 'A 3-step procedural guide to finding eigenvalues, building the eigenvector matrix P, and verifying diagonalizability.',
          flashcards: [
            { front: 'What is the characteristic equation of matrix A?', back: 'det(A - λI) = 0' },
            { front: 'When is an n x n matrix diagonalizable?', back: 'When it has n linearly independent eigenvectors.' }
          ]
        },
        versionHistory: [
          { version: 1, timestamp: Date.now() - 172800000, changeSummary: 'Initial note taken during lecture' }
        ],
        createdAt: Date.now() - 172800000,
        updatedAt: Date.now() - 86400000
      },
      {
        id: 'note_2',
        title: 'Diesel Cycle Thermal Efficiency Review',
        courseId: 'engr36035d',
        content: 'In the ideal Diesel cycle, heat addition occurs at constant pressure, unlike the Otto cycle (constant volume). The cutoff ratio r_c = V3 / V2 represents the expansion during combustion. Efficiency decreases as cutoff ratio increases for a fixed compression ratio.',
        attachments: [],
        tags: ['thermo', 'diesel', 'efficiency'],
        aiGenerated: null,
        versionHistory: [
          { version: 1, timestamp: Date.now() - 86400000, changeSummary: 'Lab prep notes' }
        ],
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now() - 86400000
      }
    ];
  }

  save() {
    try {
      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(this.notes));
    } catch (e) {
      console.warn('Could not save notes:', e);
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event = {}) {
    this.save();
    this.listeners.forEach(fn => {
      try { fn(this.notes, event); } catch (e) {}
    });
  }

  getAll() {
    return this.notes;
  }

  getByCourse(courseId) {
    if (!courseId) return this.notes;
    const lower = courseId.toLowerCase();
    return this.notes.filter(n => n.courseId.toLowerCase() === lower);
  }

  getById(id) {
    return this.notes.find(n => n.id === id) || null;
  }

  createNote({ title, content, courseId = null, attachments = [], tags = [] }) {
    // Auto-detect course if not provided
    let targetCourseId = courseId;
    if (!targetCourseId) {
      const detection = detectCourseFromContent(title || '', content || '');
      targetCourseId = detection.courseId;
    }

    const newNote = {
      id: 'note_' + Date.now(),
      title: title || 'Quick Note',
      courseId: targetCourseId,
      content: content || '',
      attachments: attachments || [], // { id, type: 'image'|'audio'|'file', name, dataUrl, duration }
      tags: tags || [],
      aiGenerated: null,
      versionHistory: [
        { version: 1, timestamp: Date.now(), changeSummary: 'Created note' }
      ],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.notes.unshift(newNote);
    this.notify({ type: 'create', id: newNote.id, updatedAt: newNote.updatedAt });
    return newNote;
  }

  updateNote(id, updates) {
    const note = this.getById(id);
    if (!note) return null;

    const prevVersion = note.versionHistory.length ? note.versionHistory[note.versionHistory.length - 1].version : 1;
    note.versionHistory.push({
      version: prevVersion + 1,
      timestamp: Date.now(),
      changeSummary: updates._changeLog || 'Updated note content',
      snapshot: JSON.parse(JSON.stringify(note))
    });

    delete updates._changeLog;
    Object.assign(note, updates);
    note.updatedAt = Date.now();
    this.notify({ type: 'update', id: note.id, updatedAt: note.updatedAt });
    return note;
  }

  deleteNote(id, options = {}) {
    const idx = this.notes.findIndex(n => n.id === id);
    if (idx === -1) return false;
    const removed = this.notes.splice(idx, 1)[0];
    const updatedAt = Date.now();
    if (!options.silent) this.notify({ type: 'delete', id: removed.id, updatedAt });
    else this.save();
    return true;
  }

  /**
   * Merge notes pulled from the cloud into local state. Newest `updatedAt`
   * wins on a per-note basis; a note that only exists in the cloud is added.
   * records: [{ id, data, updatedAt }]
   */
  mergeCloudRecords(records = []) {
    let changed = false;
    records.forEach(({ id, data, updatedAt }) => {
      const existing = this.getById(id);
      if (!existing) {
        this.notes.unshift({ ...data, id, updatedAt });
        changed = true;
      } else if ((updatedAt || 0) > (existing.updatedAt || 0)) {
        Object.assign(existing, data, { id, updatedAt });
        changed = true;
      }
    });
    if (changed) this.notify({ type: 'merge-cloud' });
  }

  /**
   * AI study action dispatcher
   * Supports: 'summarize', 'cleanup', 'study_guide', 'flashcards', 'extract_tasks'
   */
  async runAIStudyAction(noteId, actionType) {
    const note = this.getById(noteId);
    if (!note) throw new Error('Note not found');

    const originalContent = note.content;
    let aiOutput = {};

    if (actionType === 'summarize') {
      const sentences = originalContent.split('.').filter(s => s.trim().length > 10);
      const summaryText = sentences.slice(0, 3).map(s => `• ${s.trim()}.`).join('\n') || `• ${originalContent.slice(0, 150)}...`;
      aiOutput.summary = summaryText;
      return this.updateNote(noteId, {
        aiGenerated: { ...(note.aiGenerated || {}), summary: summaryText },
        _changeLog: 'AI generated executive summary'
      });
    }

    if (actionType === 'cleanup') {
      const cleaned = `## ${note.title}\n\n### Key Principles\n${note.content.split('\n').map(l => l.trim() ? `- ${l.trim()}` : '').filter(Boolean).join('\n')}\n\n### Academic Takeaways\nReviewed and formatted for clarity and study consistency.`;
      return this.updateNote(noteId, {
        content: cleaned,
        _changeLog: 'AI formatted and structured content'
      });
    }

    if (actionType === 'study_guide') {
      const guide = `## 📖 Comprehensive Study Guide: ${note.title}\n\n### 1. Essential Formula / Concept Definition\n${note.content}\n\n### 2. High-Yield Exam Rules\n• Always verify dimensions and boundary conditions.\n• Review inverse calculations and edge-case exceptions.\n• Check units in numerical computations.\n\n### 3. Practice Checkpoint\nCan you explain this concept in your own words without looking at the notes?`;
      aiOutput.studyGuide = guide;
      return this.updateNote(noteId, {
        aiGenerated: { ...(note.aiGenerated || {}), studyGuide: guide },
        _changeLog: 'AI synthesized exam study guide'
      });
    }

    if (actionType === 'flashcards') {
      const cards = [
        { front: `Core principle of ${note.title}?`, back: note.content.slice(0, 120) + '...' },
        { front: `When does this theorem or rule apply?`, back: `Applies under the standard assumptions defined in ${note.courseId.toUpperCase()}.` }
      ];
      return this.updateNote(noteId, {
        aiGenerated: { ...(note.aiGenerated || {}), flashcards: cards },
        _changeLog: 'AI generated 2 interactive flashcards'
      });
    }

    if (actionType === 'extract_tasks') {
      const tasks = [
        { task: `Review practice problems for ${note.title}`, suggestedDue: new Date(Date.now() + 3*86400000).toLocaleDateString() },
        { task: `Verify formulas against textbook`, suggestedDue: new Date(Date.now() + 5*86400000).toLocaleDateString() }
      ];
      return this.updateNote(noteId, {
        aiGenerated: { ...(note.aiGenerated || {}), extractedTasks: tasks },
        _changeLog: 'AI extracted actionable review deadlines'
      });
    }

    return note;
  }

  restoreVersion(noteId, versionNumber) {
    const note = this.getById(noteId);
    if (!note) return false;

    const hist = note.versionHistory.find(v => v.version === versionNumber);
    if (!hist || !hist.snapshot) return false;

    const restored = JSON.parse(JSON.stringify(hist.snapshot));
    restored.versionHistory = note.versionHistory;
    restored.versionHistory.push({
      version: note.versionHistory.length + 1,
      timestamp: Date.now(),
      changeSummary: `Restored snapshot from Version ${versionNumber}`
    });
    restored.updatedAt = Date.now();

    const idx = this.notes.findIndex(n => n.id === noteId);
    if (idx !== -1) {
      this.notes[idx] = restored;
      this.notify();
      return true;
    }
    return false;
  }
}

export const notesManager = new NotesManager();
