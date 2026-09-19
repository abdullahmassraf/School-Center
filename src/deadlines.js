// Local deadline state used by the dashboard and the bidirectional sync engine.
const STORAGE_KEY = 'schoolcenter_deadlines_v1';

class DeadlinesManager {
  constructor() {
    this.deadlines = [];
    this.listeners = new Set();
    this.load();
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
      updatedAt: data.updatedAt || now
    };
    this.deadlines = [deadline, ...this.deadlines.filter(item => item.id !== deadline.id)];
    this.notify({ type: 'create', id: deadline.id, updatedAt: deadline.updatedAt });
    return deadline;
  }

  updateDeadline(id, updates = {}) {
    const deadline = this.getById(id);
    if (!deadline) return null;
    Object.assign(deadline, updates, { updatedAt: Date.now() });
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
      const existing = this.getById(record.id);
      if (!existing) {
        this.deadlines.unshift({ ...record.data, id: record.id, updatedAt: record.updatedAt });
        changed = true;
      } else if ((record.updatedAt || 0) > (existing.updatedAt || 0)) {
        Object.assign(existing, record.data, { id: record.id, updatedAt: record.updatedAt });
        changed = true;
      }
    }
    if (changed) this.notify({ type: 'merge-cloud' });
  }
}

export const deadlinesManager = new DeadlinesManager();
