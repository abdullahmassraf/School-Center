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
   STATIC COURSE METADATA & SCHEDULES
   ========================================================================= */
const STATIC_COURSES = [
  {
    id:'math15325d', code:'MATH15325D', name:'Linear Algebra', instructor:'Cyrus Hosseini, PhD PEng',
    hasMaterial:true, accent:'#8B7CF6', hasPracticeStudio:true,
    schedule:[
      {day:'Mon', start:'11:00 AM', end:'12:00 PM', type:'Lecture', room:'C328'},
      {day:'Mon', start:'1:00 PM', end:'3:00 PM', type:'Lab', room:'J301'},
      {day:'Thu', start:'12:00 PM', end:'2:00 PM', type:'Lecture', room:'C328'},
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
    id:'engr36035d', code:'ENGR36035D', name:'Introduction to Energy Systems', instructor:'Dr. Amin',
    hasMaterial:true, accent:'#34D1BF',
    schedule:[
      {day:'Tue', start:'9:00 AM', end:'11:00 AM', type:'Lecture', room:'B210'},
      {day:'Tue', start:'1:00 PM', end:'3:00 PM', type:'Lab', room:'C140'},
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
    id:'engr43301d', code:'ENGR43301D', name:'Economics & Entrepreneurship', instructor:'Prof. Stewart',
    hasMaterial:true, accent:'#F5A623',
    schedule:[
      {day:'Wed', start:'10:00 AM', end:'1:00 PM', type:'Lecture', room:'A102'}
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
    id:'anth17028gd', code:'ANTH17028GD', name:'Anthropology of Health', instructor:'Jaime Ginter',
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
    id:'engl17889gd', code:'ENGL17889GD', name:'Composition & Rhetoric', instructor:'—',
    hasMaterial:false, accent:'#5FD37A',
    schedule:[], async:true, lectures:[], worksheets:[]
  }
];

let COURSES = JSON.parse(JSON.stringify(STATIC_COURSES));

function courseById(id){
  if (!id) return null;
  return COURSES.find(c => c.id === id || (c.code && c.code.toLowerCase() === id.toLowerCase()));
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
  let W=0,H=0,DPR=Math.min(window.devicePixelRatio||1,2);
  let blobs=[];
  let colors=['#8B7CF6','#5B4FD6','#B892FF','#3A2E7A'];
  let pointer={x:-9999,y:-9999,active:false};
  let raf=null;

  function resize(){
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.floor(W*DPR); canvas.height = Math.floor(H*DPR);
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  function initBlobs(n){
    blobs = [];
    for(let i=0;i<n;i++){
      const r = 90 + Math.random()*150;
      blobs.push({
        x: Math.random()*W, y: Math.random()*H,
        vx: (Math.random()-0.5)*0.14, vy:(Math.random()-0.5)*0.14,
        r, baseR:r,
        c: colors[i % colors.length],
        phase: Math.random()*Math.PI*2
      });
    }
  }
  function setColors(newColors){
    colors = newColors;
    blobs.forEach((b,i)=>{ b.c = colors[i % colors.length]; });
  }
  function step(t){
    ctx.clearRect(0,0,W,H);
    blobs.forEach((b)=>{
      b.x += b.vx; b.y += b.vy;
      b.r = b.baseR + Math.sin(t*0.0015 + b.phase)*18;

      if(b.x - b.r < 0){ b.x = b.r; b.vx *= -1; }
      if(b.x + b.r > W){ b.x = W - b.r; b.vx *= -1; }
      if(b.y - b.r < 0){ b.y = b.r; b.vy *= -1; }
      if(b.y + b.r > H){ b.y = H - b.r; b.vy *= -1; }

      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, b.c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
      ctx.fill();
    });
    raf = requestAnimationFrame(step);
  }
  function start(){
    resize();
    initBlobs(6);
    if(raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(step);
  }
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
  flashcardIndex: 0
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
  const supabaseReady = isSupabaseConfigured();

  return `
    <header class="app-header">
      <div class="header-meta">
        <h1 class="headfont">School Center</h1>
        <div class="sub">Abdullah Massraf · Fall 2026 · Mechanical Eng</div>
      </div>
      <div class="header-actions">
        <!-- Dynamic Island Jobs Pill -->
        <div class="jobs-pill ${activeCount > 0 ? 'active' : ''}" id="jobs-pill-btn" title="Background Processing Queue">
          ${activeCount > 0 
            ? `<div class="jobs-pill-spinner"></div><span>${activeCount} processing</span>` 
            : (failedCount > 0 
                ? `<div class="jobs-pill-dot err"></div><span>${failedCount} failed</span>` 
                : `<div class="jobs-pill-dot"></div><span>All synced</span>`)}
        </div>
        <div class="icon-btn sm" id="quick-search-btn" title="Universal Search">
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

  // Find next class today
  const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][today.getDay()];
  let nextClass = null;
  COURSES.forEach(c => {
    (c.schedule || []).filter(s => s.day === dayName).forEach(s => {
      if (!nextClass) nextClass = { course: c, schedule: s };
    });
  });

  return `
    <!-- Top Situation Greeting -->
    <div class="panel" style="padding:18px 20px;">
      <div style="font-size:0.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">${dateStr}</div>
      <h2 style="font-size:1.4rem;margin:4px 0 10px;">Good day, Abdullah</h2>
      <p style="margin:0;font-size:0.9rem;color:var(--ink);">
        ${nextClass 
          ? `Next session: <b>${nextClass.course.code}</b> (${nextClass.schedule.type}) at ${nextClass.schedule.start} · Room ${nextClass.schedule.room || 'Online'}`
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

    return `
      <div class="date-strip-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-daykey="${key}">
        <span class="dow">${dow}</span>
        <span class="num">${d.getDate()}</span>
      </div>
    `;
  }).join('');

  // Find assignments and classes for the selected day
  const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][selectedDate.getDay()];
  const dayClasses = [];
  COURSES.forEach(c => {
    (c.schedule || []).filter(s => s.day === dayName).forEach(s => {
      dayClasses.push({ course: c, schedule: s });
    });
  });

  const dayAssignments = assignmentsManager.getAll().filter(a => {
    return new Date(a.dueDate).toDateString() === state.selectedCalendarDay;
  });

  const calendarSelectedDateStr = selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return `
    <div class="panel" style="padding:16px 14px;">
      <h2 style="padding:0 4px;margin-bottom:12px;">Academic Calendar</h2>
      <div class="date-strip">${stripHtml}</div>

      <div class="dim-divider" style="display:flex;justify-content:space-between;align-items:center;">
        <span>${calendarSelectedDateStr}</span>
        <button class="btn-primary" id="add-deadline-btn" style="min-height:30px;font-size:0.75rem;padding:0 12px;">+ Add Deadline</button>
      </div>

      <div class="agenda-list">
        ${dayClasses.map(c => `
          <div class="agenda-item" style="--item-color:${c.course.accent};cursor:pointer;" data-agenda-course-id="${c.course.id}">
            <div class="agenda-time">${c.schedule.start}</div>
            <div class="agenda-main">
              <div class="agenda-course">${c.course.code}</div>
              <div class="agenda-title">${c.course.name} (${c.schedule.type}) · Room ${c.schedule.room || 'Campus'}</div>
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
          <h3 class="headfont">Quick Capture</h3>
          <div class="icon-btn sm" id="close-capture-sheet">${icon('close')}</div>
        </div>
        <div class="sheet-body">
          <div class="capture-grid">
            <div class="capture-btn" id="cap-note">
              <div class="capture-btn-icon">${icon('doc')}</div>
              <div class="capture-btn-label">Text Note</div>
              <div class="capture-btn-desc">Lecture note or idea</div>
            </div>
            <div class="capture-btn" id="cap-audio">
              <div class="capture-btn-icon" style="background:rgba(240,96,138,0.15);color:var(--accent-3);">${icon('mic')}</div>
              <div class="capture-btn-label">Voice Recording</div>
              <div class="capture-btn-desc">Record with live visualizer</div>
            </div>
            <div class="capture-btn" id="cap-upload">
              <div class="capture-btn-icon" style="background:rgba(52,209,191,0.15);color:var(--accent-2);">${icon('download')}</div>
              <div class="capture-btn-label">Upload File</div>
              <div class="capture-btn-desc">Auto-detect course & parse</div>
              <input type="file" id="hidden-file-input" multiple accept=".pdf,.docx,.txt,.md,.csv,.png,.jpg" style="display:none;">
            </div>
            <div class="capture-btn" id="cap-assignment">
              <div class="capture-btn-icon" style="background:rgba(245,166,35,0.15);color:var(--accent-amber);">${icon('clipboard')}</div>
              <div class="capture-btn-label">New Assignment</div>
              <div class="capture-btn-desc">Due date & checklist</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* =========================================================================
   VOICE RECORDER SHEET (Web Audio API Visualizer)
   ========================================================================= */
function renderAudioRecorderSheet() {
  return `
    <div class="sheet-backdrop ${state.audioRecorderOpen ? 'open' : ''}" id="audio-sheet-backdrop">
      <div class="bottom-sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-head">
          <h3 class="headfont">Voice Recording & Live Visualizer</h3>
          <div class="icon-btn sm" id="close-audio-sheet">${icon('close')}</div>
        </div>
        <div class="sheet-body">
          <div class="audio-recorder-box">
            <div class="audio-timer" id="audio-timer-display">00:00</div>
            <canvas id="audio-canvas" class="audio-visualizer-canvas" width="400" height="72"></canvas>
            <div class="audio-controls">
              <button class="record-toggle-btn" id="record-btn" title="Toggle Recording">
                ${icon('mic')}
              </button>
            </div>
            <div style="font-size:0.75rem;color:var(--muted);margin-top:10px;" id="record-status-label">Tap microphone to start</div>
          </div>

          <div id="audio-playback-area"></div>
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

  // Header Jobs Pill
  const jobsBtn = document.getElementById('jobs-pill-btn');
  if (jobsBtn) jobsBtn.addEventListener('click', () => {
    state.jobsDrawerOpen = true;
    render();
  });

  const closeJobs = document.getElementById('close-jobs-drawer');
  if (closeJobs) closeJobs.addEventListener('click', () => {
    state.jobsDrawerOpen = false;
    render();
  });

  // FAB Quick Capture
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

  // Capture Assignment
  const capAssignment = document.getElementById('cap-assignment');
  if (capAssignment) capAssignment.addEventListener('click', () => {
    state.quickCaptureOpen = false;
    state.assignmentModalOpen = true;
    state.assignmentModalPreset = { courseId: state.courseId || null };
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
    if (recorderInstance && recorderInstance.state === 'recording') {
      recorderInstance.stopRecording();
    }
    state.audioRecorderOpen = false;
    render();
  });

  // Audio Recorder Button
  const recordBtn = document.getElementById('record-btn');
  if (recordBtn) {
    recordBtn.addEventListener('click', async () => {
      const canvas = document.getElementById('audio-canvas');
      const timerEl = document.getElementById('audio-timer-display');
      const statusLabel = document.getElementById('record-status-label');

      if (!recorderInstance) {
        recorderInstance = new VoiceRecorder({
          onTimeUpdate: (sec) => {
            if (timerEl) timerEl.textContent = recorderInstance.formatTime(sec);
          }
        });
      }

      if (recorderInstance.state === 'idle' || recorderInstance.state === 'stopped') {
        try {
          await recorderInstance.startRecording(canvas);
          recordBtn.classList.add('recording');
          if (statusLabel) statusLabel.textContent = 'Recording live... Tap to stop.';
        } catch (err) {
          alert(err.message);
        }
      } else if (recorderInstance.state === 'recording') {
        const audioResult = await recorderInstance.stopRecording();
        recordBtn.classList.remove('recording');
        if (statusLabel) statusLabel.textContent = 'Recording saved!';

        const area = document.getElementById('audio-playback-area');
        if (area && audioResult) {
          area.innerHTML = `
            <div class="audio-player-card">
              <audio controls src="${audioResult.url}" style="width:100%;margin-bottom:10px;"></audio>
              <button class="btn-primary" id="save-rec-to-notes-btn" style="width:100%;">Save to Notes</button>
            </div>
          `;
          document.getElementById('save-rec-to-notes-btn')?.addEventListener('click', () => {
            notesManager.createNote({
              title: `Voice Memo (${new Date().toLocaleTimeString()})`,
              content: `Audio recording duration: ${recorderInstance.formatTime(audioResult.duration)}.`,
              courseId: state.courseId || null,
              attachments: [{ id: 'aud_' + Date.now(), type: 'audio', duration: audioResult.duration, url: audioResult.url }]
            });
            showToast('Voice memo saved to notes ✓');
            state.audioRecorderOpen = false;
            render();
          });
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

  const quickSearchBtn = document.getElementById('quick-search-btn');
  if (quickSearchBtn) quickSearchBtn.addEventListener('click', () => {
    state.view = 'more';
    render();
  });

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

