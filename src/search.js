// ============================================================================
// src/search.js — Universal Search Engine for Courses, Materials, Notes & Tasks
// ============================================================================

import { assignmentsManager } from './assignments.js';
import { notesManager } from './notes.js';

export function performUniversalSearch(query, courses = []) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];

  const results = [];

  // 1. Search Courses
  courses.forEach(c => {
    if ((c.name && c.name.toLowerCase().includes(q)) || (c.code && c.code.toLowerCase().includes(q)) || (c.instructor && c.instructor.toLowerCase().includes(q))) {
      results.push({
        type: 'course',
        badge: 'Course',
        title: `${c.code} — ${c.name}`,
        subtitle: c.instructor || 'Instructor',
        courseId: c.id,
        courseAccent: c.accent || '#8B7CF6',
        targetTab: 'overview'
      });
    }

    // Search Course Schedule
    (c.schedule || []).forEach(s => {
      const haystack = `${s.day || ''} ${s.start || ''} ${s.end || ''} ${s.type || ''} ${s.room || ''}`.toLowerCase();
      if (haystack.includes(q)) {
        results.push({
          type: 'schedule',
          badge: 'Schedule',
          title: `${s.day || 'Class'} · ${s.start || ''}–${s.end || ''}`,
          subtitle: `${c.code} · ${s.type || 'Class'}${s.room ? ` · Room ${s.room}` : ''}`,
          snippet: '',
          courseId: c.id,
          courseAccent: c.accent || '#8B7CF6',
          targetTab: 'overview'
        });
      }
    });

    // Search syllabus / course outline
    (c.syllabus || []).forEach(row => {
      const text = Array.isArray(row) ? row.filter(Boolean).join(' ') : String(row || '');
      if (text.toLowerCase().includes(q)) {
        results.push({
          type: 'syllabus',
          badge: 'Course Outline',
          title: Array.isArray(row) ? (row[2] || row[1] || text.slice(0, 90)) : text.slice(0, 90),
          subtitle: `${c.code} · Course Outline`,
          snippet: text.slice(0, 160),
          courseId: c.id,
          courseAccent: c.accent || '#8B7CF6',
          targetTab: 'overview'
        });
      }
    });

    // Search Course Lectures & Concepts
    (c.lectures || []).forEach(l => {
      let matchedConcept = false;
      (l.concepts || []).forEach(([term, def]) => {
        if (term.toLowerCase().includes(q) || def.toLowerCase().includes(q)) {
          matchedConcept = true;
          results.push({
            type: 'concept',
            badge: 'Lecture Concept',
            title: term,
            subtitle: `${c.code} · ${l.title}`,
            snippet: def,
            courseId: c.id,
            courseAccent: c.accent || '#8B7CF6',
            targetTab: 'lectures'
          });
        }
      });

      if (!matchedConcept && l.title.toLowerCase().includes(q)) {
        results.push({
          type: 'lecture',
          badge: 'Lecture',
          title: l.title,
          subtitle: `${c.code}`,
          courseId: c.id,
          courseAccent: c.accent || '#8B7CF6',
          targetTab: 'lectures'
        });
      }
    });

    // Search Cloud Materials & Extracted AI Summaries
    (c.cloudMaterials || []).forEach(m => {
      const json = m.content_json || {};
      const summary = json.summary || '';
      const inTitle = m.title && m.title.toLowerCase().includes(q);
      const inSummary = summary.toLowerCase().includes(q);

      if (inTitle || inSummary) {
        results.push({
          type: 'material',
          badge: 'Document',
          title: m.title,
          subtitle: `${c.code} · ${m.type}`,
          snippet: summary ? (summary.slice(0, 140) + '...') : '',
          courseId: c.id,
          courseAccent: c.accent || '#8B7CF6',
          targetTab: 'materials'
        });
      }
    });
  });

  // 2. Search Assignments
  const allAssignments = assignmentsManager.getAll();
  allAssignments.forEach(a => {
    if (a.title.toLowerCase().includes(q) || (a.description && a.description.toLowerCase().includes(q)) || (a.notes && a.notes.toLowerCase().includes(q))) {
      results.push({
        type: 'assignment',
        badge: 'Assignment',
        title: a.title,
        subtitle: `Due: ${new Date(a.dueDate).toLocaleDateString()} · Status: ${a.status.replace('_', ' ')}`,
        snippet: a.description ? (a.description.slice(0, 120) + '...') : '',
        courseId: a.courseId,
        assignmentId: a.id,
        targetTab: 'assignments'
      });
    }
  });

  // 3. Search Notes
  const allNotes = notesManager.getAll();
  allNotes.forEach(n => {
    if (n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)) {
      results.push({
        type: 'note',
        badge: 'Note',
        title: n.title,
        subtitle: `Updated: ${new Date(n.updatedAt).toLocaleDateString()}`,
        snippet: n.content.slice(0, 130) + '...',
        courseId: n.courseId,
        noteId: n.id,
        targetTab: 'notes'
      });
    }
  });

  return results.slice(0, 25);
}
