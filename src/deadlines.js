// Local deadline state used by the dashboard and the bidirectional sync engine.
const STORAGE_KEY = 'schoolcenter_deadlines_v1';
const OUTLINE_DEADLINE_PREFIX = 'outline_deadline_';

const MONTHS = new Map([
  ['jan', 0], ['january', 0], ['feb', 1], ['february', 1], ['mar', 2], ['march', 2],
  ['apr', 3], ['april', 3], ['may', 4], ['jun', 5], ['june', 5], ['jul', 6],
  ['july', 6], ['aug', 7], ['august', 7], ['sep', 8], ['sept', 8], ['september', 8],
  ['oct', 9], ['october', 9], ['nov', 10], ['november', 10], ['dec', 11], ['december', 11]
]);

// ONLY these assessment kinds become deadlines. The outline is the single
// source of truth: a row without an explicit date is skipped entirely, so the
// app can never invent ("hallucinate") a due date the syllabus does not state.
const ASSESSMENT_PATTERN = /(assignment|homework|quiz|midterm|final\s*exam|exam)/i;
const NON_ASSESSMENT_PATTERN = /(discussion|review session|reading week|diagnostic|homework\s*\d+\s*$)/i;

function cleanKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function parseOutlineDate(value) {
  const match = String(value || '').trim().match(/^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (!match) return null;
  const month = MONTHS.get(match[1].toLowerCase());
  if (month == null) return null;
  const year = Number(match[3] || new Date().getFullYear());
  const date = new Date(year, month, Number(match[2]), 23, 59, 0, 0);
  return date.getMonth() === month ? date.toISOString() : null;
}

function assessmentType(title) {
  const value = String(title || '').toLowerCase();
  if (value.includes('final') || value.includes('midterm') || value.includes('exam')) return 'exam';
  if (value.includes('quiz')) return 'quiz';
  return 'assignment';
}

function extractWeight(title) {
  const match = String(title || '').match(/\((\d+(?:\.\d+)?)\s*%\)/);
  return match ? Number(match[1]) : null;
}

/** Convert dated syllabus/classwork rows into stable, syncable deadlines. */
export function extractCourseOutlineDeadlines(courses = []) {
  const result = [];
  courses.forEach(course => {
    (course?.syllabus || []).forEach(row => {
      const [week, dateLabel, topics, classwork] = Array.isArray(row) ? row : [];
      const dueAt = parseOutlineDate(dateLabel);
      if (!dueAt || !classwork) return;
      String(classwork).split(/\s*[·|]\s*/).forEach(rawTitle => {
        const title = String(rawTitle || '').trim();
        if (!title || !ASSESSMENT_PATTERN.test(title) || NON_ASSESSMENT_PATTERN.test(title)) return;
        const id = `${OUTLINE_DEADLINE_PREFIX}${cleanKey(course.code || course.id)}_${cleanKey(week || dateLabel)}_${cleanKey(title)}`;
        result.push({
          id,
          title,
          courseId: course.id,
          courseDbId: course.dbId || null,
          courseCode: course.code || course.id,
          type: assessmentType(title),
          dueAt,
          weight: extractWeight(title),
          source: 'course-outline',
          generated: true
        });
      });
    });
  });
  return result;
}

class DeadlinesManager {
  constructor() {
    this.deadlines = [];
    this.listeners = new Set();
    this.load();
    this.pruneExpiredDeadlines();
    // Assessments keep their syllabus dates; anything past due disappears
    // permanently instead of piling up. Re-checked every 10 minutes.
    setInterval(() => this.pruneExpiredDeadlines(), 600000);
  }

  load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      this.deadlines = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      this.deadlines = [];
    }
  }

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.deadlines)); } catch (_) {}
  }

  notify(event = {}) {
    this.save();
    for (const listener of this.listeners) {
      try { listener(this.deadlines, event); } catch (_) {}
    }
  }

  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  getAll() { return this.deadlines; }
  getById(id) { return this.deadlines.find(item => item.id === id) || null; }
  getByCourse(courseId) { return this.deadlines.filter(item => item.courseId === courseId); }

  /** Permanently remove every deadline whose due date/time has passed. */
  pruneExpiredDeadlines() {
    const now = Date.now();
    const expired = this.deadlines.filter(item => {
      const due = new Date(item.dueAt).getTime();
      return Number.isFinite(due) && due < now;
    });
    if (!expired.length) return [];
    const expiredIds = new Set(expired.map(item => item.id));
    this.deadlines = this.deadlines.filter(item => !expiredIds.has(item.id));
    this.notify({ type: 'prune-expired', ids: [...expiredIds], updatedAt: now });
    return expired.map(item => item.id);
  }

  /** Seed/update outline-derived rows without creating duplicates or undoing user actions.
   * Past-due outline rows are never seeded: once a deadline passes, the
   * pruner removes it permanently and it must not reappear on reload. */
  syncCourseOutlineDeadlines(courses = []) {
    const now = Date.now();
    const generated = extractCourseOutlineDeadlines(courses)
      .filter(candidate => new Date(candidate.dueAt).getTime() >= now);
    let changed = false;
    generated.forEach(candidate => {
      const existing = this.getById(candidate.id);
      if (!existing) {
        this.deadlines.unshift({
          ...candidate,
          status: 'upcoming',
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
        changed = true;
        return;
      }
      if (!existing.userEdited) {
        const next = { ...existing, ...candidate, status: existing.status || 'upcoming' };
        if (JSON.stringify(next) !== JSON.stringify(existing)) {
          Object.assign(existing, next, { updatedAt: existing.updatedAt || Date.now() });
          changed = true;
        }
      }
    });
    if (changed) this.notify({ type: 'seed-outline' });
    return generated;
  }

  createDeadline(data = {}) {
    const now = Date.now();
    const deadline = {
      id: data.id || `deadline_${now}_${Math.random().toString(36).slice(2, 7)}`,
      title: String(data.title || 'Untitled deadline'),
      courseId: String(data.courseId || 'math15325d'),
      type: ['exam', 'quiz', 'lab', 'assignment', 'other'].includes(data.type) ? data.type : 'other',
      dueAt: data.dueAt || new Date(now + 7 * 86400000).toISOString(),
      weight: data.weight == null || data.weight === '' ? null : Number(data.weight),
      status: ['upcoming', 'done', 'missed'].includes(data.status) ? data.status : 'upcoming',
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now,
      source: data.source || 'user',
      generated: Boolean(data.generated)
    };
    this.deadlines = [deadline, ...this.deadlines.filter(item => item.id !== deadline.id)];
    this.notify({ type: 'create', id: deadline.id, updatedAt: deadline.updatedAt });
    return deadline;
  }

  updateDeadline(id, updates = {}) {
    const deadline = this.getById(id);
    if (!deadline) return null;
    Object.assign(deadline, updates, { updatedAt: Date.now(), userEdited: true });
    this.notify({ type: 'update', id, updatedAt: deadline.updatedAt });
    return deadline;
  }

  deleteDeadline(id, options = {}) {
    const index = this.deadlines.findIndex(item => item.id === id);
    if (index < 0) return false;
    const [removed] = this.deadlines.splice(index, 1);
    if (!options.silent) this.notify({ type: 'delete', id: removed.id, updatedAt: Date.now() });
    else this.save();
    return true;
  }

  mergeCloudRecords(records = []) {
    let changed = false;
    for (const record of records) {
      // Never resurrect a deadline the local pruner already expired.
      const due = new Date(record.data?.dueAt || 0).getTime();
      if (Number.isFinite(due) && due < Date.now()) continue;
      const existing = this.getById(record.id);
      if (!existing) {
        this.deadlines.unshift({ ...record.data, id: record.id, updatedAt: record.updatedAt });
        changed = true;
      } else if ((record.updatedAt || 0) > (existing.updatedAt || 0)) {
        const data = { ...record.data };
        // The cloud schema stores course_id as a UUID, while the UI uses the
        // stable local course key. Keep the local key for filtering/rendering
        // and retain the UUID separately for the next cloud write.
        if (existing.generated || String(existing.id).startsWith(OUTLINE_DEADLINE_PREFIX)) {
          data.courseDbId = data.courseId || existing.courseDbId || null;
          data.courseId = existing.courseId;
          data.courseCode = existing.courseCode || data.courseCode;
        }
        Object.assign(existing, data, { id: record.id, updatedAt: record.updatedAt });
        changed = true;
      }
    }
    if (changed) this.notify({ type: 'merge-cloud' });
  }
}

export const deadlinesManager = new DeadlinesManager();
