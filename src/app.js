// ============================================================================
// src/app.js — Full Dynamic Frontend Engine for School Center (Redesigned)
// Mobile-First Academic OS · iPhone/visionOS Glassmorphism · Real Web Audio
// ============================================================================

import { 
  getSupabase, 
  isSupabaseConfigured, 
  isAuthError,
  hasConfigOverrideMismatch,
  resetSupabaseAuthState,
  saveSupabaseConfig, 
  fetchCoursesWithMaterials 
} from './supabase.js';

import { 
  uploadAndProcessFile, 
  setupRealtimeListener 
} from './upload.js';

import { jobsManager } from './jobs.js';
import { detectCourseFromContent } from './course-detector.js';
import { assignmentsManager } from './assignments.js';
import { renderCampusMapWidget, renderShowLocationButton, attachCampusMapHandlers, highlightBuilding, initCampusMap3d } from './campus-map.js';
import { notesManager } from './notes.js';
import { deadlinesManager } from './deadlines.js';
import { routeCourseContent } from './course-data.js';
import { FocusMode } from './focus.js';
import { performUniversalSearch } from './search.js';
import { prepareGeminiFileParts, GeminiLiveTranscriber, GEMINI_FILE_ACCEPT } from './ai-workspace.js';
import { loadAiChatHistory, persistAiMessage, getCurrentAiUser, signInWithAccountPassword, signOutAiCloud, getEphemeralLiveToken, subscribeToAiChatHistory, deleteAiMessage, updateAiMessageText, clearAiConversation } from './ai-history.js';
import { pushLocalDataToCloud, pullCloudDataToLocal, fullTwoWaySync, startAutomaticDataSync, stopAutomaticDataSync, getDataSyncStatus } from './data-sync.js';

/* =========================================================================
   STORAGE SHIM
   ========================================================================= */
const LS_PREFIX = 'schoolcenter_fallback__';
const hasHostStorage = typeof window.storage === 'object' && window.storage !== null
  && typeof window.storage.get === 'function';

const storage = {
  async get(key, shared){
    if(hasHostStorage){
      try{ return await window.storage.get(key, shared); }
      catch(e){ /* fallback */ }
    }
    try{
      const raw = localStorage.getItem(LS_PREFIX+key);
      return raw === null ? null : { key, value: raw, shared: !!shared };
    }catch(e){ return null; }
  },
  async set(key, value, shared){
    if(hasHostStorage){
      try{ return await window.storage.set(key, value, shared); }
      catch(e){ /* fallback */ }
    }
    try{
      localStorage.setItem(LS_PREFIX+key, value);
      return { key, value, shared: !!shared };
    }catch(e){ return null; }
  }
};

/* =========================================================================
   ICONS
   ========================================================================= */
const ICONS = {
  home: `<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  book: `<svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  spark: `<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></svg>`,
  more: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`,
  plus: `<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  close: `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  mic: `<svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  doc: `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  camera: `<svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  clipboard: `<svg viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>`,
  search: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  play: `<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  pause: `<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
  rewind: `<svg viewBox="0 0 24 24"><polyline points="11 19 4 12 11 5"/><polyline points="20 19 13 12 20 5"/></svg>`,
  forward: `<svg viewBox="0 0 24 24"><polyline points="13 19 20 12 13 5"/><polyline points="4 19 11 12 4 5"/></svg>`,
  arrowLeft: `<svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
  chevronRight: `<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>`,
  trash: `<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  pencil: `<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  download: `<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  timer: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`,
  settings: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9A1.65 1.65 0 0 0 10 3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 .91 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  arrowUp: `<svg viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
  gear: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`
};

function icon(name, cls = '') {
  return `<span class="icon-inline ${cls}">${ICONS[name] || ''}</span>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function decodeB64Utf8(b64){
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  } catch(e) {
    return '';
  }
}

/* =========================================================================
/* =========================================================================
   STATIC COURSE METADATA & AUTHORITATIVE FALL 2026 SCHEDULE
   ========================================================================= */
export const FALL_2026_SCHEDULE = [
  // MONDAY
  { day: 1, dayName: 'Mon', start: '11:00 AM', end: '12:00 PM', courseId: 'math15325d', courseCode: 'MATH 15325D', courseName: 'Linear Algebra', type: 'Lecture', room: 'C328', instructor: 'Cyrus Hosseini', accent: '#8B7CF6' },
  { day: 1, dayName: 'Mon', start: '1:00 PM', end: '3:00 PM', courseId: 'math15325d', courseCode: 'MATH 15325D', courseName: 'Linear Algebra', type: 'Lab', room: 'J301', instructor: 'Cyrus Hosseini', accent: '#8B7CF6' },
  { day: 1, dayName: 'Mon', start: '3:00 PM', end: '4:00 PM', courseId: 'math15325d', courseCode: 'MATH 15325D', courseName: 'Linear Algebra', type: 'Lecture', room: 'J301', instructor: 'TBA', accent: '#8B7CF6' },
  
  // TUESDAY
  { day: 2, dayName: 'Tue', start: '9:00 AM', end: '12:00 PM', courseId: 'engr36035d', courseCode: 'ENGR 36035D', courseName: 'Intro to Energy Systems', type: 'Lecture', room: 'C271', instructor: 'Amin Ghobeity', accent: '#34D1BF' },
  
  // WEDNESDAY
  { day: 3, dayName: 'Wed', start: '10:00 AM', end: '12:00 PM', courseId: 'math15325d', courseCode: 'MATH 15325D', courseName: 'Linear Algebra', type: 'Lecture', room: 'J301', instructor: 'Cyrus Hosseini', accent: '#8B7CF6' },
  
  // THURSDAY
  { day: 4, dayName: 'Thu', start: '3:00 PM', end: '5:00 PM', courseId: 'engr36035d', courseCode: 'ENGR 36035D', courseName: 'Intro to Energy Systems', type: 'Lab', room: 'A305', instructor: 'Amin Ghobeity', accent: '#34D1BF' },
  
  // FRIDAY
  { day: 5, dayName: 'Fri', start: '1:00 PM', end: '4:00 PM', courseId: 'engr43301d', courseCode: 'ENGR 43301D', courseName: 'Economics & Entrepreneurship', type: 'Lecture', room: 'Online (VTL)', instructor: 'Manju Sunil Varghese', accent: '#F5A623' }
];

export function getClassesForDate(dateInput) {
  let d;
  if (dateInput instanceof Date) {
    d = dateInput;
  } else if (typeof dateInput === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      const [y, m, day] = dateInput.split('-').map(Number);
      d = new Date(y, m - 1, day, 12, 0, 0);
    } else {
      d = new Date(dateInput);
    }
  } else {
    d = new Date();
  }
  const dayOfWeek = d.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  
  const events = [];
  FALL_2026_SCHEDULE.filter(s => s.day === dayOfWeek).forEach(s => {
    const course = courseById(s.courseId) || { id: s.courseId, code: s.courseCode, name: s.courseName, accent: s.accent };
    events.push({
      course,
      schedule: {
        day: s.dayName,
        start: s.start,
        end: s.end,
        type: s.type,
        room: s.room,
        instructor: s.instructor
      }
    });
  });
  return events;
}

/** All outline-generated deadlines due on the given date (any status except
 * done — done rows have already been removed by auto-expiry in practice). */
export function getDeadlinesForDate(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return [];
  const key = d.toDateString();
  return deadlinesManager.getAll()
    .filter(item => item.status !== 'done' && new Date(item.dueAt).toDateString() === key)
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
}

/** Agenda rows for deadline items (used by the calendar and month views). */
function renderDeadlineAgendaItems(deadlines) {
  return (deadlines || []).map(deadline => {
    const course = courseById(deadline.courseId);
    return `
      <div class="agenda-item" style="--item-color:var(--accent-3);">
        <div class="agenda-time">Due Date</div>
        <div class="agenda-main">
          <div class="agenda-course">${escapeHtml(course ? course.code : (deadline.courseCode || 'General'))}</div>
          <div class="agenda-title">📅 ${escapeHtml(deadline.title)}</div>
          <div style="font-size:0.75rem;color:var(--muted);margin-top:2px;">${escapeHtml(deadline.type)}${deadline.weight ? ` · ${deadline.weight}%` : ''}</div>
        </div>
      </div>
    `;
  }).join('');
}

const STATIC_COURSES = [
  {
    id:'math15325d', code:'MATH 15325D', name:'Linear Algebra', instructor:'Cyrus Hosseini, PhD PEng',
    hasMaterial:true, accent:'#8B7CF6',
    schedule:[
      {day:'Mon', start:'11:00 AM', end:'12:00 PM', type:'Lecture', room:'C328', instructor:'Cyrus Hosseini'},
      {day:'Mon', start:'1:00 PM', end:'3:00 PM', type:'Lab', room:'J301', instructor:'Cyrus Hosseini'},
      {day:'Mon', start:'3:00 PM', end:'4:00 PM', type:'Lecture', room:'J301', instructor:'TBA'},
      {day:'Wed', start:'10:00 AM', end:'12:00 PM', type:'Lecture', room:'J301', instructor:'Cyrus Hosseini'},
    ],
    evaluation:[
      ['Assignments (3 @ 5% each)','15%'],
      ['Quizzes (2 @ 10% each)','20%'],
      ['Midterm Exam','30%'],
      ['Final Exam','35%'],
    ],
    textbook:'Linear Algebra with Applications, 10th edition, by Steven J. Leon and Lisette de Pillis',
    syllabus:[
      ['1','Sep 7','Matrices and Systems of Equations — Systems of linear equations, row reduction and echelon forms, matrix operations','Diagnostic Assessment · Homework 1'],
      ['2','Sep 14','Matrix Operations & Inverses — Matrix multiplication, algebraic rules, inverse of a matrix, elementary matrices','Quiz 1 (10%) · Homework 2'],
      ['3','Sep 21','Determinants — The determinant of a matrix, properties of determinants, Cramer\'s rule','Assignment 1 (5%)'],
      ['4','Sep 28','Vector Spaces — Subspaces, null spaces, column spaces, linear transformations','Homework 3'],
      ['5','Oct 5','Linear Independence and Bases — Linearly independent sets, bases, coordinate systems, dimension of a vector space','Quiz 2 (10%) · Homework 4'],
      ['6','Oct 12','Rank & Change of Basis — The rank-nullity theorem, change of basis, application to differential equations','Assignment 2 (5%)'],
      ['7','Oct 19','Midterm Exam — Comprehensive through Week 6','Midterm Exam (30%)'],
      ['—','Oct 26','Reading Week — no classes scheduled','—'],
      ['8','Nov 2','Linear Transformations — Definition and examples, matrix representations, similarity','Homework 5'],
      ['9','Nov 9','Eigenvalues and Eigenvectors — Characteristic equation, diagonalization, complex eigenvalues','Homework 6'],
      ['10','Nov 16','Orthogonality — Inner products, lengths, orthogonality, orthogonal projections','Assignment 3 (5%)'],
      ['11','Nov 23','The Gram-Schmidt Process — Orthonormal bases, Gram-Schmidt orthogonalization, QR-factorization','Homework 7'],
      ['12','Nov 30','Least Squares & Symmetric Matrices — Least squares problems, diagonalization of symmetric matrices, quadratic forms','Homework 8'],
      ['13','Dec 7','Singular Value Decomposition & Review — SVD overview, review for final examination','Review session'],
      ['14','Dec 14','Final Exam Period — Scheduled centrally by Sheridan registrar','Final Exam (35%)'],
    ],
    lectures:[
      {
        title:'Week 1 — Systems of Linear Equations & Row Operations',
        concepts:[
          ['Linear system','A collection of one or more linear equations involving the same set of variables.'],
          ['Augmented matrix','A compact grid $[A \\mid \\mathbf{b}]$ combining the coefficient matrix and the right-hand constants.'],
          ['Elementary row operations (EROs)','Three reversible operations: row swap ($R_i \\leftrightarrow R_j$), scalar multiplication, and row addition.'],
          ['Reduced row echelon form (RREF)','Leading 1s with zeros in the rest of the column. Unique for every matrix.'],
        ]
      }
    ],
    worksheets:[
      {
        title:'Tutorial 1 — Linear Systems & Gaussian Elimination',
        items:[
          'Determine the condition on $k$ such that the system has unique, infinite, or no solutions: $x + 2y = 3$, $3x + ky = 9$.',
          'Solve the $3 \\times 3$ system using Gauss-Jordan elimination: $x - 2y + z = 0$, $2x + y - 3z = 5$, $4x - 7y - z = -1$.'
        ]
      }
    ]
  },
  {
    id:'engr36035d', code:'ENGR 36035D', name:'Intro to Energy Systems', instructor:'Amin Ghobeity',
    hasMaterial:true, accent:'#34D1BF',
    schedule:[
      {day:'Tue', start:'9:00 AM', end:'12:00 PM', type:'Lecture', room:'C271', instructor:'Amin Ghobeity'},
      {day:'Thu', start:'3:00 PM', end:'5:00 PM', type:'Lab', room:'A305', instructor:'Amin Ghobeity'},
    ],
    evaluation:[
      ['Quizzes (4 @ 5%)','20%'],
      ['Assignments (3 @ 5%)','15%'],
      ['Midterm Exam','25%'],
      ['Laboratory Reports','15%'],
      ['Final Exam','25%'],
    ],
    textbook:'Energy Systems Engineering: Evaluation and Implementation, Vanek & Albright, 3rd ed.',
    syllabus:[
      ['1','Sep 8','Energy Fundamentals — First & Second laws of thermodynamics, energy units & conversions','Review Quiz'],
      ['2','Sep 15','Fossil Fuels — Combustion chemistry, coal, oil, natural gas, emissions modeling','Quiz 1 (5%)'],
      ['3','Sep 22','Rankine & Brayton Cycles — Steam and gas turbine power generation cycles','Assignment 1 (5%)']
    ],
    lectures:[
      {
        title:'Module 1 — Energy Fundamentals & Thermodynamics',
        concepts:[
          ['First Law of Thermodynamics','Conservation of energy: $\\Delta U = Q - W$.'],
          ['Second Law of Thermodynamics','Entropy of an isolated system always increases. Carnot efficiency $\\eta_C = 1 - T_C / T_H$.']
        ]
      }
    ],
    worksheets:[]
  },
  {
    id:'engr43301d', code:'ENGR 43301D', name:'Economics & Entrepreneurship', instructor:'Manju Sunil Varghese',
    hasMaterial:true, accent:'#F5A623',
    schedule:[
      {day:'Fri', start:'1:00 PM', end:'4:00 PM', type:'Lecture', room:'Online (VTL)', instructor:'Manju Sunil Varghese'}
    ],
    evaluation:[
      ['Case Studies (3 @ 10%)','30%'],
      ['Midterm Exam','25%'],
      ['Business Plan Pitch','20%'],
      ['Final Exam','25%'],
    ],
    syllabus:[
      ['1','Sep 9','Engineering Decision Making — Time value of money, cash flow diagrams','Intro Exercises'],
      ['2','Sep 16','Interest Formulas — Single payments, uniform series, gradient series','Quiz 1']
    ],
    lectures:[],
    worksheets:[]
  },
  {
    id:'anth17028gd', code:'ANTH 17028GD', name:'Anthropology of Health', instructor:'Slate Online',
    hasMaterial:true, accent:'#F0608A',
    schedule:[], async:true,
    evaluation:[
      ['Discussion','20%'],
      ['Quizzes (10 @ 5% each)','50%'],
      ['Paleopathology Group Project','20%'],
    ],
    syllabus:[
      ['1','Module 1','Anthropological Perspectives on Health — core definitions, medical anthropology','Discussion · Quiz 1 (5%)'],
      ['2','Module 2','Biocultural Perspectives & Ethics in Health Research','Quiz 2 (5%)']
    ],
    lectures:[],
    worksheets:[]
  },
  {
    id:'engl17889gd', code:'ENGL 17889GD', name:'Composition & Rhetoric', instructor:'Slate Online',
    hasMaterial:false, accent:'#5FD37A',
    schedule:[], async:true, lectures:[], worksheets:[]
  }
];

const COURSE_MATERIAL_CACHE_KEY = 'schoolcenter_course_materials_cache_v1';
let COURSES = JSON.parse(JSON.stringify(STATIC_COURSES));

function restoreCachedCourseMaterials() {
  try {
    const cached = JSON.parse(localStorage.getItem(COURSE_MATERIAL_CACHE_KEY) || '{}');
    if (!cached || typeof cached !== 'object') return;
    COURSES.forEach(course => {
      const key = cleanCourseCode(course.code || course.id);
      const materials = Array.isArray(cached[key]) ? cached[key] : [];
      if (!materials.length) return;
      course.cloudMaterials = materials;
      course.hasMaterial = true;
    });
  } catch (_) {}
}

function persistCourseMaterials() {
  try {
    const cached = {};
    COURSES.forEach(course => {
      const materials = Array.isArray(course.cloudMaterials) ? course.cloudMaterials : [];
      if (materials.length) cached[cleanCourseCode(course.code || course.id)] = materials;
    });
    localStorage.setItem(COURSE_MATERIAL_CACHE_KEY, JSON.stringify(cached));
  } catch (_) {}
}

restoreCachedCourseMaterials();
// Seed dated assessments from the embedded course outlines immediately, then
// refresh the same stable IDs after cloud course hydration.
deadlinesManager.syncCourseOutlineDeadlines(COURSES);

export function cleanCourseCode(code) {
  return (code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function courseById(id) {
  if (!id) return null;
  const targetKey = cleanCourseCode(id);
  return COURSES.find(c => 
    c.id === id || 
    c.id.toLowerCase() === id.toLowerCase() || 
    cleanCourseCode(c.id) === targetKey || 
    cleanCourseCode(c.code) === targetKey || 
    (c.dbId && c.dbId === id)
  );
}

/* =========================================================================
   THEMES & PALETTES
   ========================================================================= */
const THEME_PRESETS = {
  violet: {
    label:'Deep Violet',
    ink:'#F4F6FD', muted:'#A7B0D6', mutedDim:'#7981A8',
    accent:'#8B7CF6', accent2:'#34D1BF', accent3:'#F0608A',
    bg1:'#0B0F2E', bg2:'#0E1A3D', bg3:'#0A2A44',
    lava:['#8B7CF6','#5B4FD6','#B892FF','#3A2E7A']
  },
  crimson: {
    label:'Crimson Load',
    ink:'#FFF3F1', muted:'#E7B3AC', mutedDim:'#B9807A',
    accent:'#FF5A4E', accent2:'#FF8C7A', accent3:'#FFD166',
    bg1:'#320705', bg2:'#4A0C08', bg3:'#5E100A',
    lava:['#FF3B30','#D91F17','#FF7A6E','#8C0E08']
  },
  ultraviolet: {
    label:'Ultraviolet',
    ink:'#F6F0FF', muted:'#C7AEE8', mutedDim:'#8F6FB8',
    accent:'#C042FF', accent2:'#5B7CFF', accent3:'#FF4FD8',
    bg1:'#170426', bg2:'#230A3C', bg3:'#170A44',
    lava:['#C042FF','#5B2E9E','#FF4FD8','#3D1E7A']
  },
  midnight: {
    label:'Midnight Teal',
    ink:'#EFFAF8', muted:'#9DC2BC', mutedDim:'#6E938D',
    accent:'#34D1BF', accent2:'#5FD37A', accent3:'#8B7CF6',
    bg1:'#031312', bg2:'#052321', bg3:'#0A2E2C',
    lava:['#34D1BF','#0F8C7E','#5FD37A','#0A4B45']
  }
};

let currentTheme = THEME_PRESETS.violet;

function hexToHsl(hex){
  const m=hex.replace('#',''); const n=parseInt(m.length===3?m.split('').map(x=>x+x).join(''):m,16);
  let r=((n>>16)&255)/255,g=((n>>8)&255)/255,b=(n&255)/255; const max=Math.max(r,g,b),min=Math.min(r,g,b); let h=0,s=0,l=(max+min)/2;
  if(max!==min){const d=max-min;s=l>0.5?d/(2-max-min):d/(max+min);switch(max){case r:h=(g-b)/d+(g<b?6:0);break;case g:h=(b-r)/d+2;break;default:h=(r-g)/d+4;}h/=6;}
  return [h*360,s*100,l*100];
}
function hslToHex(h,s,l){
  s/=100;l/=100;const k=n=>(n+h/30)%12;const a=s*Math.min(l,1-l);const f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));
  return '#'+[f(0),f(8),f(4)].map(x=>Math.round(255*x).toString(16).padStart(2,'0')).join('');
}
function hexToRgb(hex){ const m=String(hex||'').replace('#',''); const n=parseInt(m,16); return Number.isFinite(n)?`${(n>>16)&255},${(n>>8)&255},${n&255}`:'139,124,246'; }
function applyTheme(t, persist=true){
  if(!t) return;
  currentTheme = t;
  const r = document.documentElement.style;
  r.setProperty('--ink', t.ink);
  r.setProperty('--muted', t.muted);
  r.setProperty('--muted-dim', t.mutedDim);
  r.setProperty('--accent', t.accent);
  r.setProperty('--accent-2', t.accent2);
  r.setProperty('--accent-3', t.accent3);
  r.setProperty('--accent-rgb', hexToRgb(t.accent));
  r.setProperty('--bg-1', t.bg1);
  r.setProperty('--bg-2', t.bg2);
  r.setProperty('--bg-3', t.bg3);
  // v1.3.0: --lava-a..d and the animated canvas are gone. The background is a
  // static near-monochrome field (see "APP BACKGROUND" in style.css) that
  // derives its single wash from --accent-rgb, set above. t.lava is retained
  // only as swatch-gradient data for the theme picker in Settings.
  if(persist) {
    localStorage.setItem('sc_theme_key', Object.entries(THEME_PRESETS).find(([,v])=>v===t)?.[0] || 'custom');
    if (t.__customAccent) localStorage.setItem('sc_custom_accent', t.accent);
    else localStorage.removeItem('sc_custom_accent');
    if (!applyingRemoteTheme) pushThemeToCloud().catch(() => {});
  }
}

function applyCustomAccent(hex, persist=true){
  const clean = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#8B7CF6';
  const [h,s,l] = hexToHsl(clean);
  const next = { ...THEME_PRESETS.violet, label: 'Custom', accent: clean, accent2: hslToHex((h+150)%360, Math.min(100,s+4), Math.min(82,l+8)), accent3: hslToHex((h+320)%360, Math.min(100,s+8), Math.min(78,l+4)), __customAccent: true };
  next.lava = [clean, next.accent2, next.accent3, hslToHex((h+35)%360, Math.min(100,s+8), Math.max(15,l-22))];
  applyTheme(next, false);
  if(persist) {
    localStorage.setItem('sc_custom_accent', clean);
    if (!applyingRemoteTheme) pushThemeToCloud().catch(() => {});
  }
  return next;
}
/* =========================================================================
   CROSS-DEVICE APPEARANCE SYNC
   ========================================================================= */
let themeSettingsChannel = null;
let applyingRemoteTheme = false;

function themeKeyFor(theme) {
  return Object.entries(THEME_PRESETS).find(([, value]) => value === theme)?.[0] || null;
}

async function pushThemeToCloud() {
  if (applyingRemoteTheme) return;
  const sb = getSupabase();
  if (!sb) return;
  const user = await getCurrentAiUser().catch(() => null);
  if (!user) return;
  const customAccent = localStorage.getItem('sc_custom_accent') || null;
  const themeKey = customAccent ? null : (localStorage.getItem('sc_theme_key') || themeKeyFor(currentTheme) || 'violet');
  const bgGlow = Number(localStorage.getItem('sc_lava_opacity') || getComputedStyle(document.documentElement).getPropertyValue('--bg-glow') || '1');
  const { error } = await sb.from('user_settings').upsert({
    user_id: user.id,
    theme_key: themeKey,
    custom_accent: customAccent,
    bg_glow: Number.isFinite(bgGlow) ? bgGlow : 1,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
  if (error) console.warn('Appearance cloud sync push failed:', error.message);
}

function applyCloudTheme(row) {
  if (!row) return;
  applyingRemoteTheme = true;
  try {
    if (row.custom_accent) applyCustomAccent(row.custom_accent, false);
    else if (row.theme_key && THEME_PRESETS[row.theme_key]) applyTheme(THEME_PRESETS[row.theme_key], false);
    if (typeof row.bg_glow === 'number') {
      document.documentElement.style.setProperty('--bg-glow', String(row.bg_glow));
      document.documentElement.style.setProperty('--lava-opacity', String(row.bg_glow));
      localStorage.setItem('sc_lava_opacity', String(row.bg_glow));
    }
  } finally {
    applyingRemoteTheme = false;
  }
}

async function startThemeCloudSync(userId) {
  const sb = getSupabase();
  if (!sb || !userId) return;
  if (themeSettingsChannel) {
    try { await sb.removeChannel(themeSettingsChannel); } catch (_) {}
    themeSettingsChannel = null;
  }
  const { data, error } = await sb.from('user_settings').select('*').eq('user_id', userId).maybeSingle();
  if (!error && data) applyCloudTheme(data);
  else if (error && error.code !== 'PGRST116') console.warn('Appearance cloud sync pull failed:', error.message);
  else await pushThemeToCloud();
  themeSettingsChannel = sb.channel(`school-center-settings-${userId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'user_settings',
      filter: `user_id=eq.${userId}`
    }, payload => {
      if (payload.new) {
        applyCloudTheme(payload.new);
        if (state.view === 'settings') render();
      }
    })
    .subscribe();
}

async function stopThemeCloudSync() {
  const sb = getSupabase();
  if (sb && themeSettingsChannel) {
    try { await sb.removeChannel(themeSettingsChannel); } catch (_) {}
  }
  themeSettingsChannel = null;
}


/* =========================================================================
   BACKGROUND
   The animated "lava lamp" canvas engine that used to live here was removed
   in v1.3.0. It painted four fully-saturated radial blobs at 0.65 alpha over
   a navy base, every frame, behind every glass surface in the app — the
   source of the "blurry background / amateur colours" complaint, and a
   constant repaint cost on mobile. The replacement is pure CSS: a static
   graphite gradient with one low-opacity accent wash. See "APP BACKGROUND"
   in src/style.css. The Settings slider now drives --bg-glow.
   ========================================================================= */



/* =========================================================================
   APPLICATION STATE & ACTIVE INSTANCES
   ========================================================================= */
let state = {
  view: 'today', // today | calendar | courses | ai | settings
  courseId: null, // when navigating inside a specific course
  courseTab: 'overview', // overview | materials | assignments | notes
  selectedCalendarDay: new Date().toDateString(),
  searchQuery: '',
  jobsDrawerOpen: false,
  focusActive: false,
  // Modal state
  assignmentModalOpen: false,
  assignmentModalPreset: {}, // { courseId, dueDate }
  assignmentDetailId: null,  // id of assignment to show in detail modal
  noteModalOpen: false,
  noteModalPreset: {},        // { courseId }
  flashcardsModalOpen: false,
  flashcardIndex: 0,
  // Phase 2 New Modals
  calendarViewMode: 'week', // 'week' | 'month'
  monthCalendarYear: new Date().getFullYear(),
  monthCalendarMonth: new Date().getMonth(),
  spotlightSearchOpen: false,
  spotlightQuery: '',
  syncDrawerOpen: false,
  aiAssistantOpen: false,
  aiChatMessages: [],
  aiIsThinking: false,
  aiAttachments: [],
  aiTranscribing: false,
  aiConnectionState: 'idle',
  dataSyncRealtime: 'idle',
  dataSyncRealtimeNote: '',
  aiLastModel: null,
  aiToolsDisabled: false,
  aiLiveTranscript: '',
  aiHistoryLoaded: false,
  aiCloudConnected: false,
  aiCloudUser: null,
  aiSearchResultsCount: 0,
  dataSyncLastError: null,
  dataSyncLastOkAt: null,
  syncBannerDismissed: false,
  materialsSyncError: null, // set by syncDataFromSupabase() when course/material fetch fails
  materialsHydrated: false, // true once at least one successful course sync has completed
  deadlinesHydrated: false,
  deadlinesSyncError: null
};

let aiLiveTranscriber = null;
let aiActiveAttachments = [];
let focusModeInstance = null;
let aiHistoryUnsubscribe = null;

/* =========================================================================
   DATA SYNC WITH SUPABASE
   ========================================================================= */

/** v1.5.4 STALL GUARD: supabase-js requests have NO built-in timeout. On a
 * machine with a stalled connection (AV/proxy/DNS/half-open socket — invisible
 * in clean-network test profiles), an awaited query can pend FOREVER. That is
 * the exact mechanism behind a Materials tab stuck on "Loading course
 * materials…" for 10+ minutes: neither the hydrated flag nor the error flag is
 * ever reached because the await never settles. Every awaited network call in
 * the hydration chain is therefore raced against a hard deadline. */
const SYNC_HTTP_TIMEOUT_MS = 20000;
class SyncHttpTimeoutError extends Error {
  constructor(ms) { super(`Request stalled with no response for ${Math.round(ms / 1000)}s and was aborted. Usually a network, proxy, antivirus, or DNS problem on this device.`); this.name = 'SyncHttpTimeoutError'; }
}
function withTimeout(promise, ms = SYNC_HTTP_TIMEOUT_MS) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new SyncHttpTimeoutError(ms)), ms);
  });
  return Promise.race([Promise.resolve(promise), deadline]).finally(() => clearTimeout(timer));
}

/** Enumerate a course folder in the public course-materials Storage bucket
 * and turn every file into a viewable material row. Storage is an
 * independent source of truth for uploaded files: when the materials table
 * or its module relationship fails (bad key, RLS, PostgREST hiccup), the
 * files themselves can still populate the course library.
 * Returns { rows, error } so a failed listing can be distinguished from a
 * genuinely empty folder — a swallowed storage error must never masquerade
 * as "this course has no files". */
async function listCourseMaterialsFromStorage(sb, dbCourse, dbModule) {
  try {
    // v1.5.4: hard deadline — without it a stalled storage request pends
    // forever and this whole fallback path hangs with it.
    const { data: objects, error } = await withTimeout(
      sb.storage
        .from('course-materials')
        .list(dbCourse.code, {
          limit: 1000,
          offset: 0,
          sortBy: { column: 'name', order: 'asc' }
        })
    );
    if (error) {
      console.warn(`Storage listing failed for ${dbCourse.code}:`, error.message || error);
      return { rows: [], error };
    }
    if (!objects?.length) return { rows: [], error: null };
    const rows = objects
      .filter(obj => obj?.name && !obj.name.endsWith('/'))
      .map(obj => {
        const filePath = dbCourse.code + '/' + obj.name;
        const { data: urlData } = sb.storage.from('course-materials').getPublicUrl(filePath);
        return {
          id: 'storage-' + dbCourse.code + '-' + (obj.id || obj.name),
          module_id: dbModule?.id || null,
          moduleTitle: dbModule?.title || 'Course Materials & Readings',
          title: obj.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' '),
          type: /assignment|submission|homework|lab|project|worksheet|tutorial/i.test(obj.name) ? 'assignment' : 'other',
          file_path: filePath,
          file_url: urlData?.publicUrl || '',
          content_json: {},
          status: 'completed',
          source: 'storage-fallback'
        };
      });
    return { rows, error: null };
  } catch (err) {
    console.warn(`Storage listing threw for ${dbCourse.code}:`, err?.message || err);
    return { rows: [], error: err };
  }
}

async function runSupabaseCourseSync() {
  if (!isSupabaseConfigured()) return false;

  const sb = getSupabase();
  if (!sb) return false;

  try {
    // Course content is foundational app data. Fetch the three tables
    // independently so a PostgREST relationship/cache issue cannot make the
    // course appear empty when the underlying rows already exist.
    // v1.5.4: each query races a deadline (see SYNC_HTTP_TIMEOUT_MS above) so
    // a request that NEVER completes rejects with SyncHttpTimeoutError and the
    // sync settles with an explicit, visible error instead of an eternal
    // "Loading…".
    const [courseRes, moduleRes, materialRes] = await Promise.all([
      withTimeout(sb.from('courses').select('*').order('code')),
      withTimeout(sb.from('modules').select('*').order('order_index')),
      withTimeout(sb.from('materials').select('*').order('created_at'))
    ]);

    if (courseRes.error) throw courseRes.error;
    if (moduleRes.error) throw moduleRes.error;

    const dbCourses = courseRes.data || [];
    const dbModules = moduleRes.data || [];
    // Do not fail the entire course library because the materials table is
    // temporarily unavailable. Storage is the source of truth for uploaded
    // files and gives us a second independent recovery path. The error is
    // recorded (not swallowed) so that if no recovery path yields materials,
    // the failure surfaces instead of rendering a false empty state.
    const materialsTableError = materialRes.error || null;
    let dbMaterials = materialRes.error ? [] : (materialRes.data || []);

    // Primary fallback: nested PostgREST relationship.
    if (!dbMaterials.length && dbModules.length) {
      try {
        const nested = await fetchCoursesWithMaterials();
        const nestedMaterials = [];
        (nested || []).forEach(course => {
          (course.modules || []).forEach(module => {
            (module.materials || []).forEach(material => {
              nestedMaterials.push({ ...material, moduleTitle: module.title });
            });
          });
        });
        if (nestedMaterials.length) dbMaterials = nestedMaterials;
      } catch (_) {}
    }

    // Course/Module queries succeeded. For each course, if the database
    // relationship yielded no material rows for it, fall back to the actual
    // Storage objects for that course. Per-course, not gated on the whole
    // materials table being empty: one course with an orphaned module or a
    // bad row must not blank its neighbours, and Storage is an independent
    // source of truth for uploaded files.
    const storageMaterialsByCourse = new Map();
    {
      const orphanedCourses = dbCourses.filter(dbC => {
        const courseModules = dbModules.filter(m => m.course_id === dbC.id);
        if (!courseModules.length) return true;
        return !dbMaterials.some(m => courseModules.some(mod => mod.id === m.module_id));
      });
      const storageFailures = [];
      await Promise.all(orphanedCourses.map(async dbC => {
        const module = dbModules.find(m => m.course_id === dbC.id) || null;
        const { rows, error } = await listCourseMaterialsFromStorage(sb, dbC, module);
        if (rows.length) storageMaterialsByCourse.set(dbC.id, rows);
        else if (error) storageFailures.push(`${dbC.code}: ${error.message || error}`);
      }));
      // Honest-failure contract: if the materials table query failed AND no
      // recovery path produced any rows, this is an infrastructure failure
      // (network / RLS / PostgREST), NOT an empty library. Throw so the
      // Materials tab shows the error banner instead of "No document files
      // uploaded".
      if (materialsTableError && !dbMaterials.length && !storageMaterialsByCourse.size) {
        throw materialsTableError;
      }
      // Table failed but Storage covered some courses: keep the partial data
      // visible, but do not pretend everything is fine.
      if (materialsTableError) {
        console.warn('materials table query failed; serving Storage fallback rows where available:', materialsTableError.message || materialsTableError);
      }
      if (storageFailures.length) {
        console.warn('Some course folders could not be listed in Storage:', storageFailures.join(' | '));
      }
    }

    const modulesByCourse = new Map();
    const moduleById = new Map();

    dbModules.forEach(module => {
      const normalized = { ...module, materials: [] };
      if (!modulesByCourse.has(module.course_id)) modulesByCourse.set(module.course_id, []);
      modulesByCourse.get(module.course_id).push(normalized);
      moduleById.set(module.id, normalized);
    });

    dbMaterials.forEach(material => {
      // Nested fallback rows already carry moduleTitle and may not be in the
      // flat module map, so support both forms.
      const module = moduleById.get(material.module_id);
      if (module) module.materials.push(material);
    });

    if (!dbCourses.length) {
      // v1.5.3 honest-failure contract, part 2: a successful query that returns
      // ZERO courses is not a valid hydration. It means this device is almost
      // certainly talking to the WRONG cloud project (a saved
      // sc_supabase_url/sc_supabase_anon_key override from an older build, or a
      // stale/cached page without the deployed meta tags). Previously this
      // returned false with no error and no render — the silent path that can
      // leave a device showing an empty course library forever. Name the real
      // cause and let syncDataFromSupabase() self-heal it once.
      state.materialsSyncError =
        'Cloud error: The connected Supabase project returned no courses. ' +
        'This device may be pointing at the wrong cloud project (a saved connection override) ' +
        'or the project database was reset.';
      if (state.view === 'courses' && state.courseTab === 'materials') {
        render();
      }
      return false;
    }

    dbCourses.forEach(dbC => {
      const dbKey = cleanCourseCode(dbC.code || dbC.id);
      const match = COURSES.find(c =>
        cleanCourseCode(c.code) === dbKey ||
        cleanCourseCode(c.id) === dbKey ||
        (c.dbId && c.dbId === dbC.id)
      );

      const flattenedMaterials = [];
      (modulesByCourse.get(dbC.id) || []).forEach(module => {
        (module.materials || []).forEach(material => {
          flattenedMaterials.push({ ...material, moduleTitle: module.title });
        });
      });

      // Merge in the per-course Storage fallback rows. Additive: DB rows and
      // Storage files can coexist; dedupe by file_path/URL so an uploaded
      // file never renders twice.
      const seenMaterialKeys = new Set(
        flattenedMaterials.map(m => String(m.file_path || m.file_url || m.id))
      );
      (storageMaterialsByCourse.get(dbC.id) || []).forEach(material => {
        const key = String(material.file_path || material.file_url || material.id);
        if (!seenMaterialKeys.has(key)) {
          seenMaterialKeys.add(key);
          flattenedMaterials.push({ ...material });
        }
      });

      // If the defensive nested fallback was used, preserve those rows too.
      if (!flattenedMaterials.length) {
        dbMaterials
          .filter(material => {
            const nestedCourse = material.course_id || material.courseId;
            return nestedCourse && cleanCourseCode(nestedCourse) === dbKey;
          })
          .forEach(material => flattenedMaterials.push({ ...material }));
      }

      if (match) {
        match.dbId = dbC.id;
        if (dbC.name) match.name = dbC.name;
        if (dbC.instructor) match.instructor = dbC.instructor;
        if (dbC.color) match.accent = dbC.color;
        match.modules = modulesByCourse.get(dbC.id) || match.modules || [];
        // A sign-in callback can briefly return an authenticated cloud
        // response with no material rows while the session/RLS context is
        // settling. Never replace a known-good local/cloud snapshot with an
        // empty array; that is what made materials disappear after email auth.
        const previousMaterials = Array.isArray(match.cloudMaterials) ? match.cloudMaterials : [];
        match.cloudMaterials = flattenedMaterials.length ? flattenedMaterials : previousMaterials;
        match.hasMaterial = match.cloudMaterials.length > 0 || match.hasMaterial === true;
      } else {
        COURSES.push({
          id: (dbC.code || dbC.id).toLowerCase().replace(/[^a-z0-9]/g, ''),
          dbId: dbC.id,
          code: dbC.code,
          name: dbC.name,
          instructor: dbC.instructor || 'Instructor',
          hasMaterial: flattenedMaterials.length > 0,
          accent: dbC.color || '#8B7CF6',
          schedule: [],
          syllabus: [],
          lectures: [],
          worksheets: [],
          modules: modulesByCourse.get(dbC.id) || [],
          cloudMaterials: flattenedMaterials
        });
      }
    });

    const seen = new Set();
    COURSES = COURSES.filter(course => {
      const key = cleanCourseCode(course.code) || cleanCourseCode(course.id);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Course rows may arrive from Supabase after the static outline seed.
    // Reconcile again so newly hydrated course objects contribute deadlines.
    deadlinesManager.syncCourseOutlineDeadlines(COURSES);
    // Hydration succeeded. Cache the last known-good material snapshot so an
    // email-link redirect, temporary RLS/session gap, or signed-out reload can
    // continue showing the user's latest course library immediately.
    persistCourseMaterials();
    // Clear any previous failure so the course view never keeps showing a
    // stale "materials could not be loaded" banner.
    state.materialsSyncError = null;
    state.materialsHydrated = true;
    // v1.5.2 ROOT-CAUSE FIX (false "No document files uploaded"): the user can
    // open Course → Materials BEFORE this background sync finishes (slow
    // network, cold start). The panel rendered at that moment shows the empty
    // state, and until now nothing repainted it when hydration completed —
    // the materials existed in the cloud but the screen never updated. If the
    // user is currently looking at a Materials tab, repaint it now.
    if (state.view === 'courses' && state.courseTab === 'materials') {
      render();
    }
    return true;
  } catch (err) {
    console.error('Failed to sync courses/materials from Supabase:', err);
    // Surface the failure instead of silently rendering an empty library:
    // the course Materials tab distinguishes "no materials exist" from
    // "loading failed" through this flag.
    state.materialsSyncError = err?.message
      ? `Cloud error: ${err.message}`
      : 'Could not reach Supabase. Check your connection and try again.';
    // Same repaint contract as the success path: a Materials tab that is
    // already on screen must show the failure, not keep a stale empty state.
    if (state.view === 'courses' && state.courseTab === 'materials') {
      render();
    }
    return false;
  }
}

/** Public hydration entry point with self-healing. If the sync failed with an
 * auth/config error (rotated Supabase key saved in localStorage, expired or
 * malformed JWT, 401 from PostgREST), reset the client and stored cloud
 * session state once and try again — instead of leaving the app stuck until
 * the user manually clears site data. Also repaints after success so a
 * course that is already open updates in place. */
let syncHealAttempted = false;
let stallRetryAttempted = false;
export async function syncDataFromSupabase() {
  const ok = await runSupabaseCourseSync();
  if (ok) { syncHealAttempted = false; stallRetryAttempted = false; return true; }
  // v1.5.4: a STALLED request (timeout guard fired) gets ONE automatic retry
  // after a short pause. Stalls are usually transient on the user's side
  // (proxy/AV/DNS hiccup); a fresh attempt on new sockets commonly succeeds
  // and turns the error state into actual materials without user action.
  if (!stallRetryAttempted && /stalled with no response/i.test(state.materialsSyncError || '')) {
    stallRetryAttempted = true;
    console.warn('[stall-guard] sync request stalled; retrying once in 4s on fresh connections…');
    await new Promise(r => setTimeout(r, 4000));
    const retried = await runSupabaseCourseSync();
    if (retried) { syncHealAttempted = false; stallRetryAttempted = false; return true; }
    console.warn('[stall-guard] retry still failing; leaving explicit error state visible.');
    return false;
  }
  // Heal when the failure is an auth/config error OR the device is running a
  // saved connection override that differs from the deployed origin config
  // (wrong/dead project signature: queries fail or return [] with no
  // auth-style error). The heal purges saved overrides and rebuilds the
  // client from the deployed meta tags — exactly the repair a stale
  // sc_supabase_url needs. The mismatch check is purely local, so it cannot
  // misfire on transient network failures.
  const wrongProject = !ok && (hasConfigOverrideMismatch() || /returned no courses/.test(state.materialsSyncError || ''));
  if (!isAuthError(state.materialsSyncError) && !wrongProject) {
    return false;
  }
  if (syncHealAttempted) {
    console.warn('Materials sync still failing after self-heal attempt; not retrying again this session.');
    return false;
  }
  syncHealAttempted = true;
  console.warn('Supabase auth error detected during materials sync — self-healing cloud configuration and retrying once.');
  await resetSupabaseAuthState({ purgeStoredConfig: true });
  const healed = await runSupabaseCourseSync();
  console.warn(`[self-heal] retry after config reset: ${healed ? 'SUCCESS' : 'still failing'}`);
  if (healed) {
    state.materialsSyncError = null;
    render();
  }
  return healed;
}

/* =========================================================================
   UI RENDERING — MAIN SHELL
   ========================================================================= */
function render() {
  const app = document.getElementById('app');
  if (!app) {
    console.error('Mounting target #app was not found in DOM.');
    return;
  }

  try {
    if (focusModeInstance && focusModeInstance.isActive) {
      app.innerHTML = renderFocusOverlay();
      attachFocusHandlers();
      return;
    }

    let viewHtml = '';
    try {
      if (state.view === 'today') {
        viewHtml = renderTodayView();
      } else if (state.view === 'calendar') {
        viewHtml = renderCalendarView();
      } else if (state.view === 'courses') {
        viewHtml = state.courseId ? renderCourseDetailView(courseById(state.courseId)) : renderCoursesHubView();
      } else if (state.view === 'ai') {
        viewHtml = renderUnifiedAiView();
      } else if (state.view === 'settings') {
        viewHtml = renderSettingsView();
      } else {
        viewHtml = renderTodayView();
      }
    } catch (viewErr) {
      console.error(`Error rendering active view "${state.view}":`, viewErr);
      viewHtml = `
        <div class="panel" style="padding:24px;text-align:center;">
          <h3 style="margin-bottom:8px;">View Display Notice</h3>
          <p style="color:var(--muted);font-size:0.88rem;">${viewErr.message || 'Error generating view content'}</p>
          <button class="btn-primary" id="fallback-reset-view-btn" style="margin-top:12px;">Reset to Today</button>
        </div>
      `;
    }

    app.innerHTML = `
      ${renderHeader()}
      <main class="enter">${viewHtml}</main>
      ${renderBottomNav()}
      ${renderJobsDrawer()}
      ${renderAssignmentModal()}
      ${renderNoteModal()}
      ${renderAssignmentDetailModal()}
      ${renderSyncDrawer()}
    `;

    try {
      attachEventHandlers();
    } catch (evtErr) {
      console.warn('Non-critical event handler warning:', evtErr);
    }

    try {
      renderMath();
    } catch (mathErr) {
      console.warn('KaTeX rendering note:', mathErr);
    }
  } catch (fatalRenderErr) {
    console.error('Fatal render error:', fatalRenderErr);
    app.innerHTML = `
      <div class="panel" style="padding:32px 20px;text-align:center;">
        <h2 style="margin-bottom:8px;">School Center</h2>
        <p style="color:var(--muted);font-size:0.9rem;">The interface encountered an unexpected state. Click below to reload.</p>
        <button class="btn-primary" onclick="localStorage.clear();location.reload();" style="margin-top:14px;">Reset Storage & Reload</button>
      </div>
    `;
  }
}

let mathRenderRetries = 0;
function renderMath() {
  if (typeof window.renderMathInElement !== 'function') {
    // KaTeX is loaded with defer; on slower mobile browsers the first render
    // can happen before auto-render.js has installed its global. Retry after
    // the deferred scripts and also after the window load event.
    if (mathRenderRetries < 20) {
      mathRenderRetries += 1;
      setTimeout(renderMath, 100);
    }
    return;
  }
  mathRenderRetries = 0;
  try {
    window.renderMathInElement(document.body, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\(', right: '\\)', display: false },
        { left: '$', right: '$', display: false }
      ],
      throwOnError: false,
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
    });
  } catch (error) {
    console.warn('Math rendering skipped:', error?.message || error);
  }
}
window.addEventListener('load', renderMath, { once: true });

/* =========================================================================
   HEADER & DYNAMIC ISLAND PILL
   ========================================================================= */
export const PORTFOLIO_URL = 'https://abdullahmassraf.github.io/Portfolio/';

/* v1.3.0: the old banner was a full-width glass slab with a wordmark and a
   run-on subtitle ("Abdullah Massraf · Fall 2026 · Mechanical Eng"). The
   subtitle was static information the only user of this app already knows,
   and it pushed every screen's real content ~96px down. This is a single
   hairline row: wordmark left, term chip + portfolio link right. Styling
   lives under "APP BAR" in src/style.css. */
/** Official app logo mark (inline SVG: crisp at any size, keeps the coin
 * look in header badge, favicon, and print). Keep in sync with assets/logo.svg. */
function renderLogoMark() {
  return `<svg viewBox="0 0 100 100" class="sc-logo-svg" focusable="false" aria-hidden="true">
    <circle cx="50" cy="50" r="49" fill="#05060E"/>
    <g fill="none" stroke="#F4F6FD" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.4"/>
      <path d="M63 30 C45 20 28 26 32 39 C35 49 52 48 58 57 C64 67 52 76 38 73" stroke-width="8"/>
      <path d="M63 30 C45 20 28 26 32 39 C35 49 52 48 58 57 C64 67 52 76 38 73" stroke="#0B0F2E" stroke-width="3"/>
      <path d="M35 76 L64 27" stroke-width="2.6"/>
      <path d="M64 27 l-9 -1.5 M64 27 l-3.5 8.5" stroke-width="2.4"/>
      <path d="M36 73 l6 5" stroke-width="2.2"/>
      <circle cx="66.5" cy="24.5" r="3" stroke-width="2.2"/>
      <circle cx="57" cy="31" r="2" fill="#F4F6FD" stroke="none"/>
      <circle cx="63" cy="38" r="2.4" fill="#F4F6FD" stroke="none"/>
      <circle cx="52" cy="27" r="1.8" fill="#F4F6FD" stroke="none"/>
      <circle cx="45" cy="66" r="2" fill="#F4F6FD" stroke="none"/>
      <circle cx="50" cy="71.5" r="2.4" fill="#F4F6FD" stroke="none"/>
    </g>
  </svg>`;
}

function renderHeader() {
  return `
    <header class="app-header">
      <div class="app-brand">
        <span class="app-brand-mark" aria-hidden="true">${renderLogoMark()}</span>
        <h1 class="app-brand-name headfont">School Center</h1>
      </div>
      <div class="app-bar-right">
        <span class="app-term">Fall 2026</span>
        <a class="app-portfolio-link" href="${PORTFOLIO_URL}" target="_blank" rel="noopener noreferrer" title="Abdullah Massraf — Portfolio">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>
          <span>Portfolio</span>
        </a>
      </div>
    </header>`;
}

/* =========================================================================
   BOTTOM NAVIGATION BAR & FAB
   ========================================================================= */
function renderBottomNav() {
  const tabs = [
    { id: 'today', icon: 'home', label: 'Today' },
    { id: 'calendar', icon: 'calendar', label: 'Calendar' },
    { id: 'courses', icon: 'book', label: 'Courses' },
    { id: 'ai', icon: 'spark', label: 'AI & Search', navLabel: 'AI' },
    { id: 'settings', icon: 'settings', label: 'Settings' }
  ];
  // Labels are rendered on every size and hidden by CSS on desktop (where the
  // nav collapses to an icon-only floating pill). On mobile, icon-only nav
  // items were the main complaint — a 5-way icon row with no text is a guess.
  return `<div class="nav-hover-zone" aria-hidden="true"></div><nav class="bottom-nav-wrap" aria-label="Primary navigation"><div class="bottom-nav">${tabs.map(t => `<button class="nav-item ${state.view===t.id?'active':''}" data-nav="${t.id}" type="button" aria-label="${t.label}" title="${t.label}">${icon(t.icon)}<span class="nav-label">${escapeHtml(t.navLabel || t.label)}</span></button>`).join('')}</div></nav>`;
}

/* =========================================================================
   VIEW 1: TODAY (Home Screen)
   ========================================================================= */
function renderSyncBanner() {
  if (state.syncBannerDismissed) return '';
  if (!isSupabaseConfigured()) return '';
  if (state.aiCloudUser) return '';
  const hasLocalData = notesManager.getAll().length > 0 || assignmentsManager.getAll().length > 0;
  if (!hasLocalData) return '';
  return `
    <div class="sync-banner" id="sync-signin-banner">
      <div class="sync-banner-icon">⚠️</div>
      <div class="sync-banner-text"><b>Not signed in.</b> Notes and assignments are only saved on this device and won't appear on your other devices until you sign in.</div>
      <div class="sync-banner-actions">
        <button class="btn-primary" id="sync-banner-signin-btn" type="button">Sign in</button>
        <button class="btn-ghost" id="sync-banner-dismiss-btn" type="button">Dismiss</button>
      </div>
    </div>`;
}

function renderTodayView() {
  const today = new Date();
  const dateStr = today.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const allAssignments = assignmentsManager.getAll().filter(a => a.status !== 'completed' && a.status !== 'graded');
  const urgentAsg = allAssignments.slice(0, 3);
  const activeJobs = jobsManager.getActiveJobsCount();

  // Find classes today from authoritative timetable
  const todayClasses = getClassesForDate(today);
  const nextClass = todayClasses[0] || null;

  return `
    ${renderSyncBanner()}
    <!-- Top Situation Greeting -->
    <div class="panel" style="padding:18px 20px;">
      <div style="font-size:0.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">${dateStr}</div>
      <h2 style="font-size:1.4rem;margin:4px 0 10px;">Good day, Abdullah</h2>
      <p style="margin:0;font-size:0.9rem;color:var(--ink);">
        ${nextClass 
          ? `Next session: <b>${nextClass.course.code}</b> (${nextClass.schedule.type}) at ${nextClass.schedule.start} · Room ${nextClass.schedule.room || 'Online'}${nextClass.schedule.instructor ? ' · ' + nextClass.schedule.instructor : ''}`
          : `No scheduled campus lectures today. Great day to tackle coursework and practice.`}
      </p>
      ${nextClass ? renderShowLocationButton(nextClass.schedule.room, 'margin-top:10px;') : ''}
    </div>

    <!-- Urgent Deadlines -->
    <div class="panel">
      <h2><span>Upcoming Assignments (${allAssignments.length})</span><span style="font-size:0.8rem;color:var(--accent);cursor:pointer;" id="see-all-asg">View all</span></h2>
      ${urgentAsg.length ? `
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${urgentAsg.map(a => {
            const course = courseById(a.courseId);
            return `
              <div class="assignment-card" data-asg-id="${a.id}" style="margin:0;cursor:pointer;">
                <div class="assignment-head">
                  <div>
                    <span style="font-size:0.75rem;color:${course?course.accent:'var(--accent)'};font-weight:700;">${course ? course.code : a.courseId.toUpperCase()}</span>
                    <div class="assignment-title">${a.title}</div>
                    <div style="font-size:0.75rem;color:var(--muted);">Due ${new Date(a.dueDate).toLocaleDateString()}</div>
                  </div>
                  <span class="badge badge-${a.status}">${a.status.replace('_', ' ')}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : `<div style="color:var(--muted-dim);font-size:0.88rem;padding:8px 0;">No pending assignments due this week.</div>`}
    </div>

    ${renderCampusMapWidget()}
  `;
}

/* =========================================================================
   VIEW 2: CALENDAR (Mobile Date Strip & Agenda)
   ========================================================================= */
function renderCalendarView() {
  const today = new Date();
  const selectedDate = new Date(state.selectedCalendarDay);
  const currentMonthYear = selectedDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const monthTitle = `${['January','February','March','April','May','June','July','August','September','October','November','December'][state.monthCalendarMonth]} ${state.monthCalendarYear}`;
  
  // Generate 14-day horizontal strip (7 past, 7 future)
  const days = [];
  for (let i = -3; i <= 10; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }

  const stripHtml = days.map(d => {
    const key = d.toDateString();
    const isToday = key === today.toDateString();
    const isSelected = key === state.selectedCalendarDay;
    const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
    const hasClasses = getClassesForDate(d).length > 0;
    const hasAsg = assignmentsManager.getAll().some(a => new Date(a.dueDate).toDateString() === key);
    const hasDeadline = deadlinesManager.getAll().some(item => item.status !== 'done' && new Date(item.dueAt).toDateString() === key);

    return `
      <div class="date-strip-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-daykey="${key}">
        <span class="dow">${dow}</span>
        <span class="num">${d.getDate()}</span>
        <div class="month-cell-dots" style="position:static;margin-top:2px;">
          ${hasClasses ? '<span class="cell-dot class-dot"></span>' : ''}
          ${hasAsg ? '<span class="cell-dot asg-dot"></span>' : ''}
        </div>
      </div>
    `;
  }).join('');

  // Find assignments and classes for the selected day via pure timetable resolver
  const dayClasses = getClassesForDate(selectedDate);

  const dayAssignments = assignmentsManager.getAll().filter(a => {
    return new Date(a.dueDate).toDateString() === state.selectedCalendarDay;
  });
  const dayDeadlines = getDeadlinesForDate(selectedDate);
  const upcomingDeadlines = deadlinesManager.getAll()
    .filter(item => item.status !== 'done')
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))
    .slice(0, 8);

  const calendarSelectedDateStr = selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  // Inline month grid — same cell design as the weekly strip, just more days.
  let monthCellsHtml = '';
  if (state.calendarViewMode === 'month') {
    const mYear = state.monthCalendarYear;
    const mMonth = state.monthCalendarMonth;
    const firstDow = new Date(mYear, mMonth, 1).getDay();
    const daysInMonth = new Date(mYear, mMonth + 1, 0).getDate();
    const daysInPrev = new Date(mYear, mMonth, 0).getDate();
    const cells = [];
    for (let i = firstDow - 1; i >= 0; i--) cells.push({ n: daysInPrev - i, d: new Date(mYear, mMonth - 1, daysInPrev - i, 12), adj: true });
    for (let d = 1; d <= daysInMonth; d++) cells.push({ n: d, d: new Date(mYear, mMonth, d, 12), adj: false });
    const trail = 7 - (cells.length % 7);
    if (trail < 7) for (let d = 1; d <= trail; d++) cells.push({ n: d, d: new Date(mYear, mMonth + 1, d, 12), adj: true });
    const todayKey = new Date().toDateString();
    monthCellsHtml = cells.map(c => {
      const key = c.d.toDateString();
      const hasDl = deadlinesManager.getAll().some(item => item.status !== 'done' && new Date(item.dueAt).toDateString() === key);
      const hasAsg = assignmentsManager.getAll().some(a => new Date(a.dueDate).toDateString() === key);
      const hasCls = getClassesForDate(c.d).length > 0;
      return `
        <div class="date-strip-cell cal-month-cell ${c.adj ? 'adjacent' : ''} ${key === todayKey ? 'today' : ''} ${key === state.selectedCalendarDay ? 'selected' : ''}" data-cal-day="${key}">
          <span class="dow">${['S','M','T','W','T','F','S'][c.d.getDay()]}</span>
          <span class="num">${c.n}</span>
          <div class="month-cell-dots">
            ${hasCls ? '<span class="cell-dot class-dot"></span>' : ''}
            ${hasAsg ? '<span class="cell-dot asg-dot"></span>' : ''}
            ${hasDl ? '<span class="cell-dot deadline-dot"></span>' : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  return `
    <div class="panel" style="padding:16px 14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:0 4px;gap:8px;flex-wrap:wrap;">
        <h2 style="margin:0;font-size:1.15rem;">${state.calendarViewMode === 'month' ? monthTitle : currentMonthYear}</h2>
        <div style="display:flex;gap:6px;align-items:center;">
          ${state.calendarViewMode === 'month' ? `
            <button class="btn-ghost" id="month-cal-prev" type="button" style="min-height:30px;font-size:0.75rem;padding:0 10px;">←</button>
            <button class="btn-ghost" id="month-cal-today" type="button" style="min-height:30px;font-size:0.75rem;padding:0 10px;">Today</button>
            <button class="btn-ghost" id="month-cal-next" type="button" style="min-height:30px;font-size:0.75rem;padding:0 10px;">→</button>
          ` : ''}
          <button class="btn-primary" id="cal-view-toggle-btn" type="button" style="min-height:30px;font-size:0.75rem;padding:0 12px;">${state.calendarViewMode === 'week' ? 'Month View' : 'Week View'}</button>
        </div>
      </div>

      ${state.calendarViewMode === 'week'
        ? `<div class="date-strip">${stripHtml}</div>`
        : `<div class="month-grid-weekdays"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>
      <div class="month-grid-cells">${monthCellsHtml}</div>`}

      <div class="dim-divider" style="display:flex;justify-content:space-between;align-items:center;margin:12px 0;">
        <span style="font-weight:600;font-size:0.88rem;">${calendarSelectedDateStr}</span>
        <button class="btn-primary" id="add-deadline-btn" style="min-height:30px;font-size:0.75rem;padding:0 12px;">+ Add Deadline</button>
      </div>

      <div class="agenda-list">
        ${dayClasses.map(c => `
          <div class="agenda-item" style="--item-color:${c.course.accent};cursor:pointer;" data-agenda-course-id="${c.course.id}">
            <div class="agenda-time">${c.schedule.start}${c.schedule.end ? '<br><span style="color:var(--muted-dim);font-size:0.7rem;">' + c.schedule.end + '</span>' : ''}</div>
            <div class="agenda-main">
              <div class="agenda-course">${c.course.code}</div>
              <div class="agenda-title">${c.course.name} · ${c.schedule.type}</div>
              <div style="font-size:0.75rem;color:var(--muted);margin-top:2px;">Room ${c.schedule.room || 'Campus'}${c.schedule.instructor ? ' · ' + c.schedule.instructor : ''}</div>
              ${renderShowLocationButton(c.schedule.room, 'margin-top:6px;')}
            </div>
          </div>
        `).join('')}

        ${dayAssignments.map(a => {
          const course = courseById(a.courseId);
          return `
            <div class="agenda-item" style="--item-color:${course?course.accent:'var(--accent-3)'};cursor:pointer;" data-agenda-asg-id="${a.id}">
              <div class="agenda-time">Due Date</div>
              <div class="agenda-main">
                <div class="agenda-course">${course?course.code:a.courseId.toUpperCase()}</div>
                <div class="agenda-title">📋 ${a.title}</div>
              </div>
            </div>
          `;
        }).join('')}

        ${renderDeadlineAgendaItems(dayDeadlines)}

        ${!dayClasses.length && !dayAssignments.length && !dayDeadlines.length ? `
          <div style="color:var(--muted-dim);text-align:center;padding:24px 10px;font-size:0.88rem;">
            No campus lectures or assignment deadlines on this date.
          </div>
        ` : ''}
      </div>
    </div>

    <div class="panel" style="padding:16px 14px;">
      <h2 style="margin:0 0 4px;font-size:1rem;">Upcoming Deadlines</h2>
      <div style="font-size:0.75rem;color:var(--muted);margin:0 0 12px;">Assessments and due dates extracted from course outlines &middot; past due dates are removed automatically</div>
      ${upcomingDeadlines.length ? upcomingDeadlines.map(item => {
        const dCourse = courseById(item.courseId);
        return `
          <div class="surface-content" style="padding:12px 14px;display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px;">
            <div>
              <div style="font-weight:600;font-size:0.9rem;">${escapeHtml(item.title)}</div>
              <div style="font-size:0.75rem;color:var(--muted);margin-top:2px;">${dCourse ? dCourse.code : escapeHtml(item.courseCode || 'General')} &middot; ${escapeHtml(item.type)}${item.weight ? ` &middot; ${item.weight}%` : ''} &middot; due ${new Date(item.dueAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
            </div>
            <button class="btn-ghost" data-deadline-done="${escapeHtml(item.id)}" type="button" style="min-height:0;">Done</button>
          </div>
        `;
      }).join('') : `
        <div style="text-align:center;padding:20px 10px;color:var(--muted-dim);border:1px dashed var(--hairline);border-radius:var(--radius-md);font-size:0.86rem;">
          No upcoming deadlines &mdash; dated assessments from course outlines will appear here.
        </div>
      `}
    </div>
  `;
}

/* =========================================================================
   VIEW 3: COURSES HUB
   ========================================================================= */
function renderCoursesHubView() {
  const cards = COURSES.map(c => {
    const asgCount = assignmentsManager.getByCourse(c.id).length;
    const notesCount = notesManager.getByCourse(c.id).length;
    const matsCount = (c.cloudMaterials || []).length;

    return `
      <div class="course-card" data-course-id="${c.id}" style="--card-color:${c.accent}">
        <div class="code">${c.code}</div>
        <div class="name">${c.name}</div>
        <div class="instr">${c.instructor && c.instructor !== '—' ? c.instructor : 'Slate Online / Async'}</div>
        <div class="course-card-footer">
          <span style="color:${c.accent};font-weight:600;">${matsCount} Docs · ${asgCount} Tasks</span>
          <span class="icon-inline" style="color:var(--muted);">${icon('chevronRight')}</span>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;">
      <h2 style="margin:0;font-size:1.3rem;">Courses & Syllabi</h2>
      <div style="font-size:0.82rem;color:var(--muted);">${COURSES.length} Enrolled</div>
    </div>
    <div class="course-grid">${cards}</div>
  `;
}

/* =========================================================================
   VIEW 3B: COURSE DETAIL (5 Clean Tabs)
   ========================================================================= */
function renderCourseDetailView(c) {
  if (!c) return renderCoursesHubView();

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'materials', label: 'Materials' },
    { id: 'assignments', label: 'Assignments' },
    { id: 'deadlines', label: 'Deadlines' },
    { id: 'notes', label: 'Notes' }
  ];

  let bodyHtml = '';

  if (state.courseTab === 'overview') {
    const courseAsgs = assignmentsManager.getByCourse(c.id);
    const mats = c.cloudMaterials || [];
    bodyHtml = `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div class="surface-content" style="padding:16px;">
          <div style="font-size:0.8rem;color:var(--muted);text-transform:uppercase;font-weight:600;">Instructor & Classroom</div>
          <div style="font-size:1.05rem;font-weight:600;margin-top:2px;">${c.instructor || 'Instructor'}</div>
          ${(c.schedule || []).map(s => `<div style="font-size:0.85rem;color:var(--muted);margin-top:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span>• ${s.day} ${s.start}–${s.end} (${s.type}) · Room ${s.room || 'C328'}</span>${renderShowLocationButton(s.room, 'padding:2px 8px;font-size:0.72rem;min-height:0;')}</div>`).join('')}
        </div>

        ${c.evaluation ? `
          <div class="surface-content" style="padding:16px;">
            <div style="font-size:0.8rem;color:var(--muted);text-transform:uppercase;font-weight:600;margin-bottom:8px;">Grading Weight</div>
            ${c.evaluation.map(([k, v]) => `
              <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.88rem;border-bottom:1px solid var(--hairline);">
                <span>${k}</span><b style="color:${c.accent}">${v}</b>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  } else if (state.courseTab === 'materials') {
    const routed = routeCourseContent(c);
    const mats = routed.materials;
    // v1.5.2 honest-state contract: the empty-state message is ONLY shown
    // when hydration has completed AND no cloud/infra error is active.
    // Otherwise the user sees "Loading…" (hydration still in flight) or the
    // explicit failure banner — never a false "No document files uploaded".
    if (!mats.length && !state.materialsSyncError && !state.materialsHydrated) {
      bodyHtml = `
        <div style="text-align:center;padding:36px 14px;color:var(--muted);">
          <p style="font-weight:600;">Loading course materials…</p>
          <p style="font-size:0.82rem;margin-top:4px;">Checking the cloud library for ${escapeHtml(c.code)}.</p>
        </div>
      `;
    } else if (!mats.length && state.materialsSyncError) {
      bodyHtml = `
      <div style="text-align:center;padding:36px 14px;color:var(--muted-dim);">
        <p style="color:var(--accent-3);font-weight:600;">Course materials could not be loaded.</p>
        <p style="font-size:0.82rem;margin-top:4px;">${escapeHtml(state.materialsSyncError)}</p>
        ${isAuthError(state.materialsSyncError) ? '<p style="font-size:0.78rem;margin-top:4px;color:var(--muted);">This looks like a saved cloud-credential problem on this device. Use “Fix cloud connection” below to repair it automatically.</p>' : ''}
        <div style="display:flex;gap:10px;justify-content:center;margin-top:8px;flex-wrap:wrap;">
          <button class="btn-ghost" id="retry-materials-btn">Retry loading materials</button>
          ${state.materialsSyncError && isAuthError(state.materialsSyncError) ? '<button class="btn-ghost" id="reset-cloud-config-btn">Fix cloud connection</button>' : ''}
        </div>
      </div>
    `;
    } else if (!mats.length) {
      // Genuinely empty: hydration completed, no error, zero materials.
      // This is the ONLY path allowed to say the course has no files.
      bodyHtml = `
      <div style="text-align:center;padding:36px 14px;color:var(--muted-dim);">
        <p>No document files uploaded for ${escapeHtml(c.code)} yet.</p>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:8px;flex-wrap:wrap;">
          <button class="btn-primary" id="trigger-upload-modal">Upload Course Material</button>
          <button class="btn-ghost" id="retry-materials-btn">Retry loading materials</button>
        </div>
      </div>
    `;
    } else {
      bodyHtml = `
      <div class="course-materials-stack">
        <div class="section-sub" style="margin-bottom:2px;">${mats.length} material${mats.length === 1 ? '' : 's'} available in the course cloud.</div>
        <div style="display:flex;flex-direction:column;gap:14px;">
        ${mats.map(m => {
          const json = m.content_json || {};
          const questions = json.practice_questions || [];
          const concepts = json.key_concepts || [];
          return `
            <div class="lecture-block" style="background:rgba(255,255,255,0.03);padding:16px;border-radius:var(--radius-md);">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                <div>
                  <h3 style="margin:0 0 4px;font-size:1.05rem;">${m.title}</h3>
                  <div style="font-size:0.75rem;color:var(--muted);">${m.moduleTitle || 'Materials'} · ${m.type}</div>
                </div>
                ${m.file_url ? `
                  <a href="${m.file_url}" target="_blank" rel="noopener noreferrer" class="icon-btn sm" title="Download Document" style="text-decoration:none;">
                    ${icon('download')}
                  </a>
                ` : ''}
              </div>

              ${json.summary ? `
                <div style="background:rgba(255,255,255,0.04);border-left:3px solid ${c.accent};padding:10px 12px;border-radius:4px;margin:10px 0;font-size:0.88rem;">
                  <b>AI Summary:</b> ${json.summary}
                </div>
              ` : ''}

              ${concepts.length ? `
                <div style="margin-top:10px;">
                  <div style="font-size:0.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:6px;">Key Concepts</div>
                  <ul class="concept-list">
                    ${concepts.map(con => `<li>${con}</li>`).join('')}
                  </ul>
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
        </div>
      </div>
    `;
    }
  } else if (state.courseTab === 'assignments') {
    const courseAsgs = assignmentsManager.getByCourse(c.id);
    const routed = routeCourseContent(c);
    const assignmentFolders = routed.assignmentFolders || [];
    bodyHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-size:0.9rem;font-weight:600;">Assignments & Reports</span>
        <button class="btn-primary" id="add-assignment-btn" style="min-height:36px;font-size:0.8rem;padding:0 14px;">+ New Task</button>
      </div>
      ${assignmentFolders.map(folder => `
        <div class="assignment-folder-card">
          <div class="assignment-folder-head">
            <div>
              <div class="assignment-folder-kicker">Assignment Folder</div>
              <h3>${folder.folderName}</h3>
            </div>
            <span class="badge">${folder.items.length} files</span>
          </div>
          <div class="assignment-folder-items">
            ${folder.items.map(item => `
              <div class="assignment-folder-item">
                <div class="assignment-file-icon">${icon('doc')}</div>
                <div class="assignment-file-meta">
                  <div class="assignment-file-title">${item.title}</div>
                  <div class="assignment-file-sub">${item.material?.type || item.type}${item.material?.moduleTitle ? ` · ${item.material.moduleTitle}` : ''}</div>
                </div>
                ${item.material?.file_url ? `<a class="icon-btn sm" href="${item.material.file_url}" target="_blank" rel="noopener noreferrer" aria-label="Open ${item.title}" title="Open document">${icon('download')}</a>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
      ${courseAsgs.length ? `
        <div style="display:flex;flex-direction:column;gap:12px;">
          ${courseAsgs.map(a => `
            <div class="assignment-card" style="cursor:pointer;" data-open-asg-id="${a.id}">
              <div class="assignment-head">
                <div>
                  <div class="assignment-title">${a.title}</div>
                  <div style="font-size:0.78rem;color:var(--muted);">Due: ${new Date(a.dueDate).toLocaleDateString()}</div>
                </div>
                <span class="badge badge-${a.status}">${a.status.replace('_', ' ')}</span>
              </div>
              ${a.description ? `<div style="font-size:0.85rem;color:var(--ink);margin:8px 0;">${a.description}</div>` : ''}
              ${a.requirementsChecklist && a.requirementsChecklist.length ? `
                <ul class="assignment-checklist">
                  ${a.requirementsChecklist.map(ch => `
                    <li class="checklist-item ${ch.done ? 'done' : ''}" data-asg-check="${a.id}" data-check-id="${ch.id}">
                      <input type="checkbox" ${ch.done ? 'checked' : ''} style="cursor:pointer;">
                      <span>${ch.text}</span>
                    </li>
                  `).join('')}
                </ul>
              ` : ''}
            </div>
          `).join('')}
        </div>
      ` : `
        <div style="text-align:center;padding:32px 14px;color:var(--muted-dim);border:1px dashed var(--hairline);border-radius:var(--radius-md);">
          No assignments recorded yet for this course.
        </div>
      `}
    `;
  } else if (state.courseTab === 'deadlines') {
    const courseDeadlines = deadlinesManager.getByCourse(c.id)
      .filter(d => d.status !== 'done')
      .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
    bodyHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-size:0.9rem;font-weight:600;">Assessments &amp; Due Dates</span>
        <span style="font-size:0.72rem;color:var(--muted);">From the course outline &middot; past dates auto-removed</span>
      </div>
      ${courseDeadlines.length ? courseDeadlines.map(d => `
        <div class="surface-content" style="padding:14px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px;">
          <div>
            <div style="font-weight:600;">${escapeHtml(d.title)}</div>
            <div style="font-size:0.78rem;color:var(--muted);margin-top:2px;">${escapeHtml(d.type)}${d.weight ? ` &middot; ${d.weight}% of final grade` : ''} &middot; due ${new Date(d.dueAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
          </div>
          <button class="btn-ghost" data-deadline-done="${escapeHtml(d.id)}" type="button" style="min-height:0;">Done</button>
        </div>
      `).join('') : `
        <div style="text-align:center;padding:28px 14px;color:var(--muted-dim);border:1px dashed var(--hairline);border-radius:var(--radius-md);">
          No dated assessments found in this course outline yet.
        </div>
      `}
    `;
  } else if (state.courseTab === 'notes') {
    const courseNotes = notesManager.getByCourse(c.id);
    bodyHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-size:0.9rem;font-weight:600;">Course Notes & Transcripts</span>
        <button class="btn-primary" id="add-course-note-btn" style="min-height:36px;font-size:0.8rem;padding:0 14px;">+ Note</button>
      </div>
      ${courseNotes.length ? `
        <div style="display:flex;flex-direction:column;gap:12px;">
          ${courseNotes.map(n => `
            <div class="surface-content" style="padding:16px;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <h3 style="margin:0 0 4px;font-size:1rem;">${n.title}</h3>
                <div style="display:flex;align-items:center;gap:8px;">
                  <span style="font-size:0.72rem;color:var(--muted);">${new Date(n.updatedAt).toLocaleDateString()}</span>
                  <button class="icon-btn sm note-delete-btn" data-delete-note="${n.id}" type="button" aria-label="Delete note" title="Delete note">${icon('trash')}</button>
                </div>
              </div>
              <div style="font-size:0.88rem;line-height:1.6;margin:8px 0;white-space:pre-wrap;">${n.content}</div>
            </div>
          `).join('')}
        </div>
      ` : `
        <div style="text-align:center;padding:32px 14px;color:var(--muted-dim);border:1px dashed var(--hairline);border-radius:var(--radius-md);">
          No tutor notes yet for this course.
        </div>
      `}
    `;
  }

  return `
    <div style="--course-accent:${c.accent}">
      <div class="course-topbar">
        <div class="backlink" id="course-back-btn">${icon('arrowLeft')} All Courses</div>
      </div>
      <div class="course-header">
        <h2 class="headfont">${c.code} — ${c.name}</h2>
        <div class="meta">${c.instructor || 'Instructor'}</div>
      </div>
      <div class="course-tabs">
        ${tabs.map(t => `
          <div class="course-tab ${state.courseTab === t.id ? 'active' : ''}" data-course-tab="${t.id}">
            ${t.label}
          </div>
        `).join('')}
      </div>
      <div class="panel">${bodyHtml}</div>
    </div>
  `;
}

async function ingestAiAttachments(files = [], userInstruction = '') {
  if (!files.length) return;

  // Make sure every static course has its current Supabase id before filing.
  await syncDataFromSupabase();

  const instruction = String(userInstruction || '');
  const looksLikeAssignment = (name) =>
    /(assignment|submission|submitted|homework|lab.?report|project|worksheet|tutorial|quiz|midterm|final|report)/i.test(name) ||
    /(assignment|submission|submitted|homework|lab report|project|worksheet|tutorial|quiz|midterm|final report)/i.test(instruction);

  for (const file of files) {
    try {
      const detection = detectCourseFromContent(file.name || '', instruction, COURSES);
      const course = courseById(detection.courseId);
      if (!course) {
        showToast(`I couldn't identify a course for ${file.name}. The file was left in the AI conversation.`);
        continue;
      }

      if (!course.dbId) {
        await syncDataFromSupabase();
      }
      const readyCourse = courseById(course.id);
      if (!readyCourse?.dbId) {
        showToast(`Couldn't connect ${file.name} to ${course.code}.`);
        continue;
      }

      showToast(`Filing ${file.name} → ${course.code}…`);
      const material = await uploadAndProcessFile({
        file,
        course: readyCourse,
        onProgress: progress => {
          if (progress?.status === 'completed') showToast(`${file.name} added to ${course.code} ✓`);
        },
        onLog: () => {}
      });

      // Assignment-like uploads are also registered in the course's
      // assignment workspace so the file is not stranded in Materials.
      if (looksLikeAssignment(file.name || '')) {
        assignmentsManager.createAssignment({
          title: (file.name || 'Uploaded assignment').replace(/\\.[^/.]+$/, '').replace(/[-_]/g, ' '),
          courseId: readyCourse.id,
          description: instruction || `Imported from AI upload: ${file.name}`,
          status: 'not_started',
          assignmentType: /lab.?report|report/i.test(file.name) ? 'report' : 'homework',
          sourceFiles: [{
            id: material?.id || `file_${Date.now()}`,
            name: file.name,
            type: file.type || 'file',
            url: material?.file_url || '',
            materialId: material?.id || null,
            uploadedAt: Date.now()
          }]
        });
      }

      // Rehydrate immediately so the newly filed material is visible in the
      // current course without a page reload.
      await syncDataFromSupabase();
    } catch (err) {
      console.error('AI attachment ingestion failed:', err);
      showToast(`Couldn't file ${file.name}: ${err?.message || 'upload failed'}`);
    }
  }
}

/* ========================================================================
   VIEW 4: UNIFIED AI + SEARCH
   ======================================================================== */
function localFileKind(mime = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  return 'file';
}

const aiObjectUrlCache = new WeakMap();
function localAttachmentUrl(file) {
  if (!file) return '';
  if (!aiObjectUrlCache.has(file)) aiObjectUrlCache.set(file, URL.createObjectURL(file));
  return aiObjectUrlCache.get(file);
}

function renderAiMediaAttachment(a, pending = false) {
  const mime = a.mimeType || a.mime_type || '';
  const kind = a.kind || localFileKind(mime);
  const url = a.url || (pending && a instanceof File ? localAttachmentUrl(a) : '');
  const label = escapeHtml(a.name || 'Attachment');
  if (!url) return `<div class="ai-media-file"><span>${icon('doc')}</span><span>${label}</span></div>`;
  if (kind === 'image') return `<figure class="ai-media ai-media-image"><img src="${escapeHtml(url)}" alt="${label}" loading="lazy"><figcaption>${label}</figcaption></figure>`;
  if (kind === 'video') return `<figure class="ai-media ai-media-video"><video src="${escapeHtml(url)}" controls playsinline preload="metadata"></video><figcaption>${label}</figcaption></figure>`;
  if (kind === 'audio') return `<figure class="ai-media ai-media-audio"><audio src="${escapeHtml(url)}" controls preload="metadata"></audio><figcaption>${label}</figcaption></figure>`;
  return `<a class="ai-media-file" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><span>${icon('doc')}</span><span>${label}</span></a>`;
}

function renderAiMessageAttachments(attachments = []) {
  return attachments.length ? `<div class="ai-message-media-grid">${attachments.map(a => renderAiMediaAttachment(a)).join('')}</div>` : '';
}

function renderAiPendingAttachments(files = []) {
  return files.length ? `<div class="ai-pending-media">${files.map((f,i)=>`<div class="ai-pending-media-card">${renderAiMediaAttachment(f, true)}<button type="button" data-ai-remove-file="${i}" aria-label="Remove ${escapeHtml(f.name)}">${icon('close')}</button></div>`).join('')}</div>` : '';
}

function renderAiSearchResultsView(q) {
  const results = performUniversalSearch(q, COURSES);
  state.aiSearchResultsCount = results.length;
  if (!q) return `<div class="ai-discovery"><div class="ai-discovery-mark">${icon('spark')}</div><h2>Search School Center</h2><p>Courses, schedules, assignments, notes, materials, and concepts appear here as you type.</p></div>`;
  if (!results.length) return `<div class="ai-no-results"><div class="ai-no-results-icon">${icon('spark')}</div><div><strong>Nothing in School Center matches “${escapeHtml(q)}”.</strong><p>The same composer is now ready to ask the AI about it.</p></div></div>`;
  return `<div class="unified-search-results">${results.map(r => `<button class="unified-search-result glass-secondary" data-unified-search-type="${escapeHtml(r.type)}" data-course="${escapeHtml(r.courseId || '')}" data-tab="${escapeHtml(r.targetTab || 'overview')}" data-assignment="${escapeHtml(r.assignmentId || '')}" type="button"><span class="search-result-badge">${escapeHtml(r.badge)}</span><span class="search-result-copy"><b>${escapeHtml(r.title)}</b><small>${escapeHtml(r.subtitle || r.snippet || '')}</small>${r.snippet ? `<span>${escapeHtml(r.snippet)}</span>` : ''}</span>${icon('chevronRight')}</button>`).join('')}</div>`;
}

function renderAiConversation() {
  const messages = (state.aiChatMessages || []).filter(Boolean);
  if (!messages.length) return `<div class="ai-empty-state"><div class="ai-empty-symbol">${icon('spark')}</div><h2>What can I help with?</h2><p>Ask about your classes, assignments, notes, schedules, uploaded files, or anything in School Center.</p></div>`;
  return messages.map(m => {
    if (m.isThinking) return `<div class="ai-message assistant thinking"><div class="ai-typing-dots"><span></span><span></span><span></span></div></div>`;
    const sender = m.sender === 'user' ? 'user' : 'assistant';
    const isEditing = state.aiEditingMessageId === m.id;
    const text = m.text ? formatAiResponse(m.text) : '';
    const controls = m.id ? `<div class="ai-message-controls">
        ${sender === 'user' && !isEditing ? `<button type="button" class="ai-msg-action" data-ai-edit="${m.id}" aria-label="Edit message" title="Edit">${icon('pencil')}</button>` : ''}
        <button type="button" class="ai-msg-action" data-ai-delete="${m.id}" aria-label="Delete message" title="Delete">${icon('trash')}</button>
      </div>` : '';
    const body = isEditing
      ? `<div class="ai-message-edit"><textarea id="ai-edit-input-${m.id}" class="ai-composer-input">${escapeHtml(m.text || '')}</textarea><div class="ai-message-edit-actions"><button type="button" class="btn-ghost sm" data-ai-cancel-edit="${m.id}">Cancel</button><button type="button" class="btn-primary sm" data-ai-save-edit="${m.id}">Save</button></div></div>`
      : `<div class="ai-message-body">${text}</div>`;
    return `<article class="ai-message ${sender}">${renderAiMessageAttachments(m.attachments || [])}${body}<div class="ai-message-foot"><time>${new Date(m.createdAt || Date.now()).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}</time>${controls}</div></article>`;
  }).join('');
}

function renderUnifiedAiView() {
  const q = (state.searchQuery || '').trim();
  const directResults = q ? performUniversalSearch(q, COURSES) : [];
  const hasDirectResults = directResults.length > 0;
  const cloudLabel = state.aiCloudConnected ? 'Cloud history' : 'Local history';
  return `
    <section class="ai-fullscreen-view" aria-label="AI and Search workspace">
      <div class="ai-fullscreen-inner">
        <div class="ai-page-head">
          <div><div class="eyebrow">School Center</div><h2 class="headfont">AI & Search</h2></div>
          <div class="ai-page-head-right">
            <div class="ai-page-status"><span class="ai-connection-dot ${state.aiIsThinking || state.aiTranscribing ? 'busy' : state.aiConnectionState || 'idle'}"></span>${cloudLabel}</div>
            ${(state.aiChatMessages || []).length ? `<button type="button" class="icon-btn sm" id="ai-clear-chat-btn" aria-label="Clear conversation" title="Clear conversation">${icon('trash')}</button>` : ''}
          </div>
        </div>
        <div class="ai-page-body" id="ai-page-body">${hasDirectResults ? renderAiSearchResultsView(q) : (q ? `${renderAiSearchResultsView(q)}${renderAiConversation()}` : renderAiConversation())}</div>
        ${renderAiPendingAttachments(state.aiAttachments || [])}
        <div class="ai-composer-shell ai-page-composer">
          <div class="ai-composer">
            <button class="ai-composer-icon" id="ai-attach-btn" type="button" aria-label="Attach files" title="Attach files">${icon('plus')}</button>
            <textarea id="ai-chat-input" class="ai-composer-input" rows="1" placeholder="Search School Center or ask AI…">${escapeHtml(state.searchQuery || '')}</textarea>
            <button class="ai-composer-icon ${state.aiTranscribing ? 'recording' : ''}" id="ai-mic-btn" type="button" aria-label="${state.aiTranscribing ? 'Stop transcription' : 'Transcribe microphone'}" title="${state.aiTranscribing ? 'Stop transcription' : 'Transcribe microphone'}">${icon('mic')}</button>
            <button class="ai-send-btn" id="ai-chat-send" type="button" aria-label="Send message" title="Send message">${icon('arrowUp')}</button>
          </div>
          <div class="ai-live-transcript" id="ai-live-transcript">${state.aiTranscribing ? 'Listening…' : ''}</div>
          <input id="ai-file-input" type="file" multiple accept="${escapeHtml(GEMINI_FILE_ACCEPT)}" hidden>
        </div>
      </div>
    </section>`;
}

/* =========================================================================
   VIEW 4: SETTINGS (Search, Sync, Appearance & AI Connection)
   ========================================================================= */
function renderSettingsView() {
  const currentSupabaseUrl = localStorage.getItem('sc_supabase_url') || document.querySelector('meta[name="supabase-url"]')?.content || '';
  const currentSupabaseKey = localStorage.getItem('sc_supabase_anon_key') || document.querySelector('meta[name="supabase-anon-key"]')?.content || '';
  const activeJobs = jobsManager.getActiveJobsCount();
  const failedJobs = jobsManager.getFailedJobsCount();
  const authEmail = state.aiCloudUser?.email || '';
  // IMPORTANT: "Connected" must reflect real sign-in, not just that Supabase
  // credentials exist. Notes/Assignments only sync to the cloud once a user
  // is actually signed in — showing "Connected" before that point is what
  // previously made it look like sync was working when it never started.
  let syncState;
  let syncDot;
  if (!isSupabaseConfigured()) {
    syncState = 'Local only — cloud not configured';
    syncDot = 'idle';
  } else if (state.dataSyncLastError) {
    syncState = 'Sync error — see below';
    syncDot = 'attention';
  } else if (failedJobs > 0) {
    syncState = 'Needs attention';
    syncDot = 'attention';
  } else if (!authEmail) {
    syncState = 'Not signed in — notes stay on this device only';
    syncDot = 'attention';
  } else if (activeJobs > 0) {
    syncState = `${activeJobs} processing`;
    syncDot = 'busy';
  } else if (state.dataSyncRealtime === 'degraded') {
    // Honest middle state: signed in and syncing, but over the periodic poll
    // rather than the live socket. Previously this rendered as plain
    // "Connected", which is how a dead websocket stayed invisible for weeks.
    syncState = `Syncing periodically as ${authEmail}`;
    syncDot = 'busy';
  } else {
    syncState = `Connected as ${authEmail}`;
    syncDot = 'ready';
  }
  const syncDetail = getDataSyncStatus();
  const customAccent = localStorage.getItem('sc_custom_accent') || currentTheme.accent;
  return `
    <div class="settings-page">
      <div class="settings-title-row"><div><div class="eyebrow">School Center</div><h2 class="headfont">Settings</h2><p>Cloud sync, account, appearance, and AI connection.</p></div></div>

      <div class="panel settings-card">
        <div class="section-head-row"><div><h3 class="headfont">Cloud Sync</h3><div class="section-sub">Assignments, notes, materials, and AI history can stay synchronized across devices — but only once you're signed in below.</div></div><span class="settings-sync-status"><span class="ai-connection-dot ${syncDot}"></span>${syncState}</span></div>
        ${!authEmail ? `<div class="sync-warning-inline">⚠️ You are not signed in, so anything you create in Notes or Assignments right now is saved on <b>this device only</b>. Sign in with the same email below on every device to make it sync.</div>` : ''}
        ${state.dataSyncLastError ? `<div class="sync-warning-inline sync-warning-error">Last sync attempt failed: ${escapeHtml(state.dataSyncLastError)}</div>` : ''}
        ${authEmail && state.dataSyncRealtime === 'degraded' ? `<div class="sync-warning-inline">Live updates are unavailable on this network, so changes are reconciled every 15 seconds instead of instantly. Everything still syncs — it is just not immediate.${state.dataSyncRealtimeNote ? ` (${escapeHtml(state.dataSyncRealtimeNote)})` : ''}</div>` : ''}
        ${authEmail ? `<div class="section-sub" style="margin-top:8px;">Live updates: <b>${escapeHtml(syncDetail.realtime)}</b>${syncDetail.lastSyncOkAt ? ` · last successful sync ${new Date(syncDetail.lastSyncOkAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}${syncDetail.consecutiveFailures ? ` · ${syncDetail.consecutiveFailures} consecutive failure${syncDetail.consecutiveFailures === 1 ? '' : 's'}` : ''}</div>` : ''}
        <div class="settings-sync-actions"><button class="btn-primary" id="manual-sync-btn" type="button">Sync now</button><button class="btn-ghost" id="open-sync-details-btn" type="button">Background activity</button></div>
        <details class="settings-advanced"><summary>Cloud connection</summary><div class="field-label">Supabase Project URL</div><input type="text" id="supabase-url-field" class="search-input" value="${escapeHtml(currentSupabaseUrl)}"><div class="field-label">Supabase Publishable / Anon Key</div><input type="password" id="supabase-key-field" class="search-input" value="${escapeHtml(currentSupabaseKey)}"><button class="btn-ghost" id="save-cloud-settings-btn" type="button">Save cloud config</button></details>
      </div>

      <div class="panel settings-card">
        <h3 class="headfont">Account &amp; cross-device sync</h3>
        <div class="section-sub">This app uses a single shared account. Sign in with the account password below — this device then syncs notes, assignments, deadlines, and AI history with the cloud and every other signed-in device. Everything stays saved on this device even while signed out.</div>
        ${authEmail ? `
          <div class="settings-account-row"><div><b>${escapeHtml(authEmail)}</b><div class="settings-account-state"><span class="ai-connection-dot ready"></span> Signed in — Notes, Assignments, and AI history sync automatically</div></div><button class="btn-ghost" id="ai-signout-btn" type="button">Sign out</button></div>
        ` : `
          <div class="settings-auth-row"><input type="password" id="ai-signin-password" class="search-input" placeholder="Account password" autocomplete="current-password"><button class="btn-primary" id="ai-signin-password-btn" type="button">Sign in</button></div>
          <div class="settings-account-help">Enter the account password to enable cloud sync on this device. No email or username is needed — the account already exists.</div>
        `}
      </div>

      <div class="panel settings-card">
        <h3 class="headfont">Appearance</h3>
        <div class="field-label">Theme</div>
        <div class="theme-row" id="theme-row">${Object.entries(THEME_PRESETS).map(([k,t])=>`<button class="swatch ${currentTheme.label===t.label && !localStorage.getItem('sc_custom_accent')?'active':''}" data-theme-key="${k}" type="button" style="background:linear-gradient(135deg, ${t.accent}, ${t.lava[1]})" title="${t.label}" aria-label="${t.label}"></button>`).join('')}<label class="swatch custom-swatch ${localStorage.getItem('sc_custom_accent')?'active':''}" title="Custom accent" aria-label="Custom accent"><input type="color" id="accent-color-input" value="${customAccent}"></label></div>
        <div class="theme-custom-row"><div><div class="field-label">Accent color</div><div class="section-sub">Used consistently for navigation, focus states, buttons, links, and AI accents.</div></div><input type="color" id="accent-color-input-inline" value="${customAccent}" aria-label="Choose accent color"></div>
        <div class="field-label">Background intensity</div><input type="range" min="0" max="1" step="0.05" value="${localStorage.getItem('sc_lava_opacity') || '1'}" id="lava-slider" style="width:100%;accent-color:var(--accent);">
      </div>

      <div class="panel settings-card">
        <h3 class="headfont">Gemini</h3><p class="section-sub">Your Gemini API key stays in this browser. Live microphone transcription uses the secure Supabase token function when cloud sync is connected.</p>
        <div class="field-label">Gemini API key</div><input type="password" id="more-gemini-key-field" class="search-input" value="${escapeHtml(getGeminiApiKey())}" autocomplete="off" placeholder="Paste Gemini API key">
        <div class="settings-sync-actions"><button class="btn-primary" id="save-more-ai-key-btn" type="button">Save key</button><button class="btn-ghost" id="test-gemini-btn" type="button">Test connection</button></div>
        <div class="section-sub" style="margin-top:8px;">Model: <b>${escapeHtml(state.aiLastModel || getPreferredGeminiModel())}</b>${state.aiLastModel ? '' : ' (not yet confirmed — press Test connection)'}${state.aiToolsDisabled ? ' · in-app actions unavailable on this model' : ''}</div>
      </div>
    </div>`;
}
function renderSettingsSearchResults(){
  const results=performUniversalSearch(state.searchQuery, COURSES);
  return `<div class="settings-search-results">${results.length?results.map(r=>`<button class="settings-search-result" data-search-hit="${r.type}" data-course="${r.courseId||''}" data-tab="${r.targetTab||'overview'}" type="button"><span class="badge">${escapeHtml(r.badge)}</span><span class="settings-search-result-copy"><b>${escapeHtml(r.title)}</b><small>${escapeHtml(r.subtitle)}</small></span></button>`).join(''):'<div class="empty-inline">No results.</div>'}</div>`;
}

/* =========================================================================
   BOTTOM SHEETS: JOBS DRAWER
   ========================================================================= */
function renderJobsDrawer() {
  const jobs = jobsManager.jobs;
  return `
    <div class="sheet-backdrop ${state.jobsDrawerOpen ? 'open' : ''}" id="jobs-drawer-backdrop">
      <div class="bottom-sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-head">
          <h3 class="headfont">Background Processing Queue</h3>
          <div class="icon-btn sm" id="close-jobs-drawer">${icon('close')}</div>
        </div>
        <div class="sheet-body">
          ${jobs.length ? jobs.map(j => `
            <div class="surface-content" style="padding:14px;margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <b style="font-size:0.92rem;">${j.title}</b>
                <span class="badge badge-${j.status}">${j.status}</span>
              </div>
              <div style="font-size:0.8rem;color:var(--muted);margin:4px 0;">${j.message}</div>
              <div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;margin-top:8px;">
                <div style="width:${j.progress}%;height:100%;background:var(--accent);transition:width .2s ease;"></div>
              </div>
              ${j.status === 'failed' && j.retryable ? `
                <button class="btn-ghost" data-retry-job="${j.id}" style="min-height:30px;font-size:0.75rem;margin-top:8px;">Retry Task</button>
              ` : ''}
            </div>
          `).join('') : `<div style="text-align:center;padding:24px;color:var(--muted-dim);">No active or queued background tasks.</div>`}
        </div>
      </div>
    </div>
  `;
}


/* =========================================================================
   DRAWER: DYNAMIC SYNC & CLOUD STATUS
   ========================================================================= */

/* Restored core modal renderers retained from the stable app shell. */
function renderAssignmentModal() {
  if (!state.assignmentModalOpen) return '';
  const preset = state.assignmentModalPreset || {};
  const courseOptions = COURSES.map(c =>
    `<option value="${c.id}" ${c.id === (preset.courseId || state.courseId) ? 'selected' : ''}>${c.code} — ${c.name}</option>`
  ).join('');
  const todayISO = new Date().toISOString().split('T')[0];
  const presetDate = preset.dueDate ? new Date(preset.dueDate).toISOString().split('T')[0] : todayISO;

  return `
    <div class="modal-overlay open" id="assignment-modal-overlay">
      <div class="modal-box">
        <div class="modal-head">
          <h3 class="headfont">New Assignment</h3>
          <div class="icon-btn sm" id="close-assignment-modal">${icon('close')}</div>
        </div>
        <div class="modal-body">
          <div class="field-label">Title</div>
          <input type="text" id="asg-title-input" class="modal-input" placeholder="e.g. Assignment 2 — Determinants" autofocus>

          <div class="field-label">Course</div>
          <select id="asg-course-select" class="modal-input">${courseOptions}</select>

          <div class="modal-row">
            <div style="flex:1;">
              <div class="field-label">Due Date</div>
              <input type="date" id="asg-due-input" class="modal-input" value="${presetDate}">
            </div>
            <div style="flex:1;">
              <div class="field-label">Priority</div>
              <select id="asg-priority-select" class="modal-input">
                <option value="high">🔴 High</option>
                <option value="medium" selected>🟡 Medium</option>
                <option value="low">🟢 Low</option>
              </select>
            </div>
          </div>

          <div class="field-label">Description (optional)</div>
          <textarea id="asg-desc-input" class="modal-input modal-textarea" placeholder="Describe the deliverables or submission requirements..."></textarea>

          <div class="field-label">Requirements Checklist</div>
          <div id="asg-checklist-container" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;"></div>
          <div style="display:flex;gap:8px;">
            <input type="text" id="asg-checklist-new" class="modal-input" placeholder="Add checklist item..." style="flex:1;">
            <button class="btn-ghost" id="asg-checklist-add-btn" style="min-height:40px;padding:0 14px;">Add</button>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-ghost" id="close-assignment-modal-cancel">Cancel</button>
          <button class="btn-primary" id="save-assignment-btn">Create Assignment</button>
        </div>
      </div>
    </div>
  `;
}

/* =========================================================================
   MODAL: ASSIGNMENT DETAIL
   ========================================================================= */

function renderAssignmentDetailModal() {
  if (!state.assignmentDetailId) return '';
  const a = assignmentsManager.getById(state.assignmentDetailId);
  if (!a) return '';
  const course = courseById(a.courseId);

  const statusOptions = ['not_started','in_progress','submitted','completed','graded'].map(s =>
    `<option value="${s}" ${a.status === s ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`
  ).join('');

  return `
    <div class="modal-overlay open" id="asg-detail-modal-overlay">
      <div class="modal-box">
        <div class="modal-head">
          <div>
            <span style="font-size:0.75rem;font-weight:700;color:${course ? course.accent : 'var(--accent)'}">${course ? course.code : ''}</span>
            <h3 class="headfont" style="margin:2px 0 0;">${a.title}</h3>
          </div>
          <div class="icon-btn sm" id="close-asg-detail-modal">${icon('close')}</div>
        </div>
        <div class="modal-body">
          <div class="modal-row" style="margin-bottom:12px;">
            <div style="flex:1;">
              <div class="field-label">Due Date</div>
              <div style="font-size:0.9rem;">${new Date(a.dueDate).toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' })}</div>
            </div>
            <div style="flex:1;">
              <div class="field-label">Status</div>
              <select id="asg-detail-status" class="modal-input" style="margin-top:4px;">${statusOptions}</select>
            </div>
          </div>

          ${a.description ? `<div style="font-size:0.88rem;color:var(--ink);line-height:1.6;padding:10px;background:rgba(255,255,255,0.04);border-radius:var(--radius-sm);margin-bottom:12px;">${a.description}</div>` : ''}

          ${a.requirementsChecklist && a.requirementsChecklist.length ? `
            <div class="field-label">Checklist</div>
            <ul class="assignment-checklist" style="margin-bottom:12px;">
              ${a.requirementsChecklist.map(ch => `
                <li class="checklist-item ${ch.done ? 'done' : ''}" data-asg-check="${a.id}" data-check-id="${ch.id}">
                  <input type="checkbox" ${ch.done ? 'checked' : ''} style="cursor:pointer;">
                  <span>${ch.text}</span>
                </li>
              `).join('')}
            </ul>
          ` : ''}

          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
            <button class="btn-ghost" data-asg-ai="rewrite" data-asg-id="${a.id}" style="font-size:0.78rem;min-height:32px;padding:0 12px;">✨ AI Rewrite</button>
            <button class="btn-ghost" id="asg-detail-delete-btn" data-asg-del="${a.id}" style="font-size:0.78rem;min-height:32px;padding:0 12px;color:var(--accent-3);">🗑 Delete</button>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-ghost" id="close-asg-detail-modal-cancel">Close</button>
          <button class="btn-primary" id="update-asg-status-btn" data-asg-id="${a.id}">Save Changes</button>
        </div>
      </div>
    </div>
  `;
}

/* =========================================================================
   MODAL: NOTE EDITOR
   ========================================================================= */

function renderNoteModal() {
  if (!state.noteModalOpen) return '';
  const preset = state.noteModalPreset || {};
  const courseOptions = [{ id: '', code: 'No Course', name: '' }, ...COURSES].map(c =>
    `<option value="${c.id}" ${c.id === (preset.courseId || state.courseId || '') ? 'selected' : ''}>${c.code}${c.name ? ' — ' + c.name : ''}</option>`
  ).join('');

  return `
    <div class="modal-overlay open" id="note-modal-overlay">
      <div class="modal-box">
        <div class="modal-head">
          <h3 class="headfont">New Note</h3>
          <div class="icon-btn sm" id="close-note-modal">${icon('close')}</div>
        </div>
        <div class="modal-body">
          <div class="field-label">Title</div>
          <input type="text" id="note-title-input" class="modal-input" placeholder="e.g. Week 3 Lecture — Vector Spaces" autofocus>

          <div class="field-label">Course</div>
          <select id="note-course-select" class="modal-input">${courseOptions}</select>

          <div class="field-label">Content</div>
          <textarea id="note-content-input" class="modal-input modal-textarea" style="min-height:140px;" placeholder="Write your lecture notes, ideas, or key concepts here..."></textarea>

          <div class="field-label" style="margin-top:4px;">Tags (comma-separated)</div>
          <input type="text" id="note-tags-input" class="modal-input" placeholder="e.g. eigenvalues, exam, Week 4">
        </div>
        <div class="modal-footer">
          <button class="btn-ghost" id="close-note-modal-cancel">Cancel</button>
          <button class="btn-primary" id="save-note-btn">Save Note</button>
        </div>
      </div>
    </div>
  `;
}

/* =========================================================================
   MODAL: FLASHCARDS HUB
   ========================================================================= */

function renderFlashcardsModal() {
  if (!state.flashcardsModalOpen) return '';

  // Gather cards from all courses' lectures + key concepts
  const allCards = [];
  COURSES.forEach(c => {
    (c.lectures || []).forEach(lec => {
      (lec.concepts || []).forEach(([term, def]) => {
        allCards.push({ front: term, back: def, course: c.code, color: c.accent });
      });
    });
  });

  // Also include flashcard AI outputs from notes
  notesManager.getAll().forEach(n => {
    if (n.aiGenerated && n.aiGenerated.flashcards) {
      try {
        const parsed = Array.isArray(n.aiGenerated.flashcards)
          ? n.aiGenerated.flashcards
          : JSON.parse(n.aiGenerated.flashcards);
        (parsed || []).forEach(fc => {
          if (fc.front && fc.back) allCards.push({ front: fc.front, back: fc.back, course: 'Notes', color: 'var(--accent-2)' });
        });
      } catch(e) {}
    }
  });

  if (allCards.length === 0) {
    return `
      <div class="modal-overlay open" id="flashcards-modal-overlay">
        <div class="modal-box" style="text-align:center;padding:32px;">
          <h3 class="headfont">Flashcards Hub</h3>
          <p style="color:var(--muted);font-size:0.9rem;margin:16px 0;">No flashcards available yet. Upload course materials or generate AI flashcards from your notes first.</p>
          <button class="btn-primary" id="close-flashcards-modal">Got it</button>
        </div>
      </div>
    `;
  }

  const idx = Math.max(0, Math.min(state.flashcardIndex, allCards.length - 1));
  const card = allCards[idx];

  return `
    <div class="modal-overlay open" id="flashcards-modal-overlay">
      <div class="modal-box" style="max-width:480px;">
        <div class="modal-head">
          <h3 class="headfont">Flashcards Hub</h3>
          <div class="icon-btn sm" id="close-flashcards-modal">${icon('close')}</div>
        </div>
        <div class="modal-body" style="text-align:center;">
          <div style="font-size:0.72rem;font-weight:700;color:${card.color};text-transform:uppercase;margin-bottom:8px;">${card.course}</div>
          <div style="font-size:0.8rem;color:var(--muted);margin-bottom:4px;">Card ${idx + 1} of ${allCards.length}</div>

          <div class="flashcard" id="flashcard-panel">
            <div class="flashcard-front" id="flashcard-front">
              <div class="flashcard-label">Term</div>
              <div class="flashcard-term">${card.front}</div>
            </div>
            <div class="flashcard-back" id="flashcard-back" style="display:none;">
              <div class="flashcard-label">Definition</div>
              <div class="flashcard-def">${card.back}</div>
            </div>
          </div>

          <button class="btn-ghost" id="flip-card-btn" style="margin:12px 0;min-height:38px;padding:0 20px;">Flip Card</button>

          <div style="display:flex;justify-content:center;gap:12px;">
            <button class="btn-ghost" id="fc-prev-btn" style="min-height:38px;padding:0 18px;" ${idx === 0 ? 'disabled' : ''}>← Prev</button>
            <button class="btn-ghost" id="fc-next-btn" style="min-height:38px;padding:0 18px;" ${idx >= allCards.length - 1 ? 'disabled' : ''}>Next →</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* =========================================================================
   MODAL: SPOTLIGHT COMMAND PALETTE SEARCH
   ========================================================================= */

function renderSpotlightModal() {
  if (!state.spotlightSearchOpen) return '';

  const q = (state.spotlightQuery || '').trim().toLowerCase();
  
  let courseResults = [];
  let asgResults = [];
  let noteResults = [];
  let topicResults = [];

  if (q.length > 0) {
    courseResults = COURSES.filter(c => 
      c.code.toLowerCase().includes(q) || 
      c.name.toLowerCase().includes(q) || 
      (c.instructor && c.instructor.toLowerCase().includes(q))
    );

    asgResults = assignmentsManager.getAll().filter(a => 
      a.title.toLowerCase().includes(q) || 
      (a.description && a.description.toLowerCase().includes(q))
    );

    noteResults = notesManager.getAll().filter(n =>
      n.title.toLowerCase().includes(q) ||
      (n.content && n.content.toLowerCase().includes(q)) ||
      (n.tags && n.tags.some(t => t.toLowerCase().includes(q)))
    );

    COURSES.forEach(c => {
      (c.syllabus || []).forEach(s => {
        if (s[2] && s[2].toLowerCase().includes(q)) {
          topicResults.push({ title: s[2], course: c.code, courseId: c.id });
        }
      });
      (c.lectures || []).forEach(l => {
        (l.concepts || []).forEach(([term, def]) => {
          if (term.toLowerCase().includes(q) || def.toLowerCase().includes(q)) {
            topicResults.push({ title: term, sub: def, course: c.code, courseId: c.id });
          }
        });
      });
    });
  }

  const hasAny = courseResults.length || asgResults.length || noteResults.length || topicResults.length;

  return `
    <div class="modal-overlay open" id="spotlight-modal-overlay">
      <div class="modal-box spotlight-box">
        <div class="spotlight-input-wrap">
          ${icon('search')}
          <input type="text" id="spotlight-search-input" class="spotlight-input" placeholder="Search courses, assignments, lectures, notes..." value="${state.spotlightQuery || ''}">
          <div class="icon-btn sm" id="close-spotlight-modal">${icon('close')}</div>
        </div>

        <div class="spotlight-results">
          ${!q ? `
            <div style="color:var(--muted-dim);text-align:center;padding:32px 16px;font-size:0.88rem;">
              Type to instantly search across courses, deadlines, syllabi, notes, and topics.
            </div>
          ` : (hasAny ? `
            ${courseResults.length ? `
              <div class="spotlight-section-title">Courses</div>
              ${courseResults.map(c => `
                <div class="spotlight-item" data-spotlight-nav="course" data-spotlight-id="${c.id}">
                  <div class="spotlight-item-main">
                    <div class="spotlight-item-title">${c.code} — ${c.name}</div>
                    <div class="spotlight-item-sub">${c.instructor || 'Online'}</div>
                  </div>
                  <span class="spotlight-tag" style="color:${c.accent}">Course</span>
                </div>
              `).join('')}
            ` : ''}

            ${asgResults.length ? `
              <div class="spotlight-section-title">Assignments</div>
              ${asgResults.map(a => `
                <div class="spotlight-item" data-spotlight-nav="asg" data-spotlight-id="${a.id}">
                  <div class="spotlight-item-main">
                    <div class="spotlight-item-title">📋 ${a.title}</div>
                    <div class="spotlight-item-sub">Due ${new Date(a.dueDate).toLocaleDateString()} · ${a.status}</div>
                  </div>
                  <span class="spotlight-tag">Task</span>
                </div>
              `).join('')}
            ` : ''}

            ${noteResults.length ? `
              <div class="spotlight-section-title">Notes</div>
              ${noteResults.map(n => `
                <div class="spotlight-item" data-spotlight-nav="note" data-spotlight-id="${n.id}">
                  <div class="spotlight-item-main">
                    <div class="spotlight-item-title">✍️ ${n.title}</div>
                    <div class="spotlight-item-sub">${(n.content || '').slice(0, 50)}...</div>
                  </div>
                  <span class="spotlight-tag">Note</span>
                </div>
              `).join('')}
            ` : ''}

            ${topicResults.length ? `
              <div class="spotlight-section-title">Topics & Concepts</div>
              ${topicResults.slice(0, 5).map(t => `
                <div class="spotlight-item" data-spotlight-nav="course" data-spotlight-id="${t.courseId}">
                  <div class="spotlight-item-main">
                    <div class="spotlight-item-title">💡 ${t.title}</div>
                    <div class="spotlight-item-sub">${t.course}${t.sub ? ' · ' + t.sub.slice(0, 45) + '...' : ''}</div>
                  </div>
                  <span class="spotlight-tag">Concept</span>
                </div>
              `).join('')}
            ` : ''}
          ` : `
            <div style="color:var(--muted-dim);text-align:center;padding:32px 16px;font-size:0.88rem;">
              No matching results found for "${q}".
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}

/* =========================================================================
   DRAWER: DYNAMIC SYNC & CLOUD STATUS
   ========================================================================= */

function renderSyncDrawer() {
  if (!state.syncDrawerOpen) return '';
  const isOnline = isSupabaseConfigured();
  const allJobs = jobsManager.jobs;

  return `
    <div class="sheet-backdrop open" id="sync-drawer-backdrop">
      <div class="bottom-sheet" style="max-width:520px;">
        <div class="sheet-handle"></div>
        <div class="sheet-head">
          <h3 class="headfont">Sync & Cloud Health</h3>
          <div class="icon-btn sm" id="close-sync-drawer">${icon('close')}</div>
        </div>
        <div class="sheet-body">
          <div class="sync-stat-row">
            <div>
              <div style="font-weight:700;font-size:0.9rem;">Supabase Cloud Database</div>
              <div style="font-size:0.75rem;color:var(--muted);">${!isOnline
                ? 'Offline Local Storage Mode'
                : (state.dataSyncLastError
                    ? `Sync error: ${escapeHtml(state.dataSyncLastError)}`
                    : (state.dataSyncRealtime === 'subscribed'
                        ? 'Connected & streaming (Realtime)'
                        : 'Connected — periodic sync (Realtime unavailable)'))}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;font-weight:600;color:${!isOnline ? 'var(--accent-amber)' : (state.dataSyncLastError ? 'var(--accent-3)' : 'var(--accent-2)')};">
              <span style="width:8px;height:8px;border-radius:50%;background:currentColor;"></span>
              ${isOnline ? 'Synced' : 'Local'}
            </div>
          </div>

          <div style="font-size:0.8rem;font-weight:700;margin:14px 0 6px;">Background Processing Queue (${allJobs.length})</div>
          
          <div class="sync-jobs-list">
            ${allJobs.length ? allJobs.map(j => `
              <div class="sync-job-card">
                <div class="sync-job-head">
                  <span>${j.title}</span>
                  <span style="font-size:0.72rem;color:${j.status==='completed'?'var(--accent-2)':(j.status==='failed'?'var(--accent-3)':'var(--accent)')};text-transform:capitalize;">${j.status}</span>
                </div>
                ${j.status === 'processing' ? `
                  <div class="sync-progress-track">
                    <div class="sync-progress-fill" style="width:${j.progress || 35}%;"></div>
                  </div>
                  <div style="font-size:0.72rem;color:var(--muted);">${j.progressText || 'Working...'}</div>
                ` : ''}
              </div>
            `).join('') : `
              <div style="color:var(--muted-dim);text-align:center;padding:16px;font-size:0.84rem;">
                No background tasks in queue. All systems operating normally.
              </div>
            `}
          </div>

          <div style="display:flex;gap:10px;margin-top:14px;">
            <button class="btn-ghost" id="sync-pull-btn" style="flex:1;">Sync from Cloud</button>
            <button class="btn-primary" id="sync-push-btn" style="flex:1;">Push to Cloud</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* =========================================================================
   GOOGLE GEMINI AI INTEGRATION ENGINE (Real API Key)
   ========================================================================= */
// API key is user-supplied — paste yours in Settings → Gemini API Key
export const DEFAULT_GEMINI_KEY = "";

export function getGeminiApiKey() {
  return localStorage.getItem('sc_gemini_api_key') || DEFAULT_GEMINI_KEY;
}

export function setGeminiApiKey(key) {
  if (key && key.trim()) {
    localStorage.setItem('sc_gemini_api_key', key.trim());
  } else {
    localStorage.removeItem('sc_gemini_api_key');
  }
}

export function formatAiResponse(raw) {
  if (!raw) return '';
  // Sanitize angle brackets except intentional tags
  let html = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Fenced Code blocks
  html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, '<pre class="ai-code-block"><code>$2</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="ai-inline-code">$1</code>');
  // Bold **text**
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Italic *text*
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // Bullet points
  html = html.replace(/(?:^|\n)[*•-]\s+([^\n]+)/g, '<div class="ai-bullet">• $1</div>');
  // Double newlines to paragraph break
  html = html.replace(/\n\n/g, '<div style="height:8px;"></div>');
  // Single newlines to <br>
  html = html.replace(/\n/g, '<br>');
  return html;
}

/* =========================================================================
   INTEGRATED AI WORKSPACE
   ========================================================================= */
const APP_FUNCTION_DECLARATIONS = [
  {
    name: 'create_note',
    description: 'Create a new School Center note and store it locally.',
    parameters: { type: 'object', properties: {
      title: { type: 'string', description: 'Note title' },
      content: { type: 'string', description: 'Note content' },
      courseId: { type: 'string', description: 'Optional School Center course id' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' }
    }, required: ['title', 'content'] }
  },
  {
    name: 'update_note',
    description: 'Update an existing School Center note.',
    parameters: { type: 'object', properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      content: { type: 'string' },
      courseId: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      _changeLog: { type: 'string' }
    }, required: ['id'] }
  },
  {
    name: 'delete_note',
    description: 'Delete an existing School Center note by id.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'create_assignment',
    description: 'Create a new School Center assignment/task.',
    parameters: { type: 'object', properties: {
      title: { type: 'string' },
      courseId: { type: 'string' },
      description: { type: 'string' },
      dueDate: { type: 'string', description: 'ISO date/time' },
      priority: { type: 'string' },
      status: { type: 'string' },
      assignmentType: { type: 'string' }
    }, required: ['title', 'courseId'] }
  },
  {
    name: 'update_assignment',
    description: 'Update an existing School Center assignment/task.',
    parameters: { type: 'object', properties: {
      id: { type: 'string' }, title: { type: 'string' }, courseId: { type: 'string' },
      description: { type: 'string' }, dueDate: { type: 'string' }, priority: { type: 'string' },
      status: { type: 'string' }, notes: { type: 'string' }, _changeLog: { type: 'string' }
    }, required: ['id'] }
  },
  {
    name: 'delete_assignment',
    description: 'Delete an existing School Center assignment/task by id.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'store_attached_file',
    description: 'Store one file currently attached to this AI conversation in a School Center course using the existing upload pipeline.',
    parameters: { type: 'object', properties: {
      fileName: { type: 'string' },
      courseId: { type: 'string' }
    }, required: ['fileName', 'courseId'] }
  },
  {
    name: 'sync_school_center',
    description: 'Pull the latest connected cloud data into School Center.',
    parameters: { type: 'object', properties: {} }
  }
];

async function executeGeminiTool(name, args = {}) {
  switch (name) {
    case 'create_note':
      return { ok: true, note: notesManager.createNote(args) };
    case 'update_note': {
      const { id, ...updates } = args;
      const updated = notesManager.updateNote(id, updates);
      if (!updated) throw new Error(`Note ${id} was not found.`);
      return { ok: true, note: updated };
    }
    case 'delete_note':
      return { ok: notesManager.deleteNote(args.id), id: args.id };
    case 'create_assignment':
      return { ok: true, assignment: assignmentsManager.createAssignment(args) };
    case 'update_assignment': {
      const { id, ...updates } = args;
      const updated = assignmentsManager.updateAssignment(id, updates);
      if (!updated) throw new Error(`Assignment ${id} was not found.`);
      return { ok: true, assignment: updated };
    }
    case 'delete_assignment':
      return { ok: assignmentsManager.deleteAssignment(args.id), id: args.id };
    case 'store_attached_file': {
      const file = aiActiveAttachments.find(f => f.name === args.fileName);
      if (!file) throw new Error(`No attached file named ${args.fileName} is available.`);
      if (!isSupabaseConfigured()) throw new Error('Cloud storage is not configured. Connect Supabase in Settings first.');
      const course = courseById(args.courseId);
      if (!course) throw new Error(`Course ${args.courseId} was not found.`);
      await uploadAndProcessFile({ file, course, onProgress: () => {}, onLog: () => {} });
      await syncDataFromSupabase();
      return { ok: true, stored: file.name, courseId: args.courseId };
    }
    case 'sync_school_center':
      await syncDataFromSupabase();
      return { ok: true, syncedAt: new Date().toISOString() };
    default:
      throw new Error(`Unknown app action: ${name}`);
  }
}

function buildAiAppContext() {
  const courseSummary = COURSES.map(c => `${c.code}: ${c.name} (id: ${c.id})`).join('\n');
  const scheduleSummary = FALL_2026_SCHEDULE.map(s => `${s.dayName} ${s.start}–${s.end}: ${s.courseCode} ${s.type}, ${s.room}, ${s.instructor}`).join('\n');
  const assignments = assignmentsManager.getAll().slice(0, 30).map(a => `${a.id}: ${a.title} | ${a.courseId} | due ${a.dueDate} | ${a.status} | ${a.priority || 'normal'}`).join('\n');
  const notes = notesManager.getAll().slice(0, 30).map(n => `${n.id}: ${n.title} | ${n.courseId} | ${n.content.slice(0, 700)}`).join('\n');
  const materials = COURSES.flatMap(c => (c.cloudMaterials || []).slice(0, 50).map(m => `${c.id}: ${m.title} | ${m.type || 'file'} | ${m.moduleTitle || 'Materials'}`)).join('\n');
  return `\nCOURSES:\n${courseSummary || 'None'}\n\nWEEKLY SCHEDULE:\n${scheduleSummary || 'None'}\n\nASSIGNMENTS:\n${assignments || 'None'}\n\nNOTES:\n${notes || 'None'}\n\nAPP MATERIALS METADATA:\n${materials || 'None'}\n`;
}

export function buildGeminiSystemPrompt() {
  const now = new Date();
  const nowLabel = now.toLocaleString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  });
  return `You are the integrated AI workspace inside School Center. Do not mention internal modes, developer/student roles, or model names unless the user explicitly asks about the underlying service. Keep UI-facing responses natural, concise, and useful.

CURRENT DATE & TIME: ${nowLabel}. Use this as the real, authoritative current moment for anything involving "today", "tomorrow", days until a deadline, or how much time is left — do not say you lack the ability to know the date or time.

You do not have live internet access. If a question requires current external information you were not given in this context (news, prices, something outside School Center's own data), say so plainly instead of guessing.

You cannot generate images, video, or audio. If asked to create one, say that image/media generation isn't available yet rather than inventing a fake result.

You have access to School Center's current courses, schedule, assignments, notes, and material metadata. You may use the available app actions when the user's request requires changing School Center data. When an action changes data, complete it and then tell the user what changed. Never claim to have edited GitHub source code or deployed the site; this browser app does not have repository deployment access.

You can create, update, and remove notes and assignments, sync cloud data, and store an attached file into a selected course using the app's connected upload pipeline. Prefer precise IDs from the provided context when changing existing records.

${buildAiAppContext()}`;
}

function extractAiMediaAttachments(text = '') {
  const found = [];
  const seen = new Set();
  const pattern = /(?:!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)|(?:https?:\/\/[^\s<]+\.(?:png|jpe?g|webp|gif|avif|heic|heif|mp4|webm|mov|m4v|mp3|wav|m4a|aac|ogg|flac)(?:\?[^\s<]*)?))/gi;
  for (const match of text.matchAll(pattern)) {
    const url = match[1] || match[0];
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const clean = url.split('?')[0].split('#')[0];
    const ext = clean.split('.').pop()?.toLowerCase() || '';
    const kind = /^(png|jpe?g|webp|gif|avif|heic|heif)$/.test(ext) ? 'image' : /^(mp4|webm|mov|m4v)$/.test(ext) ? 'video' : 'audio';
    const mimeType = kind === 'image' ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : kind === 'video' ? `video/${ext === 'mov' ? 'quicktime' : ext}` : `audio/${ext === 'mp3' ? 'mpeg' : ext}`;
    found.push({ name: `AI ${kind}`, mimeType, kind, url, external: true });
  }
  return found.slice(0, 8);
}

/* =========================================================================
   GEMINI REQUEST LAYER
   ---------------------------------------------------------------------------
   v1.3.0 — root-cause fix for "the AI stopped working even though Settings
   said the connection was verified".

   Three separate faults, all of which produced the same symptom:

   1. A SINGLE HARD-CODED MODEL. `gemini-3.6-flash` was the only model the app
      would ever call. Google retires Gemini model IDs on a rolling schedule
      (2.0 Flash was shut down 2026-06-01, 2.5 Pro in October 2026), and a
      retired ID returns HTTP 404 — so the app breaks one day with no code
      change on our side. That is exactly the "it worked, now it doesn't"
      shape. There is now a fallback chain, and the first model that answers
      is cached in localStorage so later calls go straight to it.

   2. THE TOOLS PAYLOAD WAS NON-NEGOTIABLE. Every request shipped
      `tools: [{ function_declarations: ... }]`. If a model rejects the tool
      schema, the whole conversation fails rather than degrading to plain
      chat. Requests now retry once without tools before giving up.

   3. THE HISTORY WAS MALFORMED. The user's new turn was pushed into
      `state.aiChatMessages` BEFORE queryGemini read it, so the same message
      was sent twice — once inside the replayed history and once as the live
      turn — producing two consecutive `user` roles. `sanitizeHistory()` now
      drops trailing user turns and collapses consecutive same-role turns.

   "Test connection" previously shared this path, which is why it could pass
   on a trivial prompt and still fail in real use; it now reports which model
   actually answered.
   ========================================================================= */

export const GEMINI_MODEL_CHAIN = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-2.5-flash'
];

const GEMINI_MODEL_CACHE_KEY = 'sc_gemini_model';

export function getPreferredGeminiModel() {
  try {
    const saved = localStorage.getItem(GEMINI_MODEL_CACHE_KEY);
    if (saved && GEMINI_MODEL_CHAIN.includes(saved)) return saved;
  } catch (_) {}
  return GEMINI_MODEL_CHAIN[0];
}

function rememberGeminiModel(model) {
  try { localStorage.setItem(GEMINI_MODEL_CACHE_KEY, model); } catch (_) {}
}

/** Models to try, preferred one first, no duplicates. */
function modelsToTry() {
  const preferred = getPreferredGeminiModel();
  return [preferred, ...GEMINI_MODEL_CHAIN.filter(m => m !== preferred)];
}

/** A 404/400-on-model response means this model ID no longer exists — move on
 *  to the next one. Anything else (401/403 bad key, 429 quota, 5xx outage) is
 *  a real error the user needs to see, so we surface it immediately rather
 *  than burning through the whole chain and reporting the last one. */
function isModelUnavailable(status, message = '') {
  if (status === 404) return true;
  const m = String(message).toLowerCase();
  return status === 400 && (m.includes('not found') || m.includes('not supported') || m.includes('unsupported model'));
}

function isToolSchemaRejection(status, message = '') {
  if (status !== 400) return false;
  const m = String(message).toLowerCase();
  return m.includes('function') || m.includes('tool') || m.includes('declaration');
}

/** Gemini requires contents to alternate user/model and to end on a user
 *  turn. Replaying raw UI state violated both. */
function sanitizeHistory(messages) {
  const turns = (messages || [])
    .filter(m => !m.isThinking && m.text)
    .slice(-10)
    .map(m => ({
      role: m.sender === 'user' ? 'user' : 'model',
      parts: [{ text: String(m.text).replace(/<[^>]+>/g, '').trim() }]
    }))
    .filter(t => t.parts[0].text);

  // Drop trailing user turns — the live turn is appended separately and would
  // otherwise be duplicated.
  while (turns.length && turns[turns.length - 1].role === 'user') turns.pop();
  // History must open on a user turn.
  while (turns.length && turns[0].role === 'model') turns.shift();

  // Collapse any remaining consecutive same-role turns.
  const merged = [];
  for (const turn of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) last.parts[0].text += `\n\n${turn.parts[0].text}`;
    else merged.push(turn);
  }
  return merged;
}

async function callGeminiOnce(model, payload, apiKey) {
  // Hard-stop browser requests so the composer can never spin forever.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (networkError) {
    const err = new Error(networkError?.name === 'AbortError' ? 'Gemini took too long to respond. Please try again.' : 'Could not reach the Gemini API. Check your internet connection.');
    err.status = networkError?.name === 'AbortError' ? 408 : 0;
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const err = new Error(data.error?.message || `Gemini API error ${res.status}${res.statusText ? `: ${res.statusText}` : ''}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Runs one full request (including any tool-call rounds) against one model. */
async function runGeminiConversation(model, basePayload, apiKey, allowTools) {
  const payload = allowTools
    ? basePayload
    : { systemInstruction: basePayload.systemInstruction, contents: basePayload.contents };

  for (let round = 0; round < 4; round++) {
    const data = await callGeminiOnce(model, payload, apiKey);

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const calls = parts.filter(p => p.functionCall?.name);

    if (!calls.length) {
      const responseText = parts.map(p => p.text || '').join('').trim();
      if (responseText) return responseText;
      // A blocked prompt returns no parts but does say why.
      const blockReason = data.promptFeedback?.blockReason || candidate?.finishReason;
      throw new Error(blockReason && blockReason !== 'STOP'
        ? `The AI returned no answer (${blockReason}).`
        : 'The AI returned an empty response.');
    }

    payload.contents.push(candidate.content);
    const functionResponses = [];
    for (const call of calls) {
      const name = call.functionCall.name;
      const args = call.functionCall.args || {};
      try {
        const result = await executeGeminiTool(name, args);
        functionResponses.push({
          functionResponse: {
            id: call.functionCall.id,
            name,
            response: result
          }
        });
      } catch (error) {
        functionResponses.push({ functionResponse: { name, response: { ok: false, error: error.message } } });
      }
    }
    payload.contents.push({ role: 'user', parts: functionResponses });
  }

  throw new Error('The AI action sequence reached its safety limit.');
}

export async function queryGemini(userText, attachments = [], options = {}) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('Add your Gemini API key in Settings before using the AI workspace.');

  const attachmentParts = await prepareGeminiFileParts(attachments, apiKey);
  const currentParts = [{ text: userText }, ...attachmentParts];
  const history = sanitizeHistory(state.aiChatMessages);

  const buildPayload = () => ({
    systemInstruction: { parts: [{ text: buildGeminiSystemPrompt() }] },
    contents: [...history.map(t => ({ role: t.role, parts: [...t.parts] })), { role: 'user', parts: currentParts }],
    tools: [{ function_declarations: APP_FUNCTION_DECLARATIONS }]
  });

  let lastError = null;

  for (const model of modelsToTry()) {
    for (const allowTools of [true, false]) {
      try {
        const text = await runGeminiConversation(model, buildPayload(), apiKey, allowTools);
        rememberGeminiModel(model);
        state.aiLastModel = model;
        state.aiToolsDisabled = !allowTools;
        if (options.returnMeta) return { text, model, toolsEnabled: allowTools };
        return text;
      } catch (error) {
        lastError = error;
        const status = error.status;
        // This model ID is gone — stop retrying it and try the next model.
        if (isModelUnavailable(status, error.message)) break;
        // The tool schema was rejected — retry the same model without tools.
        if (allowTools && isToolSchemaRejection(status, error.message)) continue;
        // Authentication errors cannot be fixed by switching models. Rate
        // limits and transient provider outages can be model-specific,
        // however, so keep the fallback chain alive for 429/5xx responses.
        if (status === 401 || status === 403 || status === 0) {
          throw error;
        }
        if (status === 429 || (status >= 500 && status < 600)) {
          continue;
        }
        break;
      }
    }
  }

  throw lastError || new Error('The AI service could not be reached.');
}

function renderAiAssistantModal() {
  if (!state.aiAssistantOpen) return '';
  const attachments = state.aiAttachments || [];
  const hasMessages = (state.aiChatMessages || []).some(m => !m.isThinking);
  return `
    <div class="modal-overlay open ai-workspace-overlay" id="ai-assistant-modal-overlay">
      <section class="ai-workspace" role="dialog" aria-modal="true" aria-label="School Center AI workspace">
        <header class="ai-workspace-head">
          <div class="ai-workspace-title"><span class="ai-workspace-spark">${icon('spark')}</span><span>AI</span><span class="ai-launch-dot ${state.aiConnectionState}" aria-hidden="true"></span></div>
          <button class="icon-btn sm" id="close-ai-assistant-modal" type="button" aria-label="Close AI workspace">${icon('close')}</button>
        </header>
        <div class="ai-chat-stream" id="ai-chat-stream" role="log" aria-live="polite">
          ${!hasMessages && !state.aiIsThinking ? `<div class="ai-empty-state"><div class="ai-empty-symbol">${icon('spark')}</div><h2>How can I help?</h2><p>Ask about your courses, files, notes, assignments, schedule, or anything you need to organize.</p></div>` : ''}
          ${(state.aiChatMessages || []).map(m => {
            if (m.isThinking) return `<div class="ai-bubble assistant thinking"><div class="ai-typing-dots"><span></span><span></span><span></span></div><span class="ai-thinking-label">Working…</span></div>`;
            const files = (m.attachments || []).map(name => `<span class="ai-message-file">${icon('doc')}<span>${escapeHtml(name)}</span></span>`).join('');
            return `<div class="ai-message ${m.sender === 'user' ? 'user' : 'assistant'}">${files ? `<div class="ai-message-files">${files}</div>` : ''}<div class="ai-message-body">${m.text || ''}</div></div>`;
          }).join('')}
        </div>
        <div class="ai-composer-shell">
          ${attachments.length ? `<div class="ai-attachment-row">${attachments.map((f,i)=>`<span class="ai-attachment-chip">${icon('doc')}<span>${escapeHtml(f.name)}</span><button type="button" data-ai-remove-file="${i}" aria-label="Remove ${escapeHtml(f.name)}">${icon('close')}</button></span>`).join('')}</div>` : ''}
          <div class="ai-composer">
            <button class="ai-composer-icon" id="ai-attach-btn" type="button" aria-label="Attach a file" title="Attach files">${icon('plus')}</button>
            <textarea id="ai-chat-input" class="ai-composer-input" rows="1" placeholder="Message School Center AI…" ${state.aiIsThinking ? 'disabled' : ''}></textarea>
            <button class="ai-composer-icon ai-mic-button ${state.aiTranscribing ? 'active' : ''}" id="ai-mic-btn" type="button" aria-label="Use microphone" title="Transcribe speech" ${state.aiIsThinking ? 'disabled' : ''}>${icon('mic')}</button>
            <button class="ai-send-button" id="ai-chat-send" type="button" aria-label="Send message" title="Send" ${state.aiIsThinking ? 'disabled' : ''}>${icon('arrowUp')}</button>
          </div>
          <input id="ai-file-input" type="file" hidden multiple accept="*/*" />
          <div class="ai-composer-status"><span id="ai-live-transcript">${state.aiTranscribing ? 'Listening…' : ''}</span><span>${attachments.length ? `${attachments.length} attachment${attachments.length === 1 ? '' : 's'}` : 'Files and microphone are available here'}</span></div>
        </div>
      </section>
    </div>
  `;
}

/* =========================================================================
   EVENT HANDLERS ATTACHMENT
   ========================================================================= */
function attachEventHandlers() {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => {
      state.view = el.getAttribute('data-nav');
      state.courseId = null;
      render();
    });
  });

  const closeSync = document.getElementById('close-sync-drawer');
  if (closeSync) closeSync.addEventListener('click', () => { state.syncDrawerOpen = false; render(); });
  const syncBackdrop = document.getElementById('sync-drawer-backdrop');
  if (syncBackdrop) syncBackdrop.addEventListener('click', e => { if (e.target === syncBackdrop) { state.syncDrawerOpen = false; render(); } });
  const syncPull = document.getElementById('sync-pull-btn');
  if (syncPull) syncPull.addEventListener('click', async () => {
    showToast('Syncing School Center…');
    try {
      await syncDataFromSupabase();
      await pullCloudDataToLocal();
      showToast('Cloud sync complete ✓');
    } catch (err) {
      showToast(err?.message?.includes('Sign in') ? err.message : 'Sync unavailable — continuing locally');
    }
    render();
  });
  const syncPush = document.getElementById('sync-push-btn');
  if (syncPush) syncPush.addEventListener('click', async () => {
    showToast('Pushing notes & assignments to the cloud…');
    try {
      await pushLocalDataToCloud();
      showToast('Pushed to cloud ✓');
    } catch (err) {
      showToast(err?.message?.includes('Sign in') ? err.message : 'Push failed — check your connection and try again.');
    }
    render();
  });
  const openSyncDetails = document.getElementById('open-sync-details-btn');
  if (openSyncDetails) openSyncDetails.addEventListener('click', () => { state.syncDrawerOpen = true; render(); });

  const manualSync = document.getElementById('manual-sync-btn');
  if (manualSync) manualSync.addEventListener('click', async () => {
    showToast('Syncing School Center…');
    try {
      await syncDataFromSupabase();
      await fullTwoWaySync();
      state.dataSyncLastError = null;
      showToast('Cloud sync complete ✓');
    } catch (err) {
      // Show the real reason instead of a generic message — a table missing
      // because a migration wasn't run, or an expired session, look very
      // different from a genuine network drop and need different fixes.
      const msg = err?.message || 'Unknown error';
      state.dataSyncLastError = msg;
      showToast(`Sync failed: ${msg}`);
    }
    render();
  });

  const saveCloud = document.getElementById('save-cloud-settings-btn');
  if (saveCloud) saveCloud.addEventListener('click', async () => {
    const url = document.getElementById('supabase-url-field')?.value.trim() || '';
    const key = document.getElementById('supabase-key-field')?.value.trim() || '';
    if (!url || !key) { showToast('Enter both Supabase fields first.'); return; }
    saveSupabaseConfig(url, key);
    // A config change invalidates any cached session from the old project —
    // clear it so the rebuilt client starts authenticated-free instead of
    // immediately failing every query with a foreign-token 401.
    await resetSupabaseAuthState({ purgeStoredConfig: false });
    showToast('Cloud configuration saved.');
    await syncDataFromSupabase();
    render();
  });

  const saveMoreAiKeyBtn = document.getElementById('save-more-ai-key-btn');
  if (saveMoreAiKeyBtn) saveMoreAiKeyBtn.addEventListener('click', () => {
    const input = document.getElementById('more-gemini-key-field');
    if (input?.value.trim()) { setGeminiApiKey(input.value.trim()); showToast('AI connection saved.'); render(); }
  });
  const testGeminiBtn = document.getElementById('test-gemini-btn');
  if (testGeminiBtn) testGeminiBtn.addEventListener('click', async () => {
    showToast('Testing AI connection…');
    try {
      // returnMeta so the toast names the model that actually answered. The
      // old test said "verified" without saying which model responded, so a
      // silently-retired primary model looked like a healthy connection.
      const result = await queryGemini('Reply with exactly: Connection verified.', [], { returnMeta: true });
      state.aiConnectionState = 'ready';
      showToast(`AI connected via ${result.model}${result.toolsEnabled ? '' : ' (tools unavailable)'}`);
    } catch (err) {
      state.aiConnectionState = 'attention';
      showToast(`AI connection error: ${err.message}`);
    } finally { render(); }
  });

  const unifiedNav = document.querySelector('[data-nav="ai"]');
  if (unifiedNav) unifiedNav.addEventListener('click', () => { state.view = 'ai'; state.searchQuery = ''; render(); setTimeout(() => document.getElementById('ai-chat-input')?.focus(), 40); });

  const aiAttachBtn = document.getElementById('ai-attach-btn');
  const aiFileInput = document.getElementById('ai-file-input');
  if (aiAttachBtn && aiFileInput) {
    aiAttachBtn.addEventListener('click', () => aiFileInput.click());
    aiFileInput.addEventListener('change', () => {
      const files = Array.from(aiFileInput.files || []);
      if (!files.length) return;
      state.aiAttachments = [...(state.aiAttachments || []), ...files].slice(0, 12);
      aiFileInput.value = '';
      state.aiConnectionState = 'ready';
      render();
      setTimeout(() => document.getElementById('ai-chat-input')?.focus(), 30);
    });
  }
  document.querySelectorAll('[data-ai-remove-file]').forEach(btn => btn.addEventListener('click', () => {
    const index = Number(btn.getAttribute('data-ai-remove-file'));
    state.aiAttachments.splice(index, 1);
    render();
  }));



  const aiChatBody = document.getElementById('ai-page-body');
  if (aiChatBody) {
    aiChatBody.addEventListener('click', async e => {
      const editBtn = e.target.closest('[data-ai-edit]');
      const deleteBtn = e.target.closest('[data-ai-delete]');
      const cancelBtn = e.target.closest('[data-ai-cancel-edit]');
      const saveBtn = e.target.closest('[data-ai-save-edit]');
      const searchHit = e.target.closest('[data-unified-search-type]');
      if (searchHit) {
        const courseId = searchHit.getAttribute('data-course');
        const tab = searchHit.getAttribute('data-tab') || 'overview';
        const assignmentId = searchHit.getAttribute('data-assignment');
        if (courseId) {
          state.courseId = courseId;
          state.courseTab = tab === 'assignments' ? 'assignments' : tab === 'notes' ? 'notes' : tab === 'materials' ? 'materials' : tab === 'deadlines' ? 'deadlines' : 'overview';
          state.view = 'courses';
        } else if (assignmentId) {
          state.assignmentDetailId = assignmentId;
          state.view = 'courses';
        }
        state.searchQuery = '';
        render();
        return;
      }
      if (editBtn) { state.aiEditingMessageId = editBtn.getAttribute('data-ai-edit'); render(); return; }
      if (cancelBtn) { state.aiEditingMessageId = null; render(); return; }
      if (saveBtn) {
        const id = saveBtn.getAttribute('data-ai-save-edit');
        const input = document.getElementById(`ai-edit-input-${id}`);
        const newText = input ? input.value : '';
        const msg = state.aiChatMessages.find(m => m.id === id);
        if (msg) msg.text = newText;
        state.aiEditingMessageId = null;
        render();
        try { await updateAiMessageText(id, newText); } catch (_) {}
        return;
      }
      if (deleteBtn) {
        const id = deleteBtn.getAttribute('data-ai-delete');
        state.aiChatMessages = state.aiChatMessages.filter(m => m.id !== id);
        render();
        try { await deleteAiMessage(id); } catch (_) {}
        return;
      }
    });
  }
  const clearChatBtn = document.getElementById('ai-clear-chat-btn');
  if (clearChatBtn) clearChatBtn.addEventListener('click', async () => {
    if (!confirm('Clear this entire conversation? This cannot be undone.')) return;
    state.aiChatMessages = [];
    render();
    try { await clearAiConversation(); showToast('Conversation cleared.'); }
    catch (_) { showToast('Cleared locally — cloud clear failed.'); }
  });

  const aiInput = document.getElementById('ai-chat-input');
  const aiSend = document.getElementById('ai-chat-send');
  if (aiInput) {
    const syncAiInput = () => {
      state.searchQuery = aiInput.value;
      const body = document.getElementById('ai-page-body');
      if (!body) return;
      const q = state.searchQuery.trim();
      const direct = q ? performUniversalSearch(q, COURSES) : [];
      state.aiSearchResultsCount = direct.length;
      body.innerHTML = q ? renderAiSearchResultsView(q) : renderAiConversation();
      // Only auto-scroll while browsing the conversation (no active search query).
      // Scrolling on every keystroke while typing a search was the source of the
      // jumpy/glitchy feel reported in the AI & Search page.
      if (!q) {
        body.scrollTo({ top: body.scrollHeight, behavior: 'auto' });
      }
    };
    aiInput.addEventListener('input', () => {
      aiInput.style.height = 'auto';
      aiInput.style.height = `${Math.min(aiInput.scrollHeight, 180)}px`;
      syncAiInput();
    });
  }
  if (aiInput && aiSend) {
    const submit = async () => {
      if (state.aiIsThinking) return;
      const text = aiInput.value.trim();
      const files = [...(state.aiAttachments || [])];
      if (!text && !files.length) return;
      aiActiveAttachments = files;
      state.aiAttachments = [];
      state.searchQuery = '';
      const userLocalIndex = state.aiChatMessages.length;
      state.aiChatMessages.push({ sender: 'user', text: text || 'Please review these attached files.', attachments: [], createdAt: new Date().toISOString() });
      state.aiChatMessages.push({ sender: 'assistant', text: '', isThinking: true, createdAt: new Date().toISOString() });
      state.aiIsThinking = true;
      state.aiConnectionState = 'busy';
      aiInput.value = '';
      render();
      try {
        const persistWithTimeout = (promise, ms = 7000) => Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Cloud history timed out')), ms))
        ]);
        try {
          const savedUser = await persistWithTimeout(persistAiMessage({ sender: 'user', text: text || 'Please review these attached files.', files }));
          state.aiChatMessages[userLocalIndex] = savedUser;
        } catch (historyErr) {
          console.warn('AI user-message cloud persistence skipped:', historyErr);
        }

        const raw = await queryGemini(text || 'Please review the attached files and help me with them.', files);
        const last = state.aiChatMessages.length - 1;
        const generatedMedia = extractAiMediaAttachments(raw);
        try {
          const savedAssistant = await persistWithTimeout(persistAiMessage({ sender: 'assistant', text: raw, attachments: generatedMedia }));
          state.aiChatMessages[last] = savedAssistant;
        } catch (historyErr) {
          console.warn('AI assistant-message cloud persistence skipped:', historyErr);
          state.aiChatMessages[last] = { sender: 'assistant', text: raw, attachments: generatedMedia, createdAt: new Date().toISOString() };
        }
        state.aiConnectionState = 'ready';
        // The AI workspace is also the universal intake point: attached files
        // are filed into the detected course after Gemini has reviewed them.
        // Do not block the AI response on the storage/processing pipeline.
        if (files.length) {
          ingestAiAttachments(files, text).catch(error => console.warn('AI file filing:', error));
        }
      } catch (err) {
        console.error(err);
        const last = state.aiChatMessages.length - 1;
        const safe = String(err.message || 'Unable to connect to the AI service.');
        state.aiChatMessages[last] = { sender: 'assistant', text: safe, isThinking: false, createdAt: new Date().toISOString() };
        state.aiConnectionState = 'attention';
      } finally {
        aiActiveAttachments = [];
        state.aiIsThinking = false;
        render();
        setTimeout(() => { const body = document.getElementById('ai-page-body'); if (body) body.scrollTop = body.scrollHeight; }, 30);
      }
    };
    aiSend.addEventListener('click', submit);
    aiInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
  }

  const aiMicBtn = document.getElementById('ai-mic-btn');
  if (aiMicBtn) aiMicBtn.addEventListener('click', toggleAiLiveTranscription);

  const calViewToggle = document.getElementById('cal-view-toggle-btn');
  if (calViewToggle) calViewToggle.addEventListener('click', () => {
    const goingMonth = state.calendarViewMode !== 'month';
    state.calendarViewMode = goingMonth ? 'month' : 'week';
    if (goingMonth) {
      const sel = new Date(state.selectedCalendarDay);
      state.monthCalendarYear = sel.getFullYear();
      state.monthCalendarMonth = sel.getMonth();
    } else {
      // Returning to the weekly strip: center it near the selected day.
      state.selectedCalendarDay = new Date(state.selectedCalendarDay).toDateString();
    }
    render();
  });
  const monthPrev = document.getElementById('month-cal-prev');
  if (monthPrev) monthPrev.addEventListener('click', () => { if (state.monthCalendarMonth === 0) { state.monthCalendarMonth = 11; state.monthCalendarYear--; } else state.monthCalendarMonth--; render(); });
  const monthNext = document.getElementById('month-cal-next');
  if (monthNext) monthNext.addEventListener('click', () => { if (state.monthCalendarMonth === 11) { state.monthCalendarMonth = 0; state.monthCalendarYear++; } else state.monthCalendarMonth++; render(); });
  const monthToday = document.getElementById('month-cal-today');
  if (monthToday) monthToday.addEventListener('click', () => { const now = new Date(); state.monthCalendarYear = now.getFullYear(); state.monthCalendarMonth = now.getMonth(); state.selectedCalendarDay = now.toDateString(); render(); });
  document.querySelectorAll('[data-cal-day]').forEach(cell => cell.addEventListener('click', () => { state.selectedCalendarDay = cell.getAttribute('data-cal-day'); render(); }));

  const quickSearchBtn = document.getElementById('quick-search-btn');
  if (quickSearchBtn) quickSearchBtn.addEventListener('click', () => { state.spotlightSearchOpen = true; state.spotlightQuery = ''; render(); setTimeout(() => document.getElementById('spotlight-search-input')?.focus(), 50); });
  const closeSpotlight = document.getElementById('close-spotlight-modal');
  if (closeSpotlight) closeSpotlight.addEventListener('click', () => { state.spotlightSearchOpen = false; state.spotlightQuery = ''; render(); });
  const spotlightOverlay = document.getElementById('spotlight-modal-overlay');
  if (spotlightOverlay) spotlightOverlay.addEventListener('click', e => { if (e.target === spotlightOverlay) { state.spotlightSearchOpen = false; state.spotlightQuery = ''; render(); } });
  const spotlightInput = document.getElementById('spotlight-search-input');
  if (spotlightInput) spotlightInput.addEventListener('input', e => {
    // Repaint ONLY the results list: rebuilding the whole modal on every
    // keystroke destroyed and recreated the focused input each character,
    // which was the visible "spotlight flicker". The input itself is left
    // untouched, so focus and the caret position survive naturally.
    state.spotlightQuery = e.target.value;
    const resultsHost = document.querySelector('.spotlight-results');
    if (!resultsHost) { render(); return; }
    const probe = document.createElement('div');
    try { probe.innerHTML = renderSpotlightModal(); } catch (_) { render(); return; }
    const nextResults = probe.querySelector('.spotlight-results');
    if (nextResults) resultsHost.replaceWith(nextResults);
    document.querySelectorAll('[data-spotlight-nav]').forEach(item => item.addEventListener('click', () => {
      const navType = item.getAttribute('data-spotlight-nav'); const targetId = item.getAttribute('data-spotlight-id'); state.spotlightSearchOpen = false;
      if (navType === 'course') { state.courseId = targetId; state.view = 'courses'; state.courseTab = 'overview'; }
      else if (navType === 'asg') state.assignmentDetailId = targetId;
      else if (navType === 'note') state.view = 'settings';
      render();
    }));
  });
  document.querySelectorAll('[data-spotlight-nav]').forEach(item => item.addEventListener('click', () => {
    const navType = item.getAttribute('data-spotlight-nav'); const targetId = item.getAttribute('data-spotlight-id'); state.spotlightSearchOpen = false;
    if (navType === 'course') { state.courseId = targetId; state.view = 'courses'; state.courseTab = 'overview'; }
    else if (navType === 'asg') state.assignmentDetailId = targetId;
    else if (navType === 'note') state.view = 'settings';
    render();
  }));

  document.querySelectorAll('[data-course-id]').forEach(el => el.addEventListener('click', async () => {
    state.courseId = el.getAttribute('data-course-id');
    state.view = 'courses';
    state.courseTab = 'overview';
    render();
    // Foreground hydrate on course open guarantees the user sees the cloud
    // library even if the initial background sync finished too early/failed.
    await syncDataFromSupabase();
  }));
  const courseBack = document.getElementById('course-back-btn');
  if (courseBack) courseBack.addEventListener('click', () => { state.courseId = null; render(); });
  document.querySelectorAll('[data-course-tab]').forEach(el => el.addEventListener('click', async () => {
    state.courseTab = el.getAttribute('data-course-tab');
    render();
    if (state.courseTab === 'materials') await syncDataFromSupabase();
  }));

  const focusBtn = document.getElementById('quick-focus-btn');
  if (focusBtn) focusBtn.addEventListener('click', () => {
    if (!focusModeInstance) focusModeInstance = new FocusMode({ onExit: () => render(), onNoteSaved: () => showToast('Focus notes saved ✓') });
    focusModeInstance.start(state.courseId || 'math15325d', 25); render();
  });
  const seeAllAsg = document.getElementById('see-all-asg');
  if (seeAllAsg) seeAllAsg.addEventListener('click', () => { state.view = 'courses'; state.courseId = null; render(); });
  document.querySelectorAll('.date-strip-cell[data-daykey]').forEach(el => el.addEventListener('click', () => { state.selectedCalendarDay = el.getAttribute('data-daykey'); render(); }));
  document.querySelectorAll('[data-agenda-course-id]').forEach(el => el.addEventListener('click', () => { state.courseId = el.getAttribute('data-agenda-course-id'); state.view = 'courses'; state.courseTab = 'overview'; render(); }));
  document.querySelectorAll('[data-agenda-asg-id]').forEach(el => el.addEventListener('click', () => { state.assignmentDetailId = el.getAttribute('data-agenda-asg-id'); render(); }));
  const addDeadlineBtn = document.getElementById('add-deadline-btn');
  if (addDeadlineBtn) addDeadlineBtn.addEventListener('click', () => { state.assignmentModalOpen = true; state.assignmentModalPreset = { dueDate: state.selectedCalendarDay }; render(); });
  const addAsgBtn = document.getElementById('add-assignment-btn');
  if (addAsgBtn) addAsgBtn.addEventListener('click', () => { state.assignmentModalOpen = true; state.assignmentModalPreset = { courseId: state.courseId }; render(); });
  document.querySelectorAll('[data-open-asg-id]').forEach(el => el.addEventListener('click', e => { if (e.target.matches('input') || e.target.closest('input')) return; state.assignmentDetailId = el.getAttribute('data-open-asg-id'); render(); }));
  document.querySelectorAll('[data-deadline-done]').forEach(el => el.addEventListener('click', () => {
    deadlinesManager.updateDeadline(el.getAttribute('data-deadline-done'), { status: 'done' });
    showToast('Deadline completed ✓');
    render();
  }));
  document.querySelectorAll('[data-asg-check]').forEach(el => el.addEventListener('change', () => {
    const assignment = assignmentsManager.getById(el.getAttribute('data-asg-check')); const check = assignment?.requirementsChecklist?.find(c => c.id === el.getAttribute('data-check-id')); if (assignment && check) { check.done = !check.done; assignmentsManager.updateAssignment(assignment.id, assignment); }
  }));
  const addCourseNoteBtn = document.getElementById('add-course-note-btn');
  if (addCourseNoteBtn) addCourseNoteBtn.addEventListener('click', () => { state.noteModalOpen = true; state.noteModalPreset = { courseId: state.courseId }; render(); });
  document.querySelectorAll('[data-ai-note]').forEach(btn => btn.addEventListener('click', async () => { try { await notesManager.runAIStudyAction(btn.getAttribute('data-note-id'), btn.getAttribute('data-ai-note')); showToast('Note updated ✓'); render(); } catch (e) { showToast(`Note action failed: ${e.message}`); } }));
  const triggerUpload = document.getElementById('trigger-upload-modal');
  if (triggerUpload) triggerUpload.addEventListener('click', () => {
    const course = courseById(state.courseId);
    if (!course) { showToast('Select a course first.'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.pdf,.txt,.md,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.xlsm,.csv,.html,.htm,.css,.js,.json,.png,.jpg,.jpeg,.gif,.webp,.heic,.heif,.mlx,.epw,.ddy,.stat';
    input.addEventListener('change', async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;
      if (!course.dbId) await syncDataFromSupabase();
      const refreshedCourse = courseById(state.courseId);
      if (!refreshedCourse?.dbId) {
        showToast('This course is not connected to the cloud database yet.');
        return;
      }
      for (const file of files) {
        try {
          showToast(`Uploading ${file.name}…`);
          await uploadAndProcessFile({
            file, course: refreshedCourse,
            onProgress: progress => { if (progress?.text) showToast(progress.text); },
            onLog: () => {}
          });
        } catch (err) {
          showToast(`Upload failed: ${err?.message || 'Unknown error'}`);
        }
      }
      await syncDataFromSupabase();
      showToast('Course material uploaded and saved ✓');
    });
    input.click();
  });

  const retryMaterialsBtn = document.getElementById('retry-materials-btn');
  if (retryMaterialsBtn) retryMaterialsBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    showToast('Reloading course materials…');
    try {
      // Re-arm the self-heal so an explicit user retry always gets one more
      // config-reset + retry cycle, even if boot already used it.
      syncHealAttempted = false;
      const ok = await syncDataFromSupabase();
      if (ok) showToast('Course materials loaded ✓');
      else if (state.materialsSyncError) showToast('Materials still unavailable. See the course page for details.');
    } catch (err) {
      showToast(`Retry failed: ${err?.message || 'Unknown error'}`);
    }
  });

  const resetCloudConfigBtn = document.getElementById('reset-cloud-config-btn');
  if (resetCloudConfigBtn) resetCloudConfigBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    showToast('Resetting cloud connection…');
    try {
      await resetSupabaseAuthState({ purgeStoredConfig: true });
      const ok = await syncDataFromSupabase();
      showToast(ok ? 'Cloud connection repaired ✓' : 'Still failing — check the course page for the error.');
    } catch (err) {
      showToast(`Reset failed: ${err?.message || 'Unknown error'}`);
    }
  });

  attachCampusMapHandlers();
  initCampusMap3d();
  document.querySelectorAll('[data-show-location]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const buildingId = btn.dataset.showLocation;
      if (state.view !== 'today') {
        state.view = 'today';
        render();
        requestAnimationFrame(() => highlightBuilding(buildingId));
      } else {
        highlightBuilding(buildingId);
      }
    });
  });

  const syncBannerSignin = document.getElementById('sync-banner-signin-btn');
  if (syncBannerSignin) syncBannerSignin.addEventListener('click', () => { state.view = 'settings'; render(); });
  const syncBannerDismiss = document.getElementById('sync-banner-dismiss-btn');
  if (syncBannerDismiss) syncBannerDismiss.addEventListener('click', () => { state.syncBannerDismissed = true; render(); });

  const closeAssignment = document.getElementById('close-assignment-modal');
  if (closeAssignment) closeAssignment.addEventListener('click', () => { state.assignmentModalOpen = false; render(); });
  const assignmentBackdrop = document.getElementById('assignment-modal-overlay');
  if (assignmentBackdrop) assignmentBackdrop.addEventListener('click', e => { if (e.target === assignmentBackdrop) { state.assignmentModalOpen = false; render(); } });
  const saveAssignmentBtn = document.getElementById('save-assignment-btn');
  if (saveAssignmentBtn) saveAssignmentBtn.addEventListener('click', () => {
    const title = document.getElementById('asg-title-input')?.value.trim() || '';
    const courseId = document.getElementById('asg-course-select')?.value || state.courseId || null;
    const dueDate = document.getElementById('asg-due-input')?.value || new Date().toISOString();
    const priority = document.getElementById('asg-priority-select')?.value || 'medium';
    const description = document.getElementById('asg-desc-input')?.value.trim() || '';
    const checks = Array.from(document.querySelectorAll('#asg-checklist-container .checklist-item span')).map(el => ({ id: 'c_' + Math.random().toString(36).slice(2,8), text: el.textContent.trim(), done: false }));
    if (!title) { showToast('Enter an assignment title.'); return; }
    assignmentsManager.createAssignment({ title, courseId, dueDate, priority, description, requirementsChecklist: checks });
    state.assignmentModalOpen = false; state.assignmentModalPreset = {};
    showToast('Assignment saved ✓'); render();
  });
  const assignmentCancel = document.getElementById('close-assignment-modal-cancel');
  if (assignmentCancel) assignmentCancel.addEventListener('click', () => { state.assignmentModalOpen = false; render(); });
  const closeNote = document.getElementById('close-note-modal');
  if (closeNote) closeNote.addEventListener('click', () => { state.noteModalOpen = false; render(); });
  const noteBackdrop = document.getElementById('note-modal-overlay');
  if (noteBackdrop) noteBackdrop.addEventListener('click', e => { if (e.target === noteBackdrop) { state.noteModalOpen = false; render(); } });
  const saveNoteBtn = document.getElementById('save-note-btn');
  if (saveNoteBtn) saveNoteBtn.addEventListener('click', () => {
    const title = document.getElementById('note-title-input')?.value.trim() || '';
    const content = document.getElementById('note-content-input')?.value.trim() || '';
    const courseId = document.getElementById('note-course-select')?.value || null;
    const tags = (document.getElementById('note-tags-input')?.value || '').split(',').map(x => x.trim()).filter(Boolean);
    if (!title && !content) { showToast('Add a note title or content.'); return; }
    notesManager.createNote({ title: title || 'Untitled Note', content, courseId, tags });
    state.noteModalOpen = false; state.noteModalPreset = {};
    showToast('Note saved ✓'); render();
  });
  const noteCancel = document.getElementById('close-note-modal-cancel');
  if (noteCancel) noteCancel.addEventListener('click', () => { state.noteModalOpen = false; render(); });
  document.querySelectorAll('[data-delete-note]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-delete-note');
    if (!confirm('Delete this note? This cannot be undone.')) return;
    if (notesManager.deleteNote(id)) { showToast('Note deleted.'); render(); }
  }));

  const themeButtons = document.querySelectorAll('[data-theme-key]');
  themeButtons.forEach(btn => btn.addEventListener('click', () => {
    const key = btn.getAttribute('data-theme-key');
    const t = THEME_PRESETS[key];
    if (!t) return;
    applyTheme(t, true);
    showToast(`${t.label} theme applied.`);
    render();
  }));
  const accentInputs = [document.getElementById('accent-color-input'), document.getElementById('accent-color-input-inline')].filter(Boolean);
  // applyCustomAccent() already persists and pushes to the cloud, and the
  // theme lives on CSS custom properties, so no repaint is needed at all.
  // The old 'change' -> render() call rebuilt the whole page the moment the
  // picker closed — pure flicker with zero effect.
  accentInputs.forEach(input => input.addEventListener('input', e => applyCustomAccent(e.target.value, true)));
  const lavaSlider = document.getElementById('lava-slider');
  if (lavaSlider) lavaSlider.addEventListener('input', e => {
    const value = Number(e.target.value); document.documentElement.style.setProperty('--bg-glow', String(value)); document.documentElement.style.setProperty('--lava-opacity', String(value)); localStorage.setItem('sc_lava_opacity', String(value)); if (!applyingRemoteTheme) pushThemeToCloud().catch(() => {});
  });

  const aiPasswordSignin = document.getElementById('ai-signin-password-btn');
  if (aiPasswordSignin) aiPasswordSignin.addEventListener('click', async () => {
    const password = document.getElementById('ai-signin-password')?.value || '';
    if (!password) { showToast('Enter the account password.'); return; }
    aiPasswordSignin.disabled = true;
    aiPasswordSignin.textContent = 'Signing in…';
    try {
      await signInWithAccountPassword(password);
      showToast('Signed in ✓ — sync started');
    } catch (e) {
      showToast(`Sign-in failed: ${e.message}`);
    } finally {
      aiPasswordSignin.disabled = false;
      aiPasswordSignin.textContent = 'Sign in';
    }
  });
  const aiSignout = document.getElementById('ai-signout-btn');
  if (aiSignout) aiSignout.addEventListener('click', async () => { try { await signOutAiCloud(); await stopThemeCloudSync(); stopAutomaticDataSync(); if (aiHistoryUnsubscribe) { aiHistoryUnsubscribe(); aiHistoryUnsubscribe = null; } state.aiCloudUser=null; state.aiCloudConnected=false; render(); showToast('Signed out.'); } catch (e) { showToast(e.message); } });
  const closeAssignmentDetail = document.getElementById('close-asg-detail-modal');
  if (closeAssignmentDetail) closeAssignmentDetail.addEventListener('click', () => { state.assignmentDetailId = null; render(); });
  const assignmentDetailOverlay = document.getElementById('asg-detail-modal-overlay');
  if (assignmentDetailOverlay) assignmentDetailOverlay.addEventListener('click', e => { if (e.target === assignmentDetailOverlay) { state.assignmentDetailId = null; render(); } });
  const closeFlash = document.getElementById('close-flashcards-modal');
  if (closeFlash) closeFlash.addEventListener('click', () => { state.flashcardsModalOpen = false; render(); });
  document.querySelectorAll('[data-flashcard-next]').forEach(b => b.addEventListener('click', () => { state.flashcardIndex++; render(); }));

  if (!window._sc_keydown_attached) {
    window._sc_keydown_attached = true;
    window.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); state.spotlightSearchOpen = true; state.spotlightQuery = ''; render(); setTimeout(() => document.getElementById('spotlight-search-input')?.focus(), 50); return; }
      if (e.key === 'Escape') {
        if (state.aiAssistantOpen) { stopAiLiveTranscription(); state.aiAssistantOpen = false; }
        state.spotlightSearchOpen = false; state.syncDrawerOpen = false; state.assignmentModalOpen = false; state.noteModalOpen = false; state.flashcardsModalOpen = false; state.assignmentDetailId = null;
        render();
      }
    });
  }
}


async function stopAiLiveTranscription() {
  if (!aiLiveTranscriber) return;
  try { await aiLiveTranscriber.stop(); } catch (_) {}
  aiLiveTranscriber = null;
  state.aiTranscribing = false;
  state.aiLiveTranscript = '';
}

async function toggleAiLiveTranscription() {
  if (state.aiTranscribing) {
    await stopAiLiveTranscription();
    render();
    return;
  }
  const apiKey = getGeminiApiKey();
  if (!apiKey) { showToast('Add your Gemini API key in Settings first.'); return; }
  state.aiConnectionState = 'busy';
  aiLiveTranscriber = new GeminiLiveTranscriber({
    apiKey,
    fetchEphemeralToken: async () => {
      try { return await getEphemeralLiveToken(); } catch (error) { console.warn('Secure live token unavailable:', error); return null; }
    },
    customVocabulary: ['School Center','Linear Algebra','MATH 15325D','ENGR 36035D','ENGR 43301D','Energy Systems','Economics & Entrepreneurship','Gemini','Supabase'],
    onStatus: status => {
      if (status === 'connecting' || status === 'listening') state.aiTranscribing = true;
      if (status === 'stopped' || status === 'closed') state.aiTranscribing = false;
      render();
      setTimeout(() => {
        const live = document.getElementById('ai-live-transcript');
        if (live) live.textContent = state.aiTranscribing ? 'Listening…' : '';
      }, 0);
    },
    onInterim: text => {
      state.aiLiveTranscript = text || '';
      const live = document.getElementById('ai-live-transcript');
      if (live) live.textContent = text ? `Listening… ${text}` : 'Listening…';
    },
    onFinal: text => {
      const input = document.getElementById('ai-chat-input');
      if (input && text) {
        const spacer = input.value && !/\s$/.test(input.value) ? ' ' : '';
        input.value += `${spacer}${text}`;
        input.focus();
      }
      state.aiLiveTranscript = '';
      const live = document.getElementById('ai-live-transcript');
      if (live) live.textContent = 'Listening…';
    },
    onError: message => {
      console.error('Live transcription:', message);
      state.aiTranscribing = false;
      state.aiConnectionState = 'attention';
      showToast(message);
      render();
    }
  });
  try {
    await aiLiveTranscriber.start();
    state.aiConnectionState = 'ready';
  } catch (error) {
    await stopAiLiveTranscription();
    state.aiConnectionState = 'attention';
    showToast(error.message || 'Microphone transcription could not start.');
  }
  render();
}


function showToast(msg) {
  const existing = document.querySelector('.settings-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'settings-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

/* =========================================================================
   INITIALIZATION & BOOTSTRAP (Fail-Safe)
   ========================================================================= */
function bootstrap() {
  try {
    // 1. Force immediate layout render so the viewport is never left blank
    render();

    // 3. Safe Theme initialization
    try {
      const savedAccent = localStorage.getItem('sc_custom_accent');
      const savedThemeKey = localStorage.getItem('sc_theme_key');
      if (savedAccent) applyCustomAccent(savedAccent, false);
      else applyTheme(THEME_PRESETS[savedThemeKey] || THEME_PRESETS.violet, false);
      const savedOpacity = localStorage.getItem('sc_lava_opacity');
      if (savedOpacity !== null) {
        document.documentElement.style.setProperty('--bg-glow', savedOpacity);
        document.documentElement.style.setProperty('--lava-opacity', savedOpacity);
      }
    } catch (themeErr) {
      console.warn('Theme apply skipped:', themeErr);
    }

    // 4. Safe Jobs subscription
    try {
      jobsManager.subscribe(() => {
        try {
          if (state.view === 'settings') render();
        } catch (e) {}
      });
    } catch (jobErr) {
      console.warn('Jobs subscriber skipped:', jobErr);
    }

    // 4b. Redraw immediately when another device changes a Note/Assignment.
    // Local edits already render through their normal UI handlers; this listener
    // handles remote Realtime changes without requiring a tab switch or button.
    try {
      window.addEventListener('schoolcenter:data-sync-changed', (e) => {
        const detail = e?.detail || {};
        if (detail.realtime) state.dataSyncRealtime = detail.realtime;
        if (detail.type === 'error') {
          state.dataSyncLastError = detail.message || 'Unknown sync error';
        } else if (detail.type === 'ok') {
          state.dataSyncLastError = null;
          state.dataSyncLastOkAt = Date.now();
        } else if (detail.type === 'realtime') {
          // Not an error: live updates are down but the reconciliation poll
          // is covering for them. Recorded separately so the status line can
          // say "syncing (periodic)" instead of either lying or alarming.
          state.dataSyncRealtimeNote = detail.message || '';
        }
        if (state.view === 'courses' || state.view === 'today' || state.view === 'calendar' || state.view === 'settings') render();
      });
    } catch (e) {}

    // v1.3.0: this unconditional call was REMOVED. It used to fire here, and
    // then onAuthStateChange and loadAiChatHistory() each fired their own
    // startAutomaticDataSync() milliseconds later. All three raced: each
    // awaited getCurrentAiUser(), then each called attachRealtime() and
    // subscribed a channel on the SAME topic name. supabase-js rejects a
    // repeat subscribe on a live topic, so the surviving channel could land
    // in CHANNEL_ERROR while the earlier ones leaked — realtime cross-device
    // sync silently died even though the app reported "Connected".
    // startAutomaticDataSync() is now single-flight internally (see
    // data-sync.js) AND is only invoked from the auth-state path below.

    // 5. Restore cross-device AI history when a Supabase session exists.
    try {
      const sb = getSupabase();
      sb?.auth?.onAuthStateChange(async (_event, session) => {
        state.aiCloudUser = session?.user || null;
        const result = await loadAiChatHistory().catch(() => ({ user: state.aiCloudUser, messages: [], cloud: false }));
        if (result.user) state.aiCloudUser = result.user;
        state.aiCloudConnected = !!result.cloud;
        if (Array.isArray(result.messages)) state.aiChatMessages = result.messages;
        state.aiHistoryLoaded = true;
        if (state.aiCloudUser?.id) {
          startThemeCloudSync(state.aiCloudUser.id).catch(e => console.warn('Appearance sync start:', e));
          startAutomaticDataSync().then(() => { if (state.view === 'courses' || state.view === 'today') render(); }).catch(e => console.warn('Data sync start:', e));
        } else {
          stopThemeCloudSync().catch(() => {});
          stopAutomaticDataSync();
        }
        if (aiHistoryUnsubscribe) { aiHistoryUnsubscribe(); aiHistoryUnsubscribe = null; }
        if (state.aiCloudConnected && state.aiCloudUser?.id) {
          aiHistoryUnsubscribe = await subscribeToAiChatHistory(state.aiCloudUser.id, message => {
            const exists = state.aiChatMessages.some(m => m.id === message.id);
            if (!exists) { state.aiChatMessages.push(message); render(); }
          });
        }
        if (state.view === 'ai' || state.view === 'settings') render();
      });
      loadAiChatHistory().then(async result => {
        state.aiCloudUser = result.user || null;
        state.aiCloudConnected = !!result.cloud;
        if (Array.isArray(result.messages)) state.aiChatMessages = result.messages;
        state.aiHistoryLoaded = true;
        if (state.aiCloudUser?.id) {
          startAutomaticDataSync().then(() => { if (state.view === 'courses' || state.view === 'today') render(); }).catch(e => console.warn('Data sync start:', e));
        }
        if (!aiHistoryUnsubscribe && state.aiCloudConnected && state.aiCloudUser?.id) {
          aiHistoryUnsubscribe = await subscribeToAiChatHistory(state.aiCloudUser.id, message => {
            if (!state.aiChatMessages.some(m => m.id === message.id)) { state.aiChatMessages.push(message); render(); }
          });
        }
        if (state.view === 'ai') render();
      }).catch(() => { state.aiHistoryLoaded = true; });
    } catch (authErr) { console.warn('AI history auth initialization skipped:', authErr); }

    // 5. Asynchronous background cloud sync (non-blocking)
    try {
      setupRealtimeListener(() => {
        syncDataFromSupabase().catch(() => {});
      });
      syncDataFromSupabase().catch((syncErr) => {
        console.warn('Notice: Background course sync using local cache:', syncErr);
      });
    } catch (cloudErr) {
      console.warn('Cloud listener setup skipped:', cloudErr);
    }
  } catch (fatalBootstrapErr) {
    console.error('Fatal bootstrap error:', fatalBootstrapErr);
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = `
        <div style="padding:40px 20px;text-align:center;color:#fff;">
          <h2>School Center</h2>
          <p style="color:#A7B0D6;">Click below to load with standard settings.</p>
          <button class="btn-primary" onclick="localStorage.clear();location.reload();">Reset & Reload</button>
        </div>
      `;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

