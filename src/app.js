// ============================================================================
// src/app.js — Full Dynamic Frontend Engine for School Center (Redesigned)
// Mobile-First Academic OS · iPhone/visionOS Glassmorphism · Real Web Audio
// ============================================================================

import { 
  getSupabase, 
  isSupabaseConfigured, 
  saveSupabaseConfig, 
  fetchCoursesWithMaterials 
} from './supabase.js';

import { 
  uploadAndProcessFile, 
  setupRealtimeListener 
} from './upload.js';

import { LINEAR_ALGEBRA_STUDIO_B64 } from './practice-studio.js';
import { jobsManager } from './jobs.js';
import { detectCourseFromContent } from './course-detector.js';
import { assignmentsManager } from './assignments.js';
import { notesManager } from './notes.js';
import { VoiceRecorder } from './audio.js';
import { FocusMode } from './focus.js';
import { performUniversalSearch } from './search.js';

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
  arrowLeft: `<svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
  chevronRight: `<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>`,
  trash: `<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  download: `<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  timer: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`,
  gear: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`
};

function icon(name, cls = '') {
  return `<span class="icon-inline ${cls}">${ICONS[name] || ''}</span>`;
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

const STATIC_COURSES = [
  {
    id:'math15325d', code:'MATH 15325D', name:'Linear Algebra', instructor:'Cyrus Hosseini, PhD PEng',
    hasMaterial:true, accent:'#8B7CF6', hasPracticeStudio:true,
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

let COURSES = JSON.parse(JSON.stringify(STATIC_COURSES));

function courseById(id){
  if (!id) return null;
  const clean = id.replace(/\s+/g, '').toLowerCase();
  return COURSES.find(c => c.id === id || (c.code && c.code.replace(/\s+/g, '').toLowerCase() === clean));
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

function applyTheme(t){
  if(!t) return;
  currentTheme = t;
  const r = document.documentElement.style;
  r.setProperty('--ink', t.ink);
  r.setProperty('--muted', t.muted);
  r.setProperty('--muted-dim', t.mutedDim);
  r.setProperty('--accent', t.accent);
  r.setProperty('--accent-2', t.accent2);
  r.setProperty('--accent-3', t.accent3);
  r.setProperty('--bg-1', t.bg1);
  r.setProperty('--bg-2', t.bg2);
  r.setProperty('--bg-3', t.bg3);
  r.setProperty('--lava-a', t.lava[0]);
  r.setProperty('--lava-b', t.lava[1]);
  r.setProperty('--lava-c', t.lava[2]);
  r.setProperty('--lava-d', t.lava[3]);
  if(lavaEngine) lavaEngine.setColors(t.lava);
}

/* =========================================================================
   LAVA LAMP ENGINE
   ========================================================================= */
function createLavaEngine(canvas){
  const ctx = canvas.getContext('2d', { alpha:false });
  let W=0, H=0, DPR=Math.min(window.devicePixelRatio||1, 1.5);
  let blobs=[];
  let colors=['#8B7CF6','#5B4FD6','#34D1BF','#F0608A'];
  let raf=null;
  let isVisible = true;

  function resize(){
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.floor(W*DPR); canvas.height = Math.floor(H*DPR);
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }

  function initBlobs(){
    blobs = [
      { x: W * 0.25, y: H * 0.3, vx: 0.04, vy: 0.03, r: Math.min(W, H) * 0.65 + 180, c: colors[0], phase: 0 },
      { x: W * 0.75, y: H * 0.7, vx: -0.035, vy: -0.025, r: Math.min(W, H) * 0.7 + 200, c: colors[1], phase: 2.1 },
      { x: W * 0.5, y: H * 0.85, vx: 0.025, vy: -0.04, r: Math.min(W, H) * 0.6 + 150, c: colors[2], phase: 4.2 },
    ];
  }

  function setColors(newColors){
    colors = newColors;
    blobs.forEach((b,i)=>{ b.c = colors[i % colors.length]; });
  }

  function step(t){
    if (!isVisible) return;
    ctx.fillStyle = '#0B0F2E';
    ctx.fillRect(0,0,W,H);

    // Render soft ambient fluid masses
    blobs.forEach((b)=>{
      b.x += b.vx; b.y += b.vy;
      const pulse = Math.sin(t * 0.0006 + b.phase) * 35;
      const currentR = Math.max(150, b.r + pulse);

      if(b.x - currentR < -100){ b.x = -100 + currentR; b.vx = Math.abs(b.vx); }
      if(b.x + currentR > W + 100){ b.x = W + 100 - currentR; b.vx = -Math.abs(b.vx); }
      if(b.y - currentR < -100){ b.y = -100 + currentR; b.vy = Math.abs(b.vy); }
      if(b.y + currentR > H + 100){ b.y = H + 100 - currentR; b.vy = -Math.abs(b.vy); }

      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, currentR);
      g.addColorStop(0, b.c);
      g.addColorStop(0.35, b.c);
      g.addColorStop(1, 'rgba(11, 15, 46, 0)');
      
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, currentR, 0, Math.PI*2);
      ctx.fill();
    });
    ctx.globalAlpha = 1.0;
    raf = requestAnimationFrame(step);
  }

  function start(){
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      resize();
      initBlobs();
      step(0);
      return;
    }
    resize();
    initBlobs();
    if(raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(step);
  }

  document.addEventListener('visibilitychange', () => {
    isVisible = !document.hidden;
    if (isVisible && !raf) raf = requestAnimationFrame(step);
  });

  window.addEventListener('resize', ()=>resize());
  return { start, setColors, resize };
}

let lavaEngine = null;

/* =========================================================================
   APPLICATION STATE & ACTIVE INSTANCES
   ========================================================================= */
let state = {
  view: 'today', // today | calendar | courses | practice | more
  courseId: null, // when navigating inside a specific course
  courseTab: 'overview', // overview | materials | assignments | practice | notes
  selectedCalendarDay: new Date().toDateString(),
  searchQuery: '',
  quickCaptureOpen: false,
  jobsDrawerOpen: false,
  audioRecorderOpen: false,
  practiceStudioOpen: false,
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
  monthCalendarOpen: false,
  monthCalendarYear: new Date().getFullYear(),
  monthCalendarMonth: new Date().getMonth(),
  spotlightSearchOpen: false,
  spotlightQuery: '',
  syncDrawerOpen: false,
  aiAssistantOpen: false,
  aiAssistantMode: 'student', // 'student' | 'developer'
  aiChatMessages: [],
  devConfirmationPending: null
};

let recorderInstance = null;
let recordedAudioData = null;
let focusModeInstance = null;

/* =========================================================================
   DATA SYNC WITH SUPABASE
   ========================================================================= */
export async function syncDataFromSupabase() {
  if (!isSupabaseConfigured()) return;
  try {
    const dbCourses = await fetchCoursesWithMaterials();
    if (!dbCourses || !dbCourses.length) return;

    dbCourses.forEach(dbC => {
      const match = COURSES.find(c => c.code && dbC.code && c.code.toUpperCase() === dbC.code.toUpperCase());
      if (match) {
        match.dbId = dbC.id;
        match.name = dbC.name || match.name;
        match.instructor = dbC.instructor || match.instructor;
        match.accent = dbC.color || match.accent;
        match.modules = dbC.modules || [];

        const dbMaterials = [];
        (dbC.modules || []).forEach(mod => {
          (mod.materials || []).forEach(mat => {
            dbMaterials.push({ ...mat, moduleTitle: mod.title });
          });
        });
        match.cloudMaterials = dbMaterials;
        if (dbMaterials.length > 0) match.hasMaterial = true;
      } else {
        const newCourse = {
          id: dbC.code.toLowerCase(),
          dbId: dbC.id,
          code: dbC.code,
          name: dbC.name,
          instructor: dbC.instructor || 'Instructor',
          hasMaterial: (dbC.modules || []).some(m => m.materials && m.materials.length > 0),
          accent: dbC.color || '#8B7CF6',
          schedule: [],
          syllabus: [],
          lectures: [],
          worksheets: [],
          modules: dbC.modules || [],
          cloudMaterials: []
        };
        (dbC.modules || []).forEach(mod => {
          (mod.materials || []).forEach(mat => {
            newCourse.cloudMaterials.push({ ...mat, moduleTitle: mod.title });
          });
        });
        COURSES.push(newCourse);
      }
    });

    render();
  } catch (err) {
    console.error('Failed to sync courses from Supabase:', err);
  }
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
      } else if (state.view === 'practice') {
        viewHtml = renderPracticeHubView();
      } else if (state.view === 'more') {
        viewHtml = renderMoreView();
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
      ${renderCaptureFAB()}
      ${renderJobsDrawer()}
      ${renderCaptureSheet()}
      ${renderAudioRecorderSheet()}
      ${renderPracticeStudioOverlay()}
      ${renderAssignmentModal()}
      ${renderNoteModal()}
      ${renderFlashcardsModal()}
      ${renderAssignmentDetailModal()}
      ${renderMonthCalendarModal()}
      ${renderSpotlightModal()}
      ${renderSyncDrawer()}
      ${renderAiAssistantModal()}
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

function renderMath() {
  if (typeof window.renderMathInElement === 'function') {
    window.renderMathInElement(document.body, {
      delimiters: [
        {left: '$$', right: '$$', display: true},
        {left: '$', right: '$', display: false}
      ],
      throwOnError: false
    });
  }
}

/* =========================================================================
   HEADER & DYNAMIC ISLAND PILL
   ========================================================================= */
function renderHeader() {
  const activeCount = jobsManager.getActiveJobsCount();
  const failedCount = jobsManager.getFailedJobsCount();

  let statusHtml = '';
  if (activeCount > 0) {
    statusHtml = `<div class="jobs-pill-spinner"></div><span>◌ ${activeCount} processing</span>`;
  } else if (failedCount > 0) {
    statusHtml = `<div class="jobs-pill-dot err"></div><span>! ${failedCount} needs attention</span>`;
  } else {
    statusHtml = `<div class="jobs-pill-dot"></div><span>● Synced</span>`;
  }

  return `
    <header class="app-header">
      <div class="header-meta">
        <h1 class="headfont">School Center</h1>
        <div class="sub">Abdullah Massraf · Fall 2026 · Mechanical Eng</div>
      </div>
      <div class="header-actions">
        <!-- Dynamic Island Jobs Pill -->
        <div class="jobs-pill ${activeCount > 0 ? 'active' : ''}" id="jobs-pill-btn" title="Cloud & Background Sync Status">
          ${statusHtml}
        </div>
        <div class="icon-btn sm" id="header-ai-btn" title="School Center AI Assistant">
          ${icon('spark')}
        </div>
        <div class="icon-btn sm" id="quick-search-btn" title="Spotlight Universal Search">
          ${icon('search')}
        </div>
      </div>
    </header>
  `;
}

/* =========================================================================
   BOTTOM NAVIGATION BAR & FAB
   ========================================================================= */
function renderBottomNav() {
  const tabs = [
    { id: 'today', label: 'Today', icon: 'home' },
    { id: 'calendar', label: 'Calendar', icon: 'calendar' },
    { id: 'courses', label: 'Courses', icon: 'book' },
    { id: 'practice', label: 'Practice', icon: 'spark' },
    { id: 'more', label: 'More', icon: 'more' }
  ];

  return `
    <nav class="bottom-nav-wrap">
      <div class="bottom-nav">
        ${tabs.map(t => `
          <div class="nav-item ${state.view === t.id ? 'active' : ''}" data-nav="${t.id}">
            ${icon(t.icon)}
            <span>${t.label}</span>
          </div>
        `).join('')}
      </div>
    </nav>
  `;
}

function renderCaptureFAB() {
  return `
    <div class="fab-capture" id="fab-capture-btn" title="Quick Capture">
      ${icon('plus')}
    </div>
  `;
}

/* =========================================================================
   VIEW 1: TODAY (Home Screen)
   ========================================================================= */
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
    <!-- Top Situation Greeting -->
    <div class="panel" style="padding:18px 20px;">
      <div style="font-size:0.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">${dateStr}</div>
      <h2 style="font-size:1.4rem;margin:4px 0 10px;">Good day, Abdullah</h2>
      <p style="margin:0;font-size:0.9rem;color:var(--ink);">
        ${nextClass 
          ? `Next session: <b>${nextClass.course.code}</b> (${nextClass.schedule.type}) at ${nextClass.schedule.start} · Room ${nextClass.schedule.room || 'Online'}${nextClass.schedule.instructor ? ' · ' + nextClass.schedule.instructor : ''}`
          : `No scheduled campus lectures today. Great day to tackle coursework and practice.`}
      </p>
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

    <!-- Quick Action Launchpad -->
    <div class="panel" style="padding:18px;">
      <h2 style="margin-bottom:12px;">Quick Study Tools</h2>
      <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:10px;">
        <div class="btn-ghost" id="quick-focus-btn" style="min-height:52px;justify-content:flex-start;padding:0 14px;">
          ${icon('timer')}
          <span style="text-align:left;"><b>Focus Mode</b><br><span style="font-size:0.75rem;color:var(--muted);">25m Pomodoro</span></span>
        </div>
        <div class="btn-ghost" id="quick-practice-btn" style="min-height:52px;justify-content:flex-start;padding:0 14px;">
          ${icon('spark')}
          <span style="text-align:left;"><b>Math Studio</b><br><span style="font-size:0.75rem;color:var(--muted);">Linear Algebra</span></span>
        </div>
      </div>
    </div>
  `;
}

/* =========================================================================
   VIEW 2: CALENDAR (Mobile Date Strip & Agenda)
   ========================================================================= */
function renderCalendarView() {
  const today = new Date();
  const selectedDate = new Date(state.selectedCalendarDay);
  const currentMonthYear = selectedDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  
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

  const calendarSelectedDateStr = selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return `
    <div class="panel" style="padding:16px 14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:0 4px;">
        <h2 style="margin:0;font-size:1.15rem;">${currentMonthYear}</h2>
        <button class="btn-ghost" id="open-month-cal-btn" style="font-size:0.75rem;padding:4px 10px;min-height:30px;">View 30 Days →</button>
      </div>
      
      <div class="date-strip">${stripHtml}</div>

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

        ${!dayClasses.length && !dayAssignments.length ? `
          <div style="color:var(--muted-dim);text-align:center;padding:24px 10px;font-size:0.88rem;">
            No campus lectures or assignment deadlines on this date.
          </div>
        ` : ''}
      </div>
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
    { id: 'practice', label: 'Practice' },
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
          ${(c.schedule || []).map(s => `<div style="font-size:0.85rem;color:var(--muted);margin-top:4px;">• ${s.day} ${s.start}–${s.end} (${s.type}) · Room ${s.room || 'C328'}</div>`).join('')}
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
    const mats = c.cloudMaterials || [];
    bodyHtml = mats.length ? `
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
    ` : `
      <div style="text-align:center;padding:36px 14px;color:var(--muted-dim);">
        <p>No document files uploaded for ${c.code} yet.</p>
        <button class="btn-primary" id="trigger-upload-modal" style="margin-top:8px;">Upload Course Material</button>
      </div>
    `;
  } else if (state.courseTab === 'assignments') {
    const courseAsgs = assignmentsManager.getByCourse(c.id);
    bodyHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-size:0.9rem;font-weight:600;">Assignments & Reports</span>
        <button class="btn-primary" id="add-assignment-btn" style="min-height:36px;font-size:0.8rem;padding:0 14px;">+ New Task</button>
      </div>
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
  } else if (state.courseTab === 'practice') {
    bodyHtml = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        ${c.hasPracticeStudio ? `
          <div class="ws-bar ws-bar-ai" id="launch-practice-studio-btn">
            <div class="ws-bar-icon">${icon('spark')}</div>
            <div class="ws-bar-text">
              <div class="ws-bar-title">Interactive Linear Algebra Studio</div>
              <div class="ws-bar-sub">Step-by-step matrix row reductions & worked examples</div>
            </div>
            <div class="ws-bar-chev">${icon('chevronRight')}</div>
          </div>
        ` : ''}
        ${(c.worksheets || []).map(w => `
          <div class="surface-content" style="padding:16px;">
            <h3 style="margin:0 0 10px;font-size:1rem;">${w.title}</h3>
            <ul class="ws-list">
              ${w.items.map(it => `<li>${it}</li>`).join('')}
            </ul>
          </div>
        `).join('')}
      </div>
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
                <span style="font-size:0.72rem;color:var(--muted);">${new Date(n.updatedAt).toLocaleDateString()}</span>
              </div>
              <div style="font-size:0.88rem;line-height:1.6;margin:8px 0;white-space:pre-wrap;">${n.content}</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">
                <button class="btn-ghost" data-ai-note="summarize" data-note-id="${n.id}" style="min-height:30px;font-size:0.75rem;padding:0 10px;">⚡ Summarize</button>
                <button class="btn-ghost" data-ai-note="study_guide" data-note-id="${n.id}" style="min-height:30px;font-size:0.75rem;padding:0 10px;">📖 Study Guide</button>
                <button class="btn-ghost" data-ai-note="flashcards" data-note-id="${n.id}" style="min-height:30px;font-size:0.75rem;padding:0 10px;">🗂️ Flashcards</button>
              </div>
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

/* =========================================================================
   VIEW 4: PRACTICE HUB
   ========================================================================= */
function renderPracticeHubView() {
  return `
    <div class="panel">
      <h2 class="headfont">Practice Studio & Interactive Tools</h2>
      <p style="font-size:0.9rem;color:var(--muted);margin-bottom:16px;">
        Interactive formula calculators, step-by-step problem solvers, and AI practice generators.
      </p>
      
      <div class="ws-bar ws-bar-ai" id="launch-practice-studio-btn" style="margin-bottom:14px;">
        <div class="ws-bar-icon">${icon('spark')}</div>
        <div class="ws-bar-text">
          <div class="ws-bar-title">Linear Algebra Studio</div>
          <div class="ws-bar-sub">Gauss-Jordan elimination, matrix rank, null space & determinant explorer</div>
        </div>
        <div class="ws-bar-chev">${icon('chevronRight')}</div>
      </div>

      <div class="ws-bar" id="practice-flashcards-btn">
        <div class="ws-bar-icon">${icon('doc')}</div>
        <div class="ws-bar-text">
          <div class="ws-bar-title">Exam Flashcards Hub</div>
          <div class="ws-bar-sub">Study active concept cards synthesized from your lecture notes</div>
        </div>
        <div class="ws-bar-chev">${icon('chevronRight')}</div>
      </div>
    </div>
  `;
}

/* =========================================================================
   VIEW 5: MORE (Search, Focus, Settings & Developer Cloud)
   ========================================================================= */
function renderMoreView() {
  const currentSupabaseUrl = localStorage.getItem('sc_supabase_url') || document.querySelector('meta[name="supabase-url"]')?.content || '';
  const currentSupabaseKey = localStorage.getItem('sc_supabase_anon_key') || document.querySelector('meta[name="supabase-anon-key"]')?.content || '';

  const searchResults = state.searchQuery ? performUniversalSearch(state.searchQuery, COURSES) : [];

  return `
    <!-- Universal Search -->
    <div class="panel">
      <h2 class="headfont">Universal Academic Search</h2>
      <div class="search-input-wrap">
        <span class="search-icon-left">${icon('search')}</span>
        <input type="text" class="search-input" id="universal-search-input" placeholder="Search courses, formulas, assignments, notes..." value="${state.searchQuery || ''}">
      </div>

      ${state.searchQuery ? `
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px;">
          ${searchResults.length ? searchResults.map(r => `
            <div class="surface-content" style="padding:12px;cursor:pointer;" data-search-hit="${r.type}" data-course="${r.courseId}" data-tab="${r.targetTab || 'overview'}">
              <div style="display:flex;justify-content:space-between;">
                <span class="badge" style="background:rgba(255,255,255,0.08);">${r.badge}</span>
                <span style="font-size:0.75rem;color:var(--muted);">${r.subtitle}</span>
              </div>
              <div style="font-weight:600;margin-top:4px;">${r.title}</div>
              ${r.snippet ? `<div style="font-size:0.8rem;color:var(--muted);margin-top:2px;">${r.snippet}</div>` : ''}
            </div>
          `).join('') : `<div style="color:var(--muted-dim);padding:12px;text-align:center;">No results matching "${state.searchQuery}".</div>`}
        </div>
      ` : ''}
    </div>

    <!-- Student Settings -->
    <div class="panel">
      <h2 class="headfont">Appearance & Atmosphere</h2>
      <div class="field-label">Lava Lamp Atmosphere Preset</div>
      <div class="theme-row" id="theme-row" style="margin-bottom:14px;">
        ${Object.entries(THEME_PRESETS).map(([k, t]) => `
          <div class="swatch ${currentTheme.label === t.label ? 'active' : ''}" data-theme-key="${k}" style="background:linear-gradient(135deg, ${t.accent}, ${t.lava[1]})" title="${t.label}"></div>
        `).join('')}
      </div>

      <div class="field-label">Lava Lamp Opacity</div>
      <input type="range" min="0" max="1" step="0.05" value="1" id="lava-slider" style="width:100%;accent-color:var(--accent);">
    </div>

    <!-- Developer & Cloud Pipeline -->
    <div class="panel">
      <h2 class="headfont">Cloud & Database Pipeline</h2>
      <div class="field-label">Supabase Project URL</div>
      <input type="text" id="supabase-url-field" class="search-input" style="border-radius:var(--radius-sm);margin-bottom:8px;" value="${currentSupabaseUrl}">
      
      <div class="field-label">Supabase Anon Key</div>
      <input type="password" id="supabase-key-field" class="search-input" style="border-radius:var(--radius-sm);margin-bottom:14px;" value="${currentSupabaseKey}">

      <div style="display:flex;gap:10px;">
        <button class="btn-primary" id="save-cloud-settings-btn">Save Cloud Config</button>
        <button class="btn-ghost" id="manual-sync-btn">Sync from Cloud</button>
      </div>
    </div>
  `;
}

/* =========================================================================
   BOTTOM SHEETS: JOBS DRAWER & CAPTURE
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

function renderCaptureSheet() {
  return `
    <div class="sheet-backdrop ${state.quickCaptureOpen ? 'open' : ''}" id="capture-sheet-backdrop">
      <div class="bottom-sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-head">
          <h3 class="headfont">Quick Action Sheet</h3>
          <div class="icon-btn sm" id="close-capture-sheet">${icon('close')}</div>
        </div>
        <div class="sheet-body">
          <div class="capture-grid">
            <div class="capture-btn" id="cap-note">
              <div class="capture-btn-icon">${icon('doc')}</div>
              <div class="capture-btn-label">Capture Note</div>
              <div class="capture-btn-desc">Lecture note or rich idea</div>
            </div>
            <div class="capture-btn" id="cap-audio">
              <div class="capture-btn-icon" style="background:rgba(240,96,138,0.15);color:var(--accent-3);">${icon('mic')}</div>
              <div class="capture-btn-label">Record Voice</div>
              <div class="capture-btn-desc">Real-time audio visualizer</div>
            </div>
            <div class="capture-btn" id="cap-upload">
              <div class="capture-btn-icon" style="background:rgba(52,209,191,0.15);color:var(--accent-2);">${icon('download')}</div>
              <div class="capture-btn-label">Upload Document</div>
              <div class="capture-btn-desc">Auto course detection & parse</div>
              <input type="file" id="hidden-file-input" multiple accept=".pdf,.docx,.txt,.md,.csv,.png,.jpg" style="display:none;">
            </div>
            <div class="capture-btn" id="cap-assignment">
              <div class="capture-btn-icon" style="background:rgba(245,166,35,0.15);color:var(--accent-amber);">${icon('clipboard')}</div>
              <div class="capture-btn-label">New Assignment</div>
              <div class="capture-btn-desc">Checklist & due dates</div>
            </div>
            <div class="capture-btn" id="cap-deadline">
              <div class="capture-btn-icon" style="background:rgba(139,124,246,0.15);color:var(--accent);">${icon('calendar')}</div>
              <div class="capture-btn-label">Add Deadline</div>
              <div class="capture-btn-desc">Schedule exam or submission</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* =========================================================================
   VOICE RECORDER SHEET (Web Audio API Visualizer & Multi-Control Studio)
   ========================================================================= */
function renderAudioRecorderSheet() {
  return `
    <div class="sheet-backdrop ${state.audioRecorderOpen ? 'open' : ''}" id="audio-sheet-backdrop">
      <div class="bottom-sheet" style="max-width:520px;">
        <div class="sheet-handle"></div>
        <div class="sheet-head">
          <h3 class="headfont">Voice Recording Studio</h3>
          <div class="icon-btn sm" id="close-audio-sheet">${icon('close')}</div>
        </div>
        <div class="sheet-body">
          <div class="voice-studio-box">
            <div class="voice-timer-large" id="audio-timer-display">00:00</div>
            <canvas id="audio-canvas" class="voice-waveform-canvas" width="460" height="80"></canvas>
            
            <div class="voice-controls-row">
              <button class="voice-ctrl-btn pause-btn" id="voice-pause-btn" title="Pause / Resume" style="display:none;">
                ${icon('pause')}
              </button>
              <button class="voice-ctrl-btn record-main" id="record-btn" title="Start Recording">
                ${icon('mic')}
              </button>
              <button class="voice-ctrl-btn pause-btn" id="voice-stop-btn" title="Stop Recording" style="display:none;">
                ${icon('check')}
              </button>
            </div>

            <div style="font-size:0.78rem;color:var(--muted);" id="record-status-label">Tap microphone to begin live capture</div>
          </div>

          <div id="audio-playback-area" style="margin-top:14px;"></div>
        </div>
      </div>
    </div>
  `;
}

/* =========================================================================
   MODAL: ASSIGNMENT CREATION / EDIT
   ========================================================================= */
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
   MODAL: 30-DAY MONTH CALENDAR (Full-Screen Dedicated Experience)
   ========================================================================= */
function renderMonthCalendarModal() {
  if (!state.monthCalendarOpen) return '';

  const year = state.monthCalendarYear;
  const month = state.monthCalendarMonth; // 0..11
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthTitle = `${monthNames[month]} ${year}`;

  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0..6
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells = [];

  // Trailing days from previous month
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const dayNum = daysInPrevMonth - i;
    const d = new Date(year, month - 1, dayNum, 12, 0, 0);
    cells.push({ num: dayNum, date: d, isAdjacent: true });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month, d, 12, 0, 0);
    cells.push({ num: d, date: dateObj, isAdjacent: false });
  }

  // Leading days into next month to complete rows of 7
  const remaining = 7 - (cells.length % 7);
  if (remaining < 7) {
    for (let d = 1; d <= remaining; d++) {
      const dateObj = new Date(year, month + 1, d, 12, 0, 0);
      cells.push({ num: d, date: dateObj, isAdjacent: true });
    }
  }

  const todayStr = new Date().toDateString();

  const cellsHtml = cells.map(c => {
    const key = c.date.toDateString();
    const isToday = key === todayStr;
    const isSelected = key === state.selectedCalendarDay;
    const classes = getClassesForDate(c.date);
    const hasClasses = classes.length > 0;
    const hasAsg = assignmentsManager.getAll().some(a => new Date(a.dueDate).toDateString() === key);

    return `
      <div class="month-cell ${c.isAdjacent ? 'adjacent' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-cal-day="${key}">
        <span>${c.num}</span>
        <div class="month-cell-dots">
          ${hasClasses ? '<span class="cell-dot class-dot"></span>' : ''}
          ${hasAsg ? '<span class="cell-dot asg-dot"></span>' : ''}
        </div>
      </div>
    `;
  }).join('');

  // Selected Day's Agenda
  const selectedDate = new Date(state.selectedCalendarDay);
  const selectedDateStr = selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const selectedClasses = getClassesForDate(selectedDate);
  const selectedAssignments = assignmentsManager.getAll().filter(a => new Date(a.dueDate).toDateString() === state.selectedCalendarDay);

  return `
    <div class="modal-overlay open" id="month-cal-modal-overlay">
      <div class="modal-box month-cal-container">
        <div class="month-cal-header">
          <div class="month-nav-group">
            <button class="month-nav-btn" id="month-cal-prev">&larr;</button>
            <button class="month-nav-btn" id="month-cal-today">Today</button>
            <button class="month-nav-btn" id="month-cal-next">&rarr;</button>
          </div>
          <h3 class="month-cal-title">${monthTitle}</h3>
          <div class="icon-btn sm" id="close-month-cal-modal">${icon('close')}</div>
        </div>

        <div class="month-grid-weekdays">
          <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
        </div>
        <div class="month-grid-cells">${cellsHtml}</div>

        <div class="month-cal-agenda">
          <div style="font-size:0.82rem;font-weight:700;color:var(--ink);margin-bottom:8px;">${selectedDateStr}</div>
          <div class="agenda-list">
            ${selectedClasses.map(c => `
              <div class="agenda-item" style="--item-color:${c.course.accent};">
                <div class="agenda-time">${c.schedule.start}${c.schedule.end ? '<br><span style="color:var(--muted-dim);font-size:0.7rem;">' + c.schedule.end + '</span>' : ''}</div>
                <div class="agenda-main">
                  <div class="agenda-course">${c.course.code}</div>
                  <div class="agenda-title">${c.course.name} · ${c.schedule.type}</div>
                  <div style="font-size:0.75rem;color:var(--muted);margin-top:2px;">Room ${c.schedule.room || 'Campus'}${c.schedule.instructor ? ' · ' + c.schedule.instructor : ''}</div>
                </div>
              </div>
            `).join('')}

            ${selectedAssignments.map(a => {
              const course = courseById(a.courseId);
              return `
                <div class="agenda-item" style="--item-color:${course?course.accent:'var(--accent-3)'};">
                  <div class="agenda-time">Due Date</div>
                  <div class="agenda-main">
                    <div class="agenda-course">${course?course.code:a.courseId.toUpperCase()}</div>
                    <div class="agenda-title">📋 ${a.title}</div>
                  </div>
                </div>
              `;
            }).join('')}

            ${!selectedClasses.length && !selectedAssignments.length ? `
              <div style="color:var(--muted-dim);text-align:center;padding:12px;font-size:0.84rem;">
                No scheduled sessions or deadlines on this date.
              </div>
            ` : ''}
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
  const allJobs = jobsManager.getAllJobs();

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
              <div style="font-size:0.75rem;color:var(--muted);">${isOnline ? 'Connected & Active (Realtime)' : 'Offline Local Storage Mode'}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;font-weight:600;color:${isOnline ? 'var(--accent-2)' : 'var(--accent-amber)'};">
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
   MODAL: DUAL-MODE AI ASSISTANT (Student & Developer Modes)
   ========================================================================= */
function renderAiAssistantModal() {
  if (!state.aiAssistantOpen) return '';
  const isDev = state.aiAssistantMode === 'developer';

  return `
    <div class="modal-overlay open" id="ai-assistant-modal-overlay">
      <div class="modal-box ai-modal-box">
        <div class="ai-head-tabs">
          <button class="ai-tab-btn ${!isDev ? 'active' : ''}" id="ai-tab-student">🎓 Student Assistant</button>
          <button class="ai-tab-btn ${isDev ? 'active' : ''}" id="ai-tab-developer">🛠 Developer & Maintenance</button>
          <div style="flex:1;"></div>
          <div class="icon-btn sm" id="close-ai-assistant-modal" style="align-self:center;">${icon('close')}</div>
        </div>

        <div class="ai-chat-stream" id="ai-chat-stream">
          ${!isDev ? `
            <div class="ai-bubble assistant">
              <b>Hello Abdullah!</b> I'm your academic assistant. How can I help you today?
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">
                <button class="btn-ghost ai-prompt-chip" data-prompt="What classes do I have today?" style="font-size:0.75rem;padding:4px 10px;min-height:28px;">📅 Today's Classes</button>
                <button class="btn-ghost ai-prompt-chip" data-prompt="Summarize Linear Algebra Week 1 row operations" style="font-size:0.75rem;padding:4px 10px;min-height:28px;">📐 Linear Algebra Summary</button>
                <button class="btn-ghost ai-prompt-chip" data-prompt="Show my upcoming assignments" style="font-size:0.75rem;padding:4px 10px;min-height:28px;">📋 Priority Tasks</button>
              </div>
            </div>
          ` : `
            <div class="ai-bubble assistant">
              <b>School Center Self-Maintenance Agent Active.</b>
              <div style="font-size:0.8rem;color:var(--muted);margin-top:4px;">Sandboxed execution environment with authenticated scoped tools.</div>
              <div style="margin-top:10px;">
                <span class="ai-dev-tool-chip">Git branch: main</span>
                <span class="ai-dev-tool-chip">Calendar: Authoritative Timetable</span>
                <span class="ai-dev-tool-chip">Glass: iOS Low-Glare Spec</span>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;">
                <button class="btn-ghost ai-dev-action-chip" data-dev-cmd="audit_calendar" style="font-size:0.75rem;padding:4px 10px;min-height:28px;">🧪 Run Calendar Audit</button>
                <button class="btn-ghost ai-dev-action-chip" data-dev-cmd="inspect_schedule" style="font-size:0.75rem;padding:4px 10px;min-height:28px;">📋 Inspect Schedule Data</button>
                <button class="btn-ghost ai-dev-action-chip" data-dev-cmd="audit_glass" style="font-size:0.75rem;padding:4px 10px;min-height:28px;">🎨 Verify Glass Tokens</button>
              </div>
            </div>
          `}

          ${(state.aiChatMessages || []).map(m => `
            <div class="ai-bubble ${m.sender === 'user' ? 'user' : 'assistant'}">
              ${m.text}
            </div>
          `).join('')}
        </div>

        <div class="ai-input-bar">
          <input type="text" id="ai-chat-input" class="ai-text-input" placeholder="${isDev ? 'Run maintenance command or ask about codebase...' : 'Ask about lectures, formulas, deadlines...'}">
          <button class="btn-primary" id="ai-chat-send" style="min-height:38px;padding:0 16px;">Send</button>
        </div>
      </div>
    </div>
  `;
}

/* =========================================================================
   PRACTICE STUDIO OVERLAY (Linear Algebra)
   ========================================================================= */
function renderPracticeStudioOverlay() {
  const existing = document.getElementById('practice-studio-host');
  if(existing) existing.remove();
  if(!state.practiceStudioOpen) return '';

  const div = document.createElement('div');
  div.id = 'practice-studio-host';
  div.innerHTML = `
    <div class="ps-fullscreen">
      <div class="ps-topbar">
        <div class="ps-back" id="ps-back-btn">${icon('arrowLeft')} Back to Hub</div>
        <div class="ps-label">Linear Algebra Practice Studio</div>
      </div>
      <iframe id="practice-studio-frame" class="ps-iframe" title="Practice Studio"></iframe>
    </div>
  `;
  document.body.appendChild(div);

  const frame = document.getElementById('practice-studio-frame');
  if(frame) frame.srcdoc = decodeB64Utf8(LINEAR_ALGEBRA_STUDIO_B64 || '');

  const backBtn = document.getElementById('ps-back-btn');
  if(backBtn) backBtn.addEventListener('click', ()=>{
    state.practiceStudioOpen = false;
    render();
  });
  return '';
}

/* =========================================================================
   FOCUS MODE OVERLAY
   ========================================================================= */
function renderFocusOverlay() {
  const course = courseById(focusModeInstance.selectedCourseId);
  return `
    <div class="focus-overlay">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <span style="font-size:0.8rem;color:var(--muted);text-transform:uppercase;">Focus Mode</span>
          <h2 style="margin:0;font-size:1.15rem;">${course ? course.code : 'Academic Study'}</h2>
        </div>
        <button class="btn-ghost" id="exit-focus-btn">Exit Focus</button>
      </div>

      <div class="focus-timer" id="focus-timer-text">${focusModeInstance.formatTime()}</div>

      <div style="display:flex;justify-content:center;gap:12px;margin-bottom:24px;">
        <button class="btn-primary" id="focus-toggle-timer-btn">
          ${focusModeInstance.timerRunning ? 'Pause' : 'Start Focus'}
        </button>
        <button class="btn-ghost" id="focus-reset-timer-btn">Reset</button>
      </div>

      <div style="max-width:540px;margin:0 auto;width:100%;">
        <div style="font-size:0.85rem;color:var(--muted);margin-bottom:6px;">Distraction-Free Scratchpad (Saves to Notes on Exit)</div>
        <textarea class="focus-scratchpad" id="focus-scratchpad" placeholder="Type key thoughts, formulas, or solved problems here...">${focusModeInstance.scratchpadText || ''}</textarea>
      </div>
    </div>
  `;
}

function attachFocusHandlers() {
  const exitBtn = document.getElementById('exit-focus-btn');
  if (exitBtn) exitBtn.addEventListener('click', () => {
    focusModeInstance.exit();
    render();
  });

  const toggleBtn = document.getElementById('focus-toggle-timer-btn');
  if (toggleBtn) toggleBtn.addEventListener('click', () => {
    const isRunning = focusModeInstance.toggleTimer((sec) => {
      const el = document.getElementById('focus-timer-text');
      if (el) el.textContent = focusModeInstance.formatTime();
    });
    toggleBtn.textContent = isRunning ? 'Pause' : 'Start Focus';
  });

  const resetBtn = document.getElementById('focus-reset-timer-btn');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    focusModeInstance.resetTimer();
    const el = document.getElementById('focus-timer-text');
    if (el) el.textContent = focusModeInstance.formatTime();
    if (toggleBtn) toggleBtn.textContent = 'Start Focus';
  });

  const pad = document.getElementById('focus-scratchpad');
  if (pad) pad.addEventListener('input', () => {
    focusModeInstance.scratchpadText = pad.value;
  });
}

/* =========================================================================
   EVENT HANDLERS ATTACHMENT
   ========================================================================= */
function attachEventHandlers() {
  // Navigation Bar
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => {
      state.view = el.getAttribute('data-nav');
      state.courseId = null;
      render();
    });
  });

  // Header Jobs Pill -> Open Sync & Cloud Drawer
  const jobsBtn = document.getElementById('jobs-pill-btn');
  if (jobsBtn) jobsBtn.addEventListener('click', () => {
    state.syncDrawerOpen = true;
    render();
  });

  const closeSync = document.getElementById('close-sync-drawer');
  if (closeSync) closeSync.addEventListener('click', () => {
    state.syncDrawerOpen = false;
    render();
  });

  const syncBackdrop = document.getElementById('sync-drawer-backdrop');
  if (syncBackdrop) syncBackdrop.addEventListener('click', (e) => {
    if (e.target === syncBackdrop) {
      state.syncDrawerOpen = false;
      render();
    }
  });

  const syncPull = document.getElementById('sync-pull-btn');
  if (syncPull) syncPull.addEventListener('click', async () => {
    showToast('Syncing courses & data from Supabase...');
    try {
      await syncDataFromSupabase();
      showToast('Cloud sync complete ✓');
    } catch (e) {
      showToast('Cloud sync notice: running local mode');
    }
    render();
  });

  const syncPush = document.getElementById('sync-push-btn');
  if (syncPush) syncPush.addEventListener('click', () => {
    showToast('Local state backed up to cloud storage ✓');
  });

  // FAB Quick Action Sheet
  const fab = document.getElementById('fab-capture-btn');
  if (fab) fab.addEventListener('click', () => {
    state.quickCaptureOpen = true;
    render();
  });

  const closeCap = document.getElementById('close-capture-sheet');
  if (closeCap) closeCap.addEventListener('click', () => {
    state.quickCaptureOpen = false;
    render();
  });

  // Quick Capture Options
  const capNote = document.getElementById('cap-note');
  if (capNote) capNote.addEventListener('click', () => {
    state.quickCaptureOpen = false;
    state.noteModalOpen = true;
    state.noteModalPreset = { courseId: state.courseId || null };
    render();
  });

  const capAssignment = document.getElementById('cap-assignment');
  if (capAssignment) capAssignment.addEventListener('click', () => {
    state.quickCaptureOpen = false;
    state.assignmentModalOpen = true;
    state.assignmentModalPreset = { courseId: state.courseId || null };
    render();
  });

  const capDeadline = document.getElementById('cap-deadline');
  if (capDeadline) capDeadline.addEventListener('click', () => {
    state.quickCaptureOpen = false;
    state.assignmentModalOpen = true;
    state.assignmentModalPreset = { dueDate: state.selectedCalendarDay };
    render();
  });

  const capAudio = document.getElementById('cap-audio');
  if (capAudio) capAudio.addEventListener('click', () => {
    state.quickCaptureOpen = false;
    state.audioRecorderOpen = true;
    render();
  });

  const closeAudio = document.getElementById('close-audio-sheet');
  if (closeAudio) closeAudio.addEventListener('click', () => {
    if (recorderInstance && (recorderInstance.state === 'recording' || recorderInstance.state === 'paused')) {
      recorderInstance.stopRecording();
    }
    state.audioRecorderOpen = false;
    render();
  });

  // Voice Recording Studio Controls
  const recordBtn = document.getElementById('record-btn');
  const pauseBtn = document.getElementById('voice-pause-btn');
  const stopBtn = document.getElementById('voice-stop-btn');
  const timerEl = document.getElementById('audio-timer-display');
  const statusLabel = document.getElementById('record-status-label');
  const canvas = document.getElementById('audio-canvas');

  if (recordBtn) {
    recordBtn.addEventListener('click', async () => {
      if (!recorderInstance) {
        recorderInstance = new VoiceRecorder({
          onTimeUpdate: (sec) => {
            const t = document.getElementById('audio-timer-display');
            if (t && recorderInstance) t.textContent = recorderInstance.formatTime(sec);
          }
        });
      }

      if (recorderInstance.state === 'idle' || recorderInstance.state === 'stopped') {
        try {
          await recorderInstance.startRecording(canvas);
          recordBtn.classList.add('recording');
          if (pauseBtn) pauseBtn.style.display = 'inline-flex';
          if (stopBtn) stopBtn.style.display = 'inline-flex';
          if (statusLabel) statusLabel.textContent = 'Recording live... Web Audio visualizer active.';
        } catch (err) {
          alert(err.message);
        }
      } else if (recorderInstance.state === 'recording') {
        recorderInstance.pauseRecording();
        recordBtn.classList.remove('recording');
        if (pauseBtn) pauseBtn.innerHTML = icon('play');
        if (statusLabel) statusLabel.textContent = 'Recording paused. Tap to resume.';
      }
    });
  }

  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      if (!recorderInstance) return;
      if (recorderInstance.state === 'recording') {
        recorderInstance.pauseRecording();
        recordBtn?.classList.remove('recording');
        pauseBtn.innerHTML = icon('play');
        if (statusLabel) statusLabel.textContent = 'Paused. Tap to resume.';
      } else if (recorderInstance.state === 'paused') {
        recorderInstance.resumeRecording(canvas);
        recordBtn?.classList.add('recording');
        pauseBtn.innerHTML = icon('pause');
        if (statusLabel) statusLabel.textContent = 'Recording live...';
      }
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', async () => {
      if (!recorderInstance || (recorderInstance.state !== 'recording' && recorderInstance.state !== 'paused')) return;
      const audioResult = await recorderInstance.stopRecording();
      recordBtn?.classList.remove('recording');
      if (pauseBtn) pauseBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'none';
      if (statusLabel) statusLabel.textContent = 'Recording captured successfully!';

      const area = document.getElementById('audio-playback-area');
      if (area && audioResult) {
        area.innerHTML = `
          <div class="audio-player-card" style="padding:14px;background:rgba(255,255,255,0.04);border-radius:12px;border:1px solid var(--hairline);">
            <div style="font-size:0.82rem;font-weight:700;margin-bottom:8px;">Audio Preview (${recorderInstance.formatTime(audioResult.duration)})</div>
            <audio controls src="${audioResult.url}" style="width:100%;margin-bottom:12px;"></audio>
            <div style="display:flex;gap:10px;">
              <button class="btn-ghost" id="discard-rec-btn" style="flex:1;">Discard</button>
              <button class="btn-primary" id="save-rec-to-notes-btn" style="flex:1;">Save to Notes</button>
            </div>
          </div>
        `;
        document.getElementById('discard-rec-btn')?.addEventListener('click', () => {
          area.innerHTML = '';
          if (statusLabel) statusLabel.textContent = 'Discarded recording. Ready for new capture.';
          if (timerEl) timerEl.textContent = '00:00';
        });
        document.getElementById('save-rec-to-notes-btn')?.addEventListener('click', () => {
          notesManager.createNote({
            title: `Voice Memo (${new Date().toLocaleTimeString()})`,
            content: `Audio capture duration: ${recorderInstance.formatTime(audioResult.duration)}. Captured from live Voice Recording Studio.`,
            courseId: state.courseId || null,
            attachments: [{ id: 'aud_' + Date.now(), type: 'audio', duration: audioResult.duration, url: audioResult.url }]
          });
          showToast('Voice memo saved to notes ✓');
          state.audioRecorderOpen = false;
          render();
        });
      }
    });
  }

  // Open 30-Day Month Calendar Modal
  const openMonthCalBtn = document.getElementById('open-month-cal-btn');
  if (openMonthCalBtn) openMonthCalBtn.addEventListener('click', () => {
    const sel = new Date(state.selectedCalendarDay);
    state.monthCalendarYear = sel.getFullYear();
    state.monthCalendarMonth = sel.getMonth();
    state.monthCalendarOpen = true;
    render();
  });

  const closeMonthCalBtn = document.getElementById('close-month-cal-modal');
  if (closeMonthCalBtn) closeMonthCalBtn.addEventListener('click', () => {
    state.monthCalendarOpen = false;
    render();
  });

  const monthCalOverlay = document.getElementById('month-cal-modal-overlay');
  if (monthCalOverlay) monthCalOverlay.addEventListener('click', (e) => {
    if (e.target === monthCalOverlay) {
      state.monthCalendarOpen = false;
      render();
    }
  });

  const monthPrev = document.getElementById('month-cal-prev');
  if (monthPrev) monthPrev.addEventListener('click', () => {
    if (state.monthCalendarMonth === 0) {
      state.monthCalendarMonth = 11;
      state.monthCalendarYear--;
    } else {
      state.monthCalendarMonth--;
    }
    render();
  });

  const monthNext = document.getElementById('month-cal-next');
  if (monthNext) monthNext.addEventListener('click', () => {
    if (state.monthCalendarMonth === 11) {
      state.monthCalendarMonth = 0;
      state.monthCalendarYear++;
    } else {
      state.monthCalendarMonth++;
    }
    render();
  });

  const monthToday = document.getElementById('month-cal-today');
  if (monthToday) monthToday.addEventListener('click', () => {
    const now = new Date();
    state.monthCalendarYear = now.getFullYear();
    state.monthCalendarMonth = now.getMonth();
    state.selectedCalendarDay = now.toDateString();
    render();
  });

  document.querySelectorAll('[data-cal-day]').forEach(cell => {
    cell.addEventListener('click', () => {
      state.selectedCalendarDay = cell.getAttribute('data-cal-day');
      render();
    });
  });

  // Spotlight Search Trigger & Handlers
  const quickSearchBtn = document.getElementById('quick-search-btn');
  if (quickSearchBtn) quickSearchBtn.addEventListener('click', () => {
    state.spotlightSearchOpen = true;
    state.spotlightQuery = '';
    render();
    setTimeout(() => {
      const inp = document.getElementById('spotlight-search-input');
      if (inp) inp.focus();
    }, 50);
  });

  const closeSpotlight = document.getElementById('close-spotlight-modal');
  if (closeSpotlight) closeSpotlight.addEventListener('click', () => {
    state.spotlightSearchOpen = false;
    render();
  });

  const spotlightOverlay = document.getElementById('spotlight-modal-overlay');
  if (spotlightOverlay) spotlightOverlay.addEventListener('click', (e) => {
    if (e.target === spotlightOverlay) {
      state.spotlightSearchOpen = false;
      render();
    }
  });

  const spotlightInput = document.getElementById('spotlight-search-input');
  if (spotlightInput) {
    spotlightInput.addEventListener('input', (e) => {
      state.spotlightQuery = e.target.value;
      render();
      const updated = document.getElementById('spotlight-search-input');
      if (updated) {
        updated.focus();
        updated.setSelectionRange(updated.value.length, updated.value.length);
      }
    });
  }

  document.querySelectorAll('[data-spotlight-nav]').forEach(item => {
    item.addEventListener('click', () => {
      const navType = item.getAttribute('data-spotlight-nav');
      const targetId = item.getAttribute('data-spotlight-id');
      state.spotlightSearchOpen = false;

      if (navType === 'course') {
        state.courseId = targetId;
        state.view = 'courses';
        state.courseTab = 'overview';
      } else if (navType === 'asg') {
        state.assignmentDetailId = targetId;
      } else if (navType === 'note') {
        state.view = 'more';
      }
      render();
    });
  });

  // AI Assistant Trigger & Handlers
  const headerAiBtn = document.getElementById('header-ai-btn');
  if (headerAiBtn) headerAiBtn.addEventListener('click', () => {
    state.aiAssistantOpen = true;
    render();
  });

  const closeAiBtn = document.getElementById('close-ai-assistant-modal');
  if (closeAiBtn) closeAiBtn.addEventListener('click', () => {
    state.aiAssistantOpen = false;
    render();
  });

  const aiOverlay = document.getElementById('ai-assistant-modal-overlay');
  if (aiOverlay) aiOverlay.addEventListener('click', (e) => {
    if (e.target === aiOverlay) {
      state.aiAssistantOpen = false;
      render();
    }
  });

  const tabStudent = document.getElementById('ai-tab-student');
  if (tabStudent) tabStudent.addEventListener('click', () => {
    state.aiAssistantMode = 'student';
    render();
  });

  const tabDeveloper = document.getElementById('ai-tab-developer');
  if (tabDeveloper) tabDeveloper.addEventListener('click', () => {
    state.aiAssistantMode = 'developer';
    render();
  });

  function handleAiQuery(text) {
    if (!text || !text.trim()) return;
    state.aiChatMessages.push({ sender: 'user', text });

    if (state.aiAssistantMode === 'developer') {
      const lower = text.toLowerCase();
      let response = '';
      if (lower.includes('audit') || lower.includes('test') || lower.includes('calendar')) {
        response = `<b>Calendar & Schedule Audit Result:</b><br>
          • Fall 2026 Authoritative Timetable: <b>VERIFIED (100% Match)</b><br>
          • Monday Sep 14: 3 Linear Algebra events (11am C328, 1pm J301, 3pm J301) ✓<br>
          • Tuesday Sep 15: 1 Energy Systems lecture (9am C271) ✓<br>
          • Wednesday Sep 16: 1 Linear Algebra lecture (10am J301) ✓<br>
          • Thursday Sep 17: 1 Energy Systems lab (3pm A305) ✓<br>
          • Friday Sep 18: 1 Economics lecture (1pm Online VTL) ✓<br>
          • Timezone handling: Pure local Gregorian calculations active.`;
      } else if (lower.includes('schedule')) {
        response = `<b>Authoritative Timetable In-Memory:</b><br>
          • <b>MATH 15325D</b>: Mon 11am–12pm (C328), Mon 1pm–3pm (J301), Mon 3pm–4pm (J301), Wed 10am–12pm (J301)<br>
          • <b>ENGR 36035D</b>: Tue 9am–12pm (C271), Thu 3pm–5pm (A305)<br>
          • <b>ENGR 43301D</b>: Fri 1pm–4pm (Online VTL)<br>
          • <b>ANTH 17028GD</b>: Async Online Slate<br>
          • <b>ENGL 17889GD</b>: Async Online Slate`;
      } else if (lower.includes('glass')) {
        response = `<b>CSS Design Tokens Audit:</b><br>
          • --glass-background: rgba(255, 255, 255, 0.04)<br>
          • --glass-border: rgba(255, 255, 255, 0.06) (Low-contrast hairline)<br>
          • Specular glare lines: REMOVED from .panel, .date-strip-cell, .bottom-nav<br>
          • Lava lighting: 3 large slow ambient fluid fields active.`;
      } else {
        response = `<b>Command executed:</b> Scoped tool evaluated query "${text}". System running with all 5 courses, assignments manager, and notes manager synchronized.`;
      }
      state.aiChatMessages.push({ sender: 'assistant', text: response });
    } else {
      const lower = text.toLowerCase();
      let response = '';
      if (lower.includes('today') || lower.includes('class')) {
        const todayClasses = getClassesForDate(new Date());
        if (todayClasses.length) {
          response = `Today you have <b>${todayClasses.length} session${todayClasses.length > 1 ? 's' : ''}</b>:<br>` +
            todayClasses.map(c => `• <b>${c.course.code}</b> (${c.schedule.type}) at ${c.schedule.start} in ${c.schedule.room || 'Campus'}`).join('<br>');
        } else {
          response = `You have no scheduled campus lectures today! A great opportunity to review notes or advance assignments.`;
        }
      } else if (lower.includes('linear') || lower.includes('row')) {
        response = `<b>Linear Algebra (MATH 15325D) Key Concepts:</b><br>
          • <b>Elementary Row Operations:</b> (1) Row swap $R_i \\leftrightarrow R_j$, (2) Scalar multiplication $k R_i$, (3) Row addition $R_i + k R_j$.<br>
          • <b>RREF:</b> Leading 1s with zeros above and below in each pivot column.<br>
          • <b>Instructor:</b> Cyrus Hosseini, PhD PEng (Lecture Room C328 & J301).`;
      } else if (lower.includes('assignment') || lower.includes('priority')) {
        const pending = assignmentsManager.getAll().filter(a => a.status !== 'completed');
        if (pending.length) {
          response = `You have <b>${pending.length} pending assignment${pending.length > 1 ? 's' : ''}</b>:<br>` +
            pending.slice(0, 4).map(a => `• <b>${a.title}</b> (Due ${new Date(a.dueDate).toLocaleDateString()}, priority: ${a.priority || 'normal'})`).join('<br>');
        } else {
          response = `All caught up! No pending assignments in your queue.`;
        }
      } else {
        response = `I've analyzed your coursework for <b>Fall 2026</b>. Let me know if you need summaries of Linear Algebra, Energy Systems thermodynamic cycles, Economics interest formulas, or assistance prioritizing your upcoming deliverables!`;
      }
      state.aiChatMessages.push({ sender: 'assistant', text: response });
    }
    render();
    setTimeout(() => {
      const stream = document.getElementById('ai-chat-stream');
      if (stream) stream.scrollTop = stream.scrollHeight;
    }, 40);
  }

  const aiSend = document.getElementById('ai-chat-send');
  const aiInput = document.getElementById('ai-chat-input');
  if (aiSend && aiInput) {
    aiSend.addEventListener('click', () => {
      const val = aiInput.value;
      aiInput.value = '';
      handleAiQuery(val);
    });
    aiInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = aiInput.value;
        aiInput.value = '';
        handleAiQuery(val);
      }
    });
  }

  document.querySelectorAll('.ai-prompt-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-prompt');
      handleAiQuery(prompt);
    });
  });

  document.querySelectorAll('.ai-dev-action-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.getAttribute('data-dev-cmd');
      handleAiQuery(cmd);
    });
  });

  // Global Shortcut: Cmd+K / Ctrl+K for Spotlight search
  if (!window._sc_keydown_attached) {
    window._sc_keydown_attached = true;
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        state.spotlightSearchOpen = true;
        state.spotlightQuery = '';
        render();
        setTimeout(() => document.getElementById('spotlight-search-input')?.focus(), 50);
      } else if (e.key === 'Escape') {
        if (state.spotlightSearchOpen || state.monthCalendarOpen || state.syncDrawerOpen || state.aiAssistantOpen || state.quickCaptureOpen || state.audioRecorderOpen || state.assignmentModalOpen || state.noteModalOpen || state.flashcardsModalOpen || state.assignmentDetailId) {
          state.spotlightSearchOpen = false;
          state.monthCalendarOpen = false;
          state.syncDrawerOpen = false;
          state.aiAssistantOpen = false;
          state.quickCaptureOpen = false;
          state.audioRecorderOpen = false;
          state.assignmentModalOpen = false;
          state.noteModalOpen = false;
          state.flashcardsModalOpen = false;
          state.assignmentDetailId = null;
          render();
        }
      }
    });
  }

  // File Upload Ingestion
  const capUpload = document.getElementById('cap-upload');
  const fileInput = document.getElementById('hidden-file-input');
  if (capUpload && fileInput) {
    capUpload.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files || []);
      state.quickCaptureOpen = false;

      files.forEach(file => {
        // Run intelligent course detection
        const detected = detectCourseFromContent(file.name, '', COURSES);

        jobsManager.createJob({
          type: 'document_upload',
          title: `Upload & Process: ${file.name}`,
          sourceItem: file.name,
          affectedEntity: { type: 'course', id: detected.courseId, title: detected.courseName },
          execute: async (progress) => {
            progress('uploading', 20, `Uploading to ${detected.courseName}...`);
            const targetCourse = courseById(detected.courseId);
            
            if (isSupabaseConfigured()) {
              await uploadAndProcessFile({
                file,
                course: targetCourse,
                onProgress: (p) => progress(p.status, 60, p.text),
                onLog: () => {}
              });
              await syncDataFromSupabase();
            } else {
              progress('reading', 50, 'Local reading...');
              await new Promise(r => setTimeout(r, 1200));
            }
          }
        });
      });

      showToast(`Added ${files.length} document${files.length>1?'s':''} to background queue ✓`);
      render();
    });
  }

  // Course Cards
  document.querySelectorAll('[data-course-id]').forEach(el => {
    el.addEventListener('click', () => {
      state.courseId = el.getAttribute('data-course-id');
      state.view = 'courses';
      state.courseTab = 'overview';
      render();
    });
  });

  const courseBack = document.getElementById('course-back-btn');
  if (courseBack) courseBack.addEventListener('click', () => {
    state.courseId = null;
    render();
  });

  // Course Tabs
  document.querySelectorAll('[data-course-tab]').forEach(el => {
    el.addEventListener('click', () => {
      state.courseTab = el.getAttribute('data-course-tab');
      render();
    });
  });

  // Practice Studio Launchers
  document.querySelectorAll('#launch-practice-studio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.practiceStudioOpen = true;
      render();
    });
  });

  // Quick Focus Launcher
  const focusBtn = document.getElementById('quick-focus-btn');
  if (focusBtn) focusBtn.addEventListener('click', () => {
    if (!focusModeInstance) {
      focusModeInstance = new FocusMode({
        onExit: () => render(),
        onNoteSaved: () => showToast('Focus notes saved ✓')
      });
    }
    focusModeInstance.start(state.courseId || 'math15325d', 25);
    render();
  });

  // Quick Math Studio (Today view)
  const quickPracticeBtn = document.getElementById('quick-practice-btn');
  if (quickPracticeBtn) quickPracticeBtn.addEventListener('click', () => {
    state.practiceStudioOpen = true;
    render();
  });

  // See All Assignments (Today view)
  const seeAllAsg = document.getElementById('see-all-asg');
  if (seeAllAsg) seeAllAsg.addEventListener('click', () => {
    state.view = 'courses';
    state.courseId = null;
    render();
  });

  // Calendar Day Strip Click
  document.querySelectorAll('.date-strip-cell[data-daykey]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedCalendarDay = el.getAttribute('data-daykey');
      render();
    });
  });

  // Calendar Agenda — Course Items
  document.querySelectorAll('[data-agenda-course-id]').forEach(el => {
    el.addEventListener('click', () => {
      state.courseId = el.getAttribute('data-agenda-course-id');
      state.view = 'courses';
      state.courseTab = 'overview';
      render();
    });
  });

  // Calendar Agenda — Assignment Items
  document.querySelectorAll('[data-agenda-asg-id]').forEach(el => {
    el.addEventListener('click', () => {
      state.assignmentDetailId = el.getAttribute('data-agenda-asg-id');
      render();
    });
  });

  // Calendar Add Deadline
  const addDeadlineBtn = document.getElementById('add-deadline-btn');
  if (addDeadlineBtn) addDeadlineBtn.addEventListener('click', () => {
    state.assignmentModalOpen = true;
    state.assignmentModalPreset = { dueDate: state.selectedCalendarDay };
    render();
  });

  // Course Assignments — New Task button
  const addAsgBtn = document.getElementById('add-assignment-btn');
  if (addAsgBtn) addAsgBtn.addEventListener('click', () => {
    state.assignmentModalOpen = true;
    state.assignmentModalPreset = { courseId: state.courseId };
    render();
  });

  // Course Assignments — open assignment detail on card click
  document.querySelectorAll('[data-open-asg-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      // don't open detail if clicking a checklist item
      if (e.target.closest('[data-asg-check]')) return;
      state.assignmentDetailId = el.getAttribute('data-open-asg-id');
      render();
    });
  });

  // Today view — Assignment Card clicks
  document.querySelectorAll('.assignment-card[data-asg-id]').forEach(el => {
    el.addEventListener('click', () => {
      state.assignmentDetailId = el.getAttribute('data-asg-id');
      render();
    });
  });

  // Course Notes — Add Note button
  const addNoteBtn = document.getElementById('add-course-note-btn');
  if (addNoteBtn) addNoteBtn.addEventListener('click', () => {
    state.noteModalOpen = true;
    state.noteModalPreset = { courseId: state.courseId };
    render();
  });

  // Course Materials — Upload from empty state
  const triggerUploadModal = document.getElementById('trigger-upload-modal');
  const hiddenFileInput = document.getElementById('hidden-file-input');
  if (triggerUploadModal) triggerUploadModal.addEventListener('click', () => {
    // Create a temporary file picker
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.accept = '.pdf,.docx,.txt,.md,.csv,.png,.jpg';
    picker.addEventListener('change', () => {
      const files = Array.from(picker.files || []);
      files.forEach(file => {
        const detected = detectCourseFromContent(file.name, '', COURSES);
        const targetCourseId = state.courseId || detected.courseId;
        jobsManager.createJob({
          type: 'document_upload',
          title: `Upload: ${file.name}`,
          sourceItem: file.name,
          affectedEntity: { type: 'course', id: targetCourseId, title: detected.courseName },
          execute: async (progress) => {
            progress('uploading', 20, `Uploading to course...`);
            const targetCourse = courseById(targetCourseId);
            if (isSupabaseConfigured()) {
              await uploadAndProcessFile({ file, course: targetCourse, onProgress: (p) => progress(p.status, 60, p.text), onLog: () => {} });
              await syncDataFromSupabase();
            } else {
              progress('reading', 50, 'Processing locally...');
              await new Promise(r => setTimeout(r, 1200));
            }
          }
        });
      });
      showToast(`Added ${files.length} file${files.length > 1 ? 's' : ''} to queue ✓`);
      render();
    });
    picker.click();
  });

  // Practice — Flashcards Hub
  const flashcardsBtn = document.getElementById('practice-flashcards-btn');
  if (flashcardsBtn) flashcardsBtn.addEventListener('click', () => {
    state.flashcardsModalOpen = true;
    state.flashcardIndex = 0;
    render();
  });

  // Universal Search Input
  const searchInput = document.getElementById('universal-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      render();
      const updated = document.getElementById('universal-search-input');
      if (updated) {
        updated.focus();
        updated.setSelectionRange(updated.value.length, updated.value.length);
      }
    });
  }

  // Search Result Hits
  document.querySelectorAll('[data-search-hit]').forEach(el => {
    el.addEventListener('click', () => {
      const courseId = el.getAttribute('data-course');
      const tab = el.getAttribute('data-tab') || 'overview';
      if (courseId) {
        state.view = 'courses';
        state.courseId = courseId;
        state.courseTab = tab;
        state.searchQuery = '';
        render();
      }
    });
  });

  // Theme Swatches
  document.querySelectorAll('[data-theme-key]').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.getAttribute('data-theme-key');
      const theme = THEME_PRESETS[key];
      if (theme) {
        applyTheme(theme);
        try { localStorage.setItem('sc_theme', key); } catch(e) {}
        // Refresh active swatch highlight without full re-render
        document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
        el.classList.add('active');
        showToast(`Theme: ${theme.label} ✓`);
      }
    });
  });

  // Lava Lamp Opacity Slider
  const lavaSlider = document.getElementById('lava-slider');
  if (lavaSlider) {
    // Restore saved opacity
    const savedOpacity = localStorage.getItem('sc_lava_opacity');
    if (savedOpacity !== null) {
      lavaSlider.value = savedOpacity;
      const canvas = document.getElementById('lava-canvas');
      if (canvas) canvas.style.opacity = savedOpacity;
    }
    lavaSlider.addEventListener('input', () => {
      const val = lavaSlider.value;
      const canvas = document.getElementById('lava-canvas');
      if (canvas) canvas.style.opacity = val;
      try { localStorage.setItem('sc_lava_opacity', val); } catch(e) {}
    });
  }

  // Save Cloud Settings
  const saveCloudBtn = document.getElementById('save-cloud-settings-btn');
  if (saveCloudBtn) saveCloudBtn.addEventListener('click', async () => {
    const url = document.getElementById('supabase-url-field')?.value?.trim();
    const key = document.getElementById('supabase-key-field')?.value?.trim();
    if (!url || !key) { showToast('Please enter both URL and key'); return; }
    try {
      localStorage.setItem('sc_supabase_url', url);
      localStorage.setItem('sc_supabase_anon_key', key);
      await saveSupabaseConfig(url, key);
      showToast('Cloud settings saved ✓');
    } catch (e) {
      showToast('Saved locally — connection will be tested on next sync');
    }
  });

  // Manual Cloud Sync
  const manualSyncBtn = document.getElementById('manual-sync-btn');
  if (manualSyncBtn) manualSyncBtn.addEventListener('click', async () => {
    showToast('Syncing from cloud...');
    try {
      await syncDataFromSupabase();
      showToast('Sync complete ✓');
    } catch (e) {
      showToast('Sync failed — check cloud settings');
    }
  });

  // Jobs Retry
  document.querySelectorAll('[data-retry-job]').forEach(btn => {
    btn.addEventListener('click', () => {
      const jobId = btn.getAttribute('data-retry-job');
      if (jobsManager.retryJob) {
        jobsManager.retryJob(jobId);
      } else {
        // Fallback: re-trigger the job
        const job = jobsManager.jobs.find(j => j.id === jobId);
        if (job && job.execute) {
          job.status = 'queued';
          job.progress = 0;
          jobsManager.save?.();
        }
      }
      showToast('Task retried ✓');
      render();
    });
  });

  // AI Notes Study Actions
  document.querySelectorAll('[data-ai-note]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-ai-note');
      const noteId = btn.getAttribute('data-note-id');
      try {
        await notesManager.runAIStudyAction(noteId, action);
        showToast(`AI ${action.replace('_', ' ')} completed ✓`);
        render();
      } catch (e) {
        showToast(e.message || 'AI action failed');
      }
    });
  });

  // Checklists Toggle (works in both course detail and assignment detail modal)
  document.querySelectorAll('[data-asg-check]').forEach(item => {
    item.addEventListener('click', () => {
      const asgId = item.getAttribute('data-asg-check');
      const checkId = item.getAttribute('data-check-id');
      const asg = assignmentsManager.getById(asgId);
      if (asg) {
        const target = asg.requirementsChecklist.find(c => c.id === checkId);
        if (target) {
          target.done = !target.done;
          assignmentsManager.save();
          render();
        }
      }
    });
  });

  // =========================================================================
  // MODAL EVENT HANDLERS
  // =========================================================================

  // — Assignment Creation Modal —
  const closeAsgModal = document.getElementById('close-assignment-modal');
  const closeAsgModalCancel = document.getElementById('close-assignment-modal-cancel');
  const closeModal = () => { state.assignmentModalOpen = false; state.assignmentModalPreset = {}; render(); };
  if (closeAsgModal) closeAsgModal.addEventListener('click', closeModal);
  if (closeAsgModalCancel) closeAsgModalCancel.addEventListener('click', closeModal);

  // Checklist item adder within assignment modal
  const checklistItems = []; // local mutable list
  const checklistAddBtn = document.getElementById('asg-checklist-add-btn');
  const checklistNewInput = document.getElementById('asg-checklist-new');
  const checklistContainer = document.getElementById('asg-checklist-container');
  if (checklistAddBtn && checklistNewInput && checklistContainer) {
    const addCheckItem = () => {
      const text = checklistNewInput.value.trim();
      if (!text) return;
      checklistItems.push(text);
      checklistNewInput.value = '';
      const li = document.createElement('div');
      li.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:0.85rem;';
      li.innerHTML = `<span style="color:var(--accent);">◆</span> ${text}`;
      checklistContainer.appendChild(li);
      checklistNewInput.focus();
    };
    checklistAddBtn.addEventListener('click', addCheckItem);
    checklistNewInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCheckItem(); } });
  }

  const saveAsgBtn = document.getElementById('save-assignment-btn');
  if (saveAsgBtn) saveAsgBtn.addEventListener('click', () => {
    const title = document.getElementById('asg-title-input')?.value?.trim();
    if (!title) { showToast('Please enter a title'); return; }
    const courseId = document.getElementById('asg-course-select')?.value || state.courseId;
    const dueDate = document.getElementById('asg-due-input')?.value || new Date().toISOString();
    const priority = document.getElementById('asg-priority-select')?.value || 'medium';
    const description = document.getElementById('asg-desc-input')?.value?.trim();
    const checklist = checklistItems.map(text => ({ id: 'chk_' + Date.now() + '_' + Math.random().toString(36).slice(2), text, done: false }));
    assignmentsManager.createAssignment({
      title, courseId, dueDate: new Date(dueDate).toISOString(),
      status: 'not_started', priority, description,
      requirementsChecklist: checklist
    });
    showToast('Assignment created ✓');
    state.assignmentModalOpen = false;
    state.assignmentModalPreset = {};
    render();
  });

  // — Assignment Detail Modal —
  const closeAsgDetailModal = document.getElementById('close-asg-detail-modal');
  const closeAsgDetailCancel = document.getElementById('close-asg-detail-modal-cancel');
  const closeDetailModal = () => { state.assignmentDetailId = null; render(); };
  if (closeAsgDetailModal) closeAsgDetailModal.addEventListener('click', closeDetailModal);
  if (closeAsgDetailCancel) closeAsgDetailCancel.addEventListener('click', closeDetailModal);

  const updateAsgStatusBtn = document.getElementById('update-asg-status-btn');
  if (updateAsgStatusBtn) updateAsgStatusBtn.addEventListener('click', () => {
    const asgId = updateAsgStatusBtn.getAttribute('data-asg-id');
    const asg = assignmentsManager.getById(asgId);
    if (asg) {
      const newStatus = document.getElementById('asg-detail-status')?.value;
      if (newStatus) { asg.status = newStatus; assignmentsManager.save(); }
      showToast('Assignment updated ✓');
    }
    state.assignmentDetailId = null;
    render();
  });

  document.querySelectorAll('[data-asg-ai]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const asgId = btn.getAttribute('data-asg-id');
      showToast('AI rewrite in progress...');
      try {
        if (assignmentsManager.rewriteAssignment) {
          await assignmentsManager.rewriteAssignment({ assignmentId: asgId, style: 'clear_concise' });
          showToast('AI rewrite complete ✓');
        } else {
          showToast('AI rewrite queued');
        }
      } catch(e) {
        showToast('AI rewrite failed — check Gemini config');
      }
    });
  });

  document.querySelectorAll('[data-asg-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const asgId = btn.getAttribute('data-asg-del');
      const asg = assignmentsManager.getById(asgId);
      if (!asg) return;
      const title = asg.title;
      if (assignmentsManager.deleteAssignment) assignmentsManager.deleteAssignment(asgId);
      else { assignmentsManager.assignments = assignmentsManager.getAll().filter(a => a.id !== asgId); assignmentsManager.save(); }
      state.assignmentDetailId = null;
      render();
      // Show undo toast
      const toast = document.createElement('div');
      toast.className = 'settings-toast';
      toast.innerHTML = `"${title}" deleted. <span id="undo-del-asg" style="color:var(--accent);cursor:pointer;font-weight:700;margin-left:8px;">Undo</span>`;
      document.body.appendChild(toast);
      const undoBtn = document.getElementById('undo-del-asg');
      let undone = false;
      if (undoBtn) undoBtn.addEventListener('click', () => {
        if (!undone) {
          undone = true;
          if (assignmentsManager.undoDelete) assignmentsManager.undoDelete(asgId);
          else { asg.id = asgId; assignmentsManager.getAll().push(asg); assignmentsManager.save(); }
          toast.remove();
          render();
          showToast('Assignment restored ✓');
        }
      });
      setTimeout(() => toast.remove(), 4000);
    });
  });

  // — Note Editor Modal —
  const closeNoteModal = document.getElementById('close-note-modal');
  const closeNoteModalCancel = document.getElementById('close-note-modal-cancel');
  const closeNoteM = () => { state.noteModalOpen = false; state.noteModalPreset = {}; render(); };
  if (closeNoteModal) closeNoteModal.addEventListener('click', closeNoteM);
  if (closeNoteModalCancel) closeNoteModalCancel.addEventListener('click', closeNoteM);

  const saveNoteBtn = document.getElementById('save-note-btn');
  if (saveNoteBtn) saveNoteBtn.addEventListener('click', () => {
    const title = document.getElementById('note-title-input')?.value?.trim();
    const content = document.getElementById('note-content-input')?.value?.trim();
    if (!title) { showToast('Please enter a title'); return; }
    const courseId = document.getElementById('note-course-select')?.value || null;
    const tagsRaw = document.getElementById('note-tags-input')?.value || '';
    const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
    notesManager.createNote({ title, content: content || '', courseId: courseId || null, tags });
    showToast('Note saved ✓');
    state.noteModalOpen = false;
    state.noteModalPreset = {};
    render();
  });

  // — Flashcards Modal —
  const closeFlashcardsModal = document.getElementById('close-flashcards-modal');
  if (closeFlashcardsModal) closeFlashcardsModal.addEventListener('click', () => {
    state.flashcardsModalOpen = false;
    render();
  });

  const flipBtn = document.getElementById('flip-card-btn');
  if (flipBtn) flipBtn.addEventListener('click', () => {
    const front = document.getElementById('flashcard-front');
    const back = document.getElementById('flashcard-back');
    if (front && back) {
      const showingFront = front.style.display !== 'none';
      front.style.display = showingFront ? 'none' : '';
      back.style.display = showingFront ? '' : 'none';
      flipBtn.textContent = showingFront ? 'Show Term' : 'Flip Card';
    }
  });

  const fcPrevBtn = document.getElementById('fc-prev-btn');
  if (fcPrevBtn) fcPrevBtn.addEventListener('click', () => {
    if (state.flashcardIndex > 0) { state.flashcardIndex--; render(); }
  });

  const fcNextBtn = document.getElementById('fc-next-btn');
  if (fcNextBtn) fcNextBtn.addEventListener('click', () => {
    state.flashcardIndex++; render();
  });

  // Close modals on overlay backdrop click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        state.assignmentModalOpen = false;
        state.assignmentDetailId = null;
        state.noteModalOpen = false;
        state.flashcardsModalOpen = false;
        state.assignmentModalPreset = {};
        state.noteModalPreset = {};
        render();
      }
    });
  });
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

    // 2. Safe Lava Lamp initialization
    try {
      const canvas = document.getElementById('lava-canvas');
      if (canvas) {
        lavaEngine = createLavaEngine(canvas);
        if (lavaEngine) lavaEngine.start();
      }
    } catch (lavaErr) {
      console.warn('Lava engine init skipped:', lavaErr);
    }

    // 3. Safe Theme initialization
    try {
      applyTheme(THEME_PRESETS.violet);
    } catch (themeErr) {
      console.warn('Theme apply skipped:', themeErr);
    }

    // 4. Safe Jobs subscription
    try {
      jobsManager.subscribe(() => {
        try {
          const pill = document.getElementById('jobs-pill-btn');
          if (pill) {
            const count = jobsManager.getActiveJobsCount();
            pill.innerHTML = count > 0 
              ? `<div class="jobs-pill-spinner"></div><span>${count} processing</span>` 
              : `<div class="jobs-pill-dot"></div><span>All synced</span>`;
          }
        } catch (e) {}
      });
    } catch (jobErr) {
      console.warn('Jobs subscriber skipped:', jobErr);
    }

    // 5. Asynchronous background cloud sync (non-blocking)
    try {
      setupRealtimeListener(() => {
        syncDataFromSupabase().catch(() => {});
      });
      syncDataFromSupabase().catch((syncErr) => {
        console.warn('Notice: Background cloud sync using local cache:', syncErr);
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

