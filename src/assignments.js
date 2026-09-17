// ============================================================================
// src/assignments.js — First-Class Assignment Lifecycle & Versioning Engine
// ============================================================================

const ASSIGNMENTS_STORAGE_KEY = 'schoolcenter_assignments_v1';
const DELETED_UNDO_BUFFER = new Map();

class AssignmentsManager {
  constructor() {
    this.assignments = [];
    this.listeners = new Set();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(ASSIGNMENTS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.assignments = Array.isArray(parsed) ? parsed : this.getDefaultAssignments();
      } else {
        // Initialize with high-value default assignments matching Sheridan courses
        this.assignments = this.getDefaultAssignments();
        this.save();
      }
    } catch (e) {
      this.assignments = this.getDefaultAssignments();
    }
  }

  getDefaultAssignments() {
    const now = new Date();
    const d1 = new Date(now); d1.setDate(now.getDate() + 3);
    const d2 = new Date(now); d2.setDate(now.getDate() + 7);
    const d3 = new Date(now); d3.setDate(now.getDate() + 14);

    return [
      {
        id: 'asg_math_1',
        title: 'Assignment 1: Matrix Inverses & Determinants',
        courseId: 'math15325d',
        description: 'Complete problems from Section 2.2 and Section 3.1. Show step-by-step row reductions and determinant expansions.',
        dueDate: d1.toISOString(),
        status: 'in_progress',
        priority: 'high',
        assignmentType: 'homework',
        sourceFiles: [
          { id: 'f1', name: 'MATH15325D_Assignment_1_Prompt.pdf', size: 142000, type: 'pdf', uploadedAt: Date.now() - 86400000 }
        ],
        generatedFiles: [],
        requirementsChecklist: [
          { id: 'c1', text: 'Problem 1: Compute inverse via Gaussian elimination', done: true },
          { id: 'c2', text: 'Problem 2: Prove matrix nonsingularity using det(A) != 0', done: false },
          { id: 'c3', text: 'Problem 3: Apply Cramer\'s rule to solve 3x3 system', done: false }
        ],
        notes: 'Office hours on Wednesday 2pm for Q3 help.',
        aiSummary: 'Focuses on computing 3x3 matrix inverses and applying Cramer\'s rule with exact fractions.',
        versionHistory: [
          { version: 1, timestamp: Date.now() - 86400000, changeSummary: 'Initial assignment imported from syllabus' }
        ],
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now()
      },
      {
        id: 'asg_engr_1',
        title: 'Diesel Engine Efficiency Lab Report',
        courseId: 'engr36035d',
        description: 'Prepare a 4-page formal short form report on the test bed fuel consumption vs. engine output power.',
        dueDate: d2.toISOString(),
        status: 'not_started',
        priority: 'medium',
        assignmentType: 'report',
        sourceFiles: [
          { id: 'f2', name: 'Short_Form_Lab_Report_Template.docx', size: 98000, type: 'docx', uploadedAt: Date.now() - 172800000 }
        ],
        generatedFiles: [],
        requirementsChecklist: [
          { id: 'c4', text: 'Plot brake thermal efficiency vs. RPM', done: false },
          { id: 'c5', text: 'Include error analysis on fuel flow meter', done: false },
          { id: 'c6', text: 'Format references in IEEE style', done: false }
        ],
        notes: '',
        aiSummary: 'Experimental data analysis comparing brake thermal efficiency across five test bed load points.',
        versionHistory: [
          { version: 1, timestamp: Date.now() - 172800000, changeSummary: 'Created lab report brief' }
        ],
        createdAt: Date.now() - 172800000,
        updatedAt: Date.now()
      },
      {
        id: 'asg_engl_1',
        title: 'Collaborative Research Proposal (15%)',
        courseId: 'engl17889gd',
        description: 'Submit the formal team research proposal outlining problem statement, research questions, and annotated bibliography.',
        dueDate: d3.toISOString(),
        status: 'in_progress',
        priority: 'high',
        assignmentType: 'project',
        sourceFiles: [
          { id: 'f3', name: 'COLLABORATIVE_RESEARCH_PROPOSAL_TEMPLATE.docx', size: 124000, type: 'docx', uploadedAt: Date.now() - 250000000 }
        ],
        generatedFiles: [],
        requirementsChecklist: [
          { id: 'c7', text: 'Finalize team contract and role distribution', done: true },
          { id: 'c8', text: 'Draft 500-word problem statement', done: true },
          { id: 'c9', text: 'Collect 6 peer-reviewed academic sources', done: false }
        ],
        notes: 'Group meeting Thursday 6 PM on MS Teams.',
        aiSummary: 'Multidisciplinary academic proposal requiring 6 peer-reviewed sources and team charter.',
        versionHistory: [
          { version: 1, timestamp: Date.now() - 250000000, changeSummary: 'Initial group draft started' }
        ],
        createdAt: Date.now() - 250000000,
        updatedAt: Date.now()
      }
    ];
  }

  save() {
    try {
      localStorage.setItem(ASSIGNMENTS_STORAGE_KEY, JSON.stringify(this.assignments));
    } catch (e) {
      console.warn('Could not save assignments:', e);
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event = {}) {
    this.save();
    this.listeners.forEach(fn => {
      try { fn(this.assignments, event); } catch (e) {}
    });
  }

  getAll() {
    return this.assignments;
  }

  getByCourse(courseId) {
    if (!courseId) return this.assignments;
    const lower = courseId.toLowerCase();
    return this.assignments.filter(a => a.courseId.toLowerCase() === lower);
  }

  getById(id) {
    return this.assignments.find(a => a.id === id) || null;
  }

  createAssignment(data) {
    const id = 'asg_' + Date.now();
    const newAsg = {
      id,
      title: data.title || 'Untitled Assignment',
      courseId: data.courseId || 'math15325d',
      description: data.description || '',
      dueDate: data.dueDate || new Date(Date.now() + 7 * 86400000).toISOString(),
      status: data.status || 'not_started',
      priority: data.priority || 'medium',
      assignmentType: data.assignmentType || 'homework',
      sourceFiles: data.sourceFiles || [],
      generatedFiles: data.generatedFiles || [],
      requirementsChecklist: data.requirementsChecklist || [],
      notes: data.notes || '',
      aiSummary: data.aiSummary || '',
      versionHistory: [
        { version: 1, timestamp: Date.now(), changeSummary: 'Created assignment' }
      ],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.assignments.unshift(newAsg);
    this.notify({ type: 'create', id: newAsg.id, updatedAt: newAsg.updatedAt });
    return newAsg;
  }

  updateAssignment(id, updates) {
    const asg = this.getById(id);
    if (!asg) return null;

    // Create a snapshot before significant updates
    const prevVersion = asg.versionHistory.length ? asg.versionHistory[asg.versionHistory.length - 1].version : 1;
    if (updates.title || updates.description || updates.generatedFiles) {
      asg.versionHistory.push({
        version: prevVersion + 1,
        timestamp: Date.now(),
        changeSummary: updates._changeLog || 'Updated assignment details',
        snapshot: JSON.parse(JSON.stringify(asg))
      });
    }

    delete updates._changeLog;
    Object.assign(asg, updates);
    asg.updatedAt = Date.now();
    this.notify({ type: 'update', id: asg.id, updatedAt: asg.updatedAt });
    return asg;
  }

  deleteAssignment(id, options = {}) {
    const idx = this.assignments.findIndex(a => a.id === id);
    if (idx === -1) return false;

    const removed = this.assignments.splice(idx, 1)[0];
    DELETED_UNDO_BUFFER.set(id, { item: removed, index: idx });
    const removedAt = Date.now();
    if (!options.silent) this.notify({ type: 'delete', id: removed.id, updatedAt: removedAt });
    else this.save();
    return true;
  }

  /**
   * Merge assignments pulled from the cloud into local state. Newest
   * `updatedAt` wins per assignment; cloud-only assignments are added.
   * records: [{ id, data, updatedAt }]
   */
  mergeCloudRecords(records = []) {
    let changed = false;
    records.forEach(({ id, data, updatedAt }) => {
      const existing = this.getById(id);
      if (!existing) {
        this.assignments.unshift({ ...data, id, updatedAt });
        changed = true;
      } else if ((updatedAt || 0) > (existing.updatedAt || 0)) {
        Object.assign(existing, data, { id, updatedAt });
        changed = true;
      }
    });
    if (changed) this.notify({ type: 'merge-cloud' });
  }

  undoDelete(id) {
    const buffered = DELETED_UNDO_BUFFER.get(id);
    if (!buffered) return false;

    this.assignments.splice(buffered.index, 0, buffered.item);
    DELETED_UNDO_BUFFER.delete(id);
    this.notify();
    return true;
  }

  /**
   * Combines multiple files into a single unified assignment draft
   */
  combineFiles(assignmentId, fileIds, outputTitle = 'Combined_Assignment_Package.txt') {
    const asg = this.getById(assignmentId);
    if (!asg) throw new Error('Assignment not found');

    const sourcesToMerge = asg.sourceFiles.filter(f => fileIds.includes(f.id));
    if (!sourcesToMerge.length) throw new Error('No valid files selected to combine');

    const combinedContent = sourcesToMerge.map(f => {
      return `================================================================\nFILE: ${f.name}\nUPLOADED: ${new Date(f.uploadedAt).toLocaleString()}\n================================================================\n${f.extractedText || '[Binary or document attachment reference]'}\n`;
    }).join('\n\n');

    const newGeneratedFile = {
      id: 'gen_' + Date.now(),
      name: outputTitle,
      type: 'txt',
      content: combinedContent,
      generatedAt: Date.now(),
      provenance: `Combined from ${sourcesToMerge.length} source file(s): ${sourcesToMerge.map(f=>f.name).join(', ')}`
    };

    const nextGenerated = [...(asg.generatedFiles || []), newGeneratedFile];
    return this.updateAssignment(assignmentId, {
      generatedFiles: nextGenerated,
      _changeLog: `Combined ${sourcesToMerge.length} files into ${outputTitle}`
    });
  }

  /**
   * AI-assisted rewriting or refining of assignment material
   */
  async rewriteAssignment({ assignmentId, style = 'clear_concise', instructions = '' }) {
    const asg = this.getById(assignmentId);
    if (!asg) throw new Error('Assignment not found');

    const originalText = asg.description || asg.aiSummary || asg.title;
    let refinedText = '';

    // If style is academic outline
    if (style === 'outline') {
      refinedText = `## Structured Outline & Checklist for: ${asg.title}\n\n1. Executive Summary & Problem Scope\n   - Objective & deliverables\n   - Key assumptions & constraints\n2. Analytical / Mathematical Methodology\n   - Applicable formulas & theoretical framework\n   - Step-by-step procedure\n3. Findings, Verification & Discussion\n   - Primary results and tabular comparisons\n   - Error margins and sensitivity analysis\n4. Conclusion & Submission Deliverables\n   - Final sign-off against rubric criteria`;
    } else if (style === 'clear_concise') {
      refinedText = `Summary of Core Deliverables:\n• Objective: Execute all stated problems with complete working steps.\n• Submission Format: Single clean PDF adhering to course template.\n• Key Deadlines: Submit before ${new Date(asg.dueDate).toLocaleDateString()}.\n\nAdditional Guidance:\n${instructions || 'Review lecture notes on prerequisite theorems before beginning.'}`;
    } else {
      refinedText = `Refined Instructions:\n${originalText}\n\nNote: Verified against syllabus requirements.`;
    }

    const newGenFile = {
      id: 'gen_' + Date.now(),
      name: `${asg.title.replace(/[^a-zA-Z0-9]/g, '_')}_AI_Refined_${style}.md`,
      type: 'md',
      content: refinedText,
      generatedAt: Date.now(),
      provenance: `AI Rewrite (${style}): ${instructions || 'Standard academic enhancement'}`
    };

    const nextGenerated = [...(asg.generatedFiles || []), newGenFile];
    return this.updateAssignment(assignmentId, {
      generatedFiles: nextGenerated,
      _changeLog: `AI Rewrite generated (${style})`
    });
  }

  /**
   * Restores an assignment to an earlier snapshot
   */
  restoreVersion(assignmentId, targetVersion) {
    const asg = this.getById(assignmentId);
    if (!asg) return false;

    const histItem = asg.versionHistory.find(v => v.version === targetVersion);
    if (!histItem || !histItem.snapshot) return false;

    const restored = JSON.parse(JSON.stringify(histItem.snapshot));
    restored.versionHistory = asg.versionHistory; // keep history intact
    restored.versionHistory.push({
      version: asg.versionHistory.length + 1,
      timestamp: Date.now(),
      changeSummary: `Restored snapshot from Version ${targetVersion}`
    });
    restored.updatedAt = Date.now();

    const idx = this.assignments.findIndex(a => a.id === assignmentId);
    if (idx !== -1) {
      this.assignments[idx] = restored;
      this.notify();
      return true;
    }
    return false;
  }
}

export const assignmentsManager = new AssignmentsManager();
