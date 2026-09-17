// ============================================================================
// src/app.js — Full Dynamic Frontend Engine for School Center
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
  },
  async delete(key, shared){
    if(hasHostStorage){
      try{ return await window.storage.delete(key, shared); }
      catch(e){ /* fallback */ }
    }
    try{
      localStorage.removeItem(LS_PREFIX+key);
      return { key, deleted:true, shared: !!shared };
    }catch(e){ return null; }
  }
};

/* =========================================================================
   ICONS
   ========================================================================= */
const ICONS = {
  gear: `<svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 13a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V19a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 13a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 7a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V1a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 7a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
  chevronDown: `<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>`,
  chevronLeft: `<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>`,
  chevronRight: `<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>`,
  arrowLeft: `<svg viewBox="0 0 24 24"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>`,
  close: `<svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18"/><path d="M8 2.5v4"/><path d="M16 2.5v4"/></svg>`,
  trash: `<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4.5A1.5 1.5 0 0110.5 3h3A1.5 1.5 0 0115 4.5V7"/><path d="M6 7l1 13.5A1.5 1.5 0 008.5 22h7a1.5 1.5 0 001.5-1.5L18 7"/></svg>`,
  doc: `<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h6"/></svg>`,
  spark: `<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></svg>`,
  download: `<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  cloud: `<svg viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`
};
function icon(name, cls){ return `<span class="icon-inline ${cls||''}">${ICONS[name]||''}</span>`; }

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
   Keeps schedules, room info, evaluation weights, and syllabi preserved.
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
          ['Augmented matrix','A compact grid $[A \\mid \\mathbf{b}]$ combining the coefficient matrix and the right-hand constants, allowing row operations without writing variable names.'],
          ['Elementary row operations (EROs)','Three reversible operations that preserve the solution set: row swap ($R_i \\leftrightarrow R_j$), scalar multiplication ($R_i \\leftarrow c R_i,\\ c \\neq 0$), and row addition ($R_i \\leftarrow R_i + c R_j$).'],
          ['Echelon form (REF)','Every leading entry is strictly to the right of the leading entry above it; all zero rows are at the bottom.'],
          ['Reduced row echelon form (RREF)','REF with two extra conditions: every leading entry is 1 (a leading 1), and each leading 1 is the only nonzero entry in its column. Unique for every matrix.'],
          ['Pivot position / pivot column','A location in matrix $A$ that corresponds to a leading 1 in its RREF. Pivot columns correspond to basic (dependent) variables; non-pivot columns correspond to free variables.'],
        ]
      },
      {
        title:'Week 2 — Matrix Algebra & Inverses',
        concepts:[
          ['Matrix multiplication','If $A$ is $m \\times k$ and $B$ is $k \\times n$, then $AB$ is $m \\times n$. The $(i,j)$ entry is the dot product of row $i$ of $A$ and column $j$ of $B$. In general, $AB \\neq BA$ (non-commutative).'],
          ['Identity matrix $I_n$','Square matrix with 1s on the main diagonal and 0s elsewhere. Serves as the multiplicative identity: $A I = I A = A$.'],
          ['Invertible (nonsingular) matrix','A square matrix $A$ is invertible if there exists a matrix $A^{-1}$ such that $A A^{-1} = A^{-1} A = I$.'],
          ['$2 \\times 2$ Inverse formula','For $A = \\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}$, if $\\det(A) = ad - bc \\neq 0$, then $A^{-1} = \\frac{1}{ad - bc}\\begin{bmatrix} d & -b \\\\ -c & a \\end{bmatrix}$.'],
          ['Inversion by row reduction','Augment $[A \\mid I]$ and row reduce. If $A$ reduces to $I$, then $[A \\mid I] \\sim [I \\mid A^{-1}]$. If $A$ cannot be reduced to $I$, $A$ is singular.'],
        ]
      }
    ],
    worksheets:[
      {
        title:'Tutorial 1 — Linear Systems & Gaussian Elimination',
        items:[
          'Determine the condition on $k$ such that the system has (a) unique, (b) infinite, or (c) no solutions: $x + 2y = 3$, $3x + ky = 9$.',
          'Solve the $3 \\times 3$ system using Gauss-Jordan elimination: $x - 2y + z = 0$, $2x + y - 3z = 5$, $4x - 7y - z = -1$.',
          'Find the interpolating polynomial $p(t) = a_0 + a_1 t + a_2 t^2$ passing through $(-1, 4)$, $(1, 2)$, and $(2, 7)$.'
        ]
      },
      {
        title:'Tutorial 2 — Matrix Operations & Inverses',
        items:[
          'Given $A = \\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}$ and $B = \\begin{bmatrix} -1 & 1 \\\\ 0 & 2 \\end{bmatrix}$, verify that $(AB)^T = B^T A^T$.',
          'Use the inversion algorithm $[A \\mid I] \\sim [I \\mid A^{-1}]$ to find the inverse of $A = \\begin{bmatrix} 1 & 0 & 2 \\\\ 2 & -1 & 3 \\\\ 4 & 1 & 8 \\end{bmatrix}$.',
          'If $A$ and $B$ are invertible $n \\times n$ matrices, prove that $(AB)^{-1} = B^{-1} A^{-1}$.'
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
      ['3','Sep 22','Rankine & Brayton Cycles — Steam and gas turbine power generation cycles','Assignment 1 (5%)'],
      ['4','Sep 29','Solar Photovoltaics — PV cell physics, I-V curves, insolation, array sizing','Lab 1 Report'],
      ['5','Oct 6','Solar Thermal & Wind — Heliostats, Betz limit, wind turbine aerodynamics','Quiz 2 (5%)'],
      ['6','Oct 13','Energy Storage — Batteries, pumped hydro, thermal storage, hydrogen systems','Assignment 2 (5%)'],
      ['7','Oct 20','Midterm Exam','Midterm Exam (25%)'],
      ['—','Oct 27','Reading Week','—'],
      ['8','Nov 3','Nuclear & Hydroelectric — Fission reactor physics, dams, run-of-river turbines','Lab 2 Report'],
      ['9','Nov 10','Building Energy Modeling — Degree days, conduction, HVAC load calculations','Quiz 3 (5%)'],
      ['10','Nov 17','Grid Integration — Smart grid, duck curve, capacity factor, LCOE economics','Assignment 3 (5%)'],
      ['11','Nov 24','Bioenergy & Geothermal — Biomass conversion, ground source heat pumps','Lab 3 Report'],
      ['12','Dec 1','Carbon Capture & Policy — CCS technologies, carbon pricing, lifecycle analysis','Quiz 4 (5%)'],
      ['13','Dec 8','Review & Future Horizons — Decarbonization pathways and course review','Review Session'],
      ['14','Dec 15','Final Exam Period','Final Exam (25%)'],
    ],
    lectures:[
      {
        title:'Module 1 — Energy Fundamentals & Thermodynamics',
        concepts:[
          ['First Law of Thermodynamics','Conservation of energy: $\\Delta U = Q - W$. Energy cannot be created or destroyed, only converted.'],
          ['Second Law of Thermodynamics','Entropy of an isolated system always increases. Heat engine efficiency is limited by Carnot efficiency $\\eta_C = 1 - T_C / T_H$.'],
          ['Higher vs Lower Heating Value','HHV includes latent heat of vaporization of water in combustion products; LHV assumes water remains vapor.'],
        ]
      }
    ],
    worksheets:[
      {
        title:'Problem Set 1 — Cycle Efficiencies & Heat Balances',
        items:[
          'Calculate the Carnot efficiency of a coal-fired power plant operating between 540°C and 35°C.',
          'Determine the electrical power output of a Rankine cycle with mass flow rate 120 kg/s given boiler and condenser enthalpies.'
        ]
      }
    ]
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
    textbook:'Engineering Economics: Financial Decision Making for Engineers, Fraser & Jewkes',
    syllabus:[
      ['1','Sep 9','Engineering Decision Making — Time value of money, cash flow diagrams','Intro Exercises'],
      ['2','Sep 16','Interest Formulas — Single payments, uniform series, gradient series','Quiz 1'],
      ['3','Sep 23','Present Worth Analysis — Comparing mutually exclusive alternatives, capitalized cost','Case 1 (10%)'],
      ['4','Sep 30','Annual Worth & Future Worth — Equivalent uniform annual worth, salvage value','Problem Set'],
      ['5','Oct 7','Rate of Return — Internal Rate of Return (IRR), MARR, incremental analysis','Case 2 (10%)'],
      ['6','Oct 14','Depreciation & Taxes — CCA rates, terminal loss, after-tax cash flows','Midterm Prep'],
      ['7','Oct 21','Midterm Exam','Midterm Exam (25%)'],
      ['—','Oct 28','Reading Week','—'],
      ['8','Nov 4','Cost Estimation & Breakeven — Fixed/variable costs, breakeven quantity','Pitch Prep'],
      ['9','Nov 11','Benefit-Cost Analysis — B/C ratio for public projects, incremental B/C','Case 3 (10%)'],
      ['10','Nov 18','Entrepreneurship Fundamentals — Business model canvas, IP & patent law','Draft Plan'],
      ['11','Nov 25','Venture Capital & Funding — Seed rounds, equity valuation, burn rate','Pitch Practice'],
      ['12','Dec 2','Business Plan Presentations — Group entrepreneurial pitches','Pitches (20%)'],
      ['13','Dec 9','Course Review & Professional Ethics — Review for final examination','Review'],
      ['14','Dec 16','Final Exam Period','Final Exam (25%)'],
    ],
    lectures:[
      {
        title:'Module 1 — Time Value of Money & Cash Flow Modeling',
        concepts:[
          ['Time Value of Money','A dollar today is worth more than a dollar tomorrow due to its earning capacity.'],
          ['Compound Interest','Interest calculated on both initial principal and accumulated interest: $F = P(1+i)^n$.'],
          ['MARR (Minimum Attractive Rate of Return)','The hurdle rate or minimum rate of return a project must deliver to be accepted.'],
        ]
      }
    ],
    worksheets:[
      {
        title:'Worksheet 1 — Present Worth & Equivalence Problems',
        items:[
          'An engineering firm buys equipment for $45,000 with annual maintenance of $3,500. Compute present worth over 8 years at MARR = 8%.',
          'Compare Alternative A (capital cost $80k, lifespan 5 yrs) and Alternative B (capital cost $120k, lifespan 10 yrs) using annual worth.'
        ]
      }
    ]
  },
  {
    id:'anth17028gd', code:'ANTH17028GD', name:'Anthropology of Health', instructor:'Jaime Ginter',
    hasMaterial:true, accent:'#F0608A',
    schedule:[], async:true,
    evaluation:[
      ['Discussion','20%'],
      ['Quizzes (10 @ 5% each)','50%'],
      ['Paleopathology Project Prep','5%'],
      ['Paleopathology Group Contract','5%'],
      ['Paleopathology Group Project','20%'],
    ],
    textbook:'Green course — no physical textbook; readings provided on SLATE.',
    syllabus:[
      ['1','Module 1','Anthropological Perspectives on Health — core definitions, medical anthropology','Discussion · Quiz 1 (5%)'],
      ['2','Module 2','Biocultural Perspectives & Ethics in Health Research','Quiz 2 (5%)'],
      ['3','Module 3','Adaptation, Evolution & Culture — human genetics, physiology and culture','Quiz 3 (5%)'],
      ['4','Module 4','Categorizing and Measuring Disease — epidemiological patterns and susceptibility','Quiz 4 (5%)'],
      ['5','Module 5','Accessing Information about Past Health — skeletal anatomy, Osteological Paradox','Quiz 5 (5%) · Prep (5%)'],
      ['6','Module 6','Hominin Diet and Disease — evolutionary transitions and fossil pathologies','Quiz 6 (5%) · Contract (5%)'],
      ['7','Module 7','Prehistoric Subsistence Transitions & Health — agricultural transitions','Quiz 7 (5%)'],
      ['8','Module 8','Health in the Present — Research Approaches — qualitative & quantitative data','Project (20%) · Quiz 8 (5%)'],
      ['9','Module 9','Health in the Present — Infectious & Re-emerging Diseases','Quiz 9 (5%)'],
      ['10','Module 10','Health in the Present — Diet, Nutrition & Metabolic Disorders','Quiz 10 (5%)'],
    ],
    lectures:[
      {
        title:'Module 1 — Anthropological Perspectives on Health',
        concepts:[
          ['Disease vs Illness','Disease is the objective biological/pathological condition; Illness is the personal, cultural experience of suffering.'],
          ['Biocultural approach','Framework examining the interplay between biological processes and cultural/ecological settings.'],
          ['Osteological Paradox','Skeletal lesions indicate someone survived long enough with disease to develop bone changes, not necessarily overall unhealthiness.']
        ]
      }
    ],
    worksheets:[]
  },
  {
    id:'engl17889gd', code:'ENGL17889GD', name:'Composition & Rhetoric', instructor:'—',
    hasMaterial:false, accent:'#5FD37A',
    schedule:[], async:true, lectures:[], worksheets:[]
  }
];

// Active in-memory COURSES list (updated from Supabase on load)
let COURSES = JSON.parse(JSON.stringify(STATIC_COURSES));

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

const THEME_KEY_LOCAL = 'schoolcenter_theme_v1';
let currentTheme = null;

function applyTheme(theme){
  const r = document.documentElement.style;
  r.setProperty('--ink', theme.ink);
  r.setProperty('--muted', theme.muted);
  r.setProperty('--muted-dim', theme.mutedDim);
  r.setProperty('--accent', theme.accent);
  r.setProperty('--accent-2', theme.accent2);
  r.setProperty('--accent-3', theme.accent3);
  r.setProperty('--bg-1', theme.bg1);
  r.setProperty('--bg-2', theme.bg2);
  r.setProperty('--bg-3', theme.bg3);
  const glassAlpha = theme.glassAlpha || 0.07;
  r.setProperty('--glass', `rgba(255,255,255,${glassAlpha})`);
  r.setProperty('--glass-hi', `rgba(255,255,255,${glassAlpha*2})`);
  currentTheme = theme;
  if(lavaEngine) lavaEngine.setColors(theme.lava);
}

async function loadTheme(){
  try{
    const res = await storage.get(THEME_KEY_LOCAL, false);
    if(res && res.value) return JSON.parse(res.value);
  }catch(e){ }
  return { ...THEME_PRESETS.violet, key:'violet' };
}
async function saveTheme(theme){
  try{ await storage.set(THEME_KEY_LOCAL, JSON.stringify(theme), false); }
  catch(e){ console.error('Could not save theme', e); }
}

function hexToRgb(hex){
  hex = hex.replace('#','');
  if(hex.length===3) hex = hex.split('').map(c=>c+c).join('');
  const n = parseInt(hex,16);
  return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
}
function rgbToHex(r,g,b){ return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join(''); }
function mix(hexA,hexB,t){
  const a=hexToRgb(hexA), b=hexToRgb(hexB);
  return rgbToHex(a.r+(b.r-a.r)*t, a.g+(b.g-a.g)*t, a.b+(b.b-a.b)*t);
}
function darken(hex, amt){ return mix(hex, '#000000', amt); }
function lighten(hex, amt){ return mix(hex, '#ffffff', amt); }

function buildCustomTheme(accentHex){
  return {
    key:'custom',
    ink:'#F4F6FD', muted:'#AEB4D8', mutedDim:'#7C82A6',
    accent:accentHex,
    accent2:lighten(accentHex,0.28),
    accent3:mix(accentHex,'#F0608A',0.5),
    bg1:darken(accentHex,0.86),
    bg2:darken(accentHex,0.78),
    bg3:darken(accentHex,0.68),
    lava:[accentHex, darken(accentHex,0.35), lighten(accentHex,0.22), darken(accentHex,0.6)],
    accentHex
  };
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
      const r = 90 + Math.random()*160;
      blobs.push({
        x: Math.random()*W, y: Math.random()*H,
        vx: (Math.random()-0.5)*0.18, vy:(Math.random()-0.5)*0.18,
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

    blobs.forEach((b,i)=>{
      b.x += b.vx; b.y += b.vy;
      b.r = b.baseR + Math.sin(t*0.0015 + b.phase)*20;

      if(b.x - b.r < 0){ b.x = b.r; b.vx *= -1; }
      if(b.x + b.r > W){ b.x = W - b.r; b.vx *= -1; }
      if(b.y - b.r < 0){ b.y = b.r; b.vy *= -1; }
      if(b.y + b.r > H){ b.y = H - b.r; b.vy *= -1; }

      if(pointer.active){
        const dx = pointer.x - b.x;
        const dy = pointer.y - b.y;
        const dist = Math.hypot(dx,dy) || 1;
        if(dist < 320){
          const force = (1 - dist/320) * 0.12;
          b.vx += (dx/dist)*force;
          b.vy += (dy/dist)*force;
        }
      }

      b.vx *= 0.995;
      b.vy *= 0.995;

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
    initBlobs(7);
    if(raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(step);
  }

  window.addEventListener('resize', ()=>resize());
  window.addEventListener('pointermove', (e)=>{ pointer.x=e.clientX; pointer.y=e.clientY; pointer.active=true; });
  window.addEventListener('pointerleave', ()=>{ pointer.active=false; });
  window.addEventListener('pointerdown', (e)=>{
    blobs.forEach(b=>{
      const dx=b.x-e.clientX, dy=b.y-e.clientY;
      const dist=Math.hypot(dx,dy)||1;
      if(dist<260){
        const f = (1-dist/260)*1.6;
        b.vx += (dx/dist)*f; b.vy += (dy/dist)*f;
      }
    });
  });

  return { start, setColors, resize };
}

let lavaEngine = null;

/* =========================================================================
   CALENDAR & DEADLINES
   ========================================================================= */
const DAYS = ['Mon','Tue','Wed','Thu','Fri'];
const TODAY_IDX = (function(){ const d = new Date().getDay(); return d>=1&&d<=5 ? d-1 : -1; })();

let state = { view:'dashboard', courseId:null, tab:'materials', worksheetView:null };
let settingsOpen = false;
let pendingFiles = []; 
let isProcessingFiles = false;
let calendarExpanded = false;
let practiceStudioOpen = false;
let calendarViewMonth = null;
let calendarSelectedDay = null;

const MONTH_NAMES = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function parseSyllabusDate(str){
  if(!str) return null;
  const m = String(str).trim().toLowerCase().match(/^([a-z]{3,})\s+(\d{1,2})$/);
  if(!m) return null;
  const monthIdx = MONTH_NAMES.findIndex(mn=>m[1].startsWith(mn));
  if(monthIdx===-1) return null;
  const day = parseInt(m[2],10);
  const now = new Date();
  const year = monthIdx>=8 ? now.getFullYear() : now.getFullYear()+1;
  const d = new Date(year, monthIdx, day);
  return isNaN(d.getTime()) ? null : d;
}

const TERM_START = new Date(2026, 8, 7);
const READING_WEEK_START = new Date(2026, 9, 26);

function estimateDateForWeek(weekNum){
  const n = parseInt(weekNum, 10);
  if(isNaN(n) || n<1) return null;
  const d = new Date(TERM_START);
  d.setDate(d.getDate() + (n-1)*7);
  if(d >= READING_WEEK_START) d.setDate(d.getDate()+7);
  return d;
}

function collectDeadlines(){
  const dated = [];
  COURSES.forEach(c=>{
    (c.syllabus||[]).forEach(row=>{
      const [wk, dateStr, topics, classwork] = row;
      if(!classwork || !classwork.trim()) return;
      let date = parseSyllabusDate(dateStr);
      let estimated = false;
      if(!date && wk && wk!=='—' && !isNaN(parseInt(wk,10))){
        date = estimateDateForWeek(wk);
        estimated = true;
      }
      if(!date) return;
      dated.push({ course:c, week:wk, dateStr, topics, classwork, date, estimated });
    });
  });
  dated.sort((a,b)=>a.date-b.date);
  return { dated };
}

function courseById(id){
  if (!id) return null;
  return COURSES.find(c => c.id === id || (c.code && c.code.toLowerCase() === id.toLowerCase()));
}

/* =========================================================================
   DATA SYNC WITH SUPABASE
   Merges dynamic database courses/materials into local memory
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

        // Extract materials across modules
        const dbMaterials = [];
        (dbC.modules || []).forEach(mod => {
          (mod.materials || []).forEach(mat => {
            dbMaterials.push({
              ...mat,
              moduleTitle: mod.title
            });
          });
        });
        match.cloudMaterials = dbMaterials;
        if (dbMaterials.length > 0) match.hasMaterial = true;
      } else {
        // Course discovered in Supabase that wasn't hardcoded
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
   UI RENDERING
   ========================================================================= */
function render(){
  const app = document.getElementById('app');
  if(!app) return;
  const curCourse = courseById(state.courseId);
  app.innerHTML = state.view==='dashboard' ? renderDashboard() : renderCourse(curCourse || COURSES[0]);
  attachHandlers();
  renderSettingsModal();
  renderPracticeStudioOverlay();
  renderMath();
}

function renderMath(){
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

function renderPracticeStudioOverlay(){
  const existing = document.getElementById('practice-studio-host');
  if(existing) existing.remove();
  if(!practiceStudioOpen) return;

  const div = document.createElement('div');
  div.id = 'practice-studio-host';
  div.innerHTML = `
    <div class="ps-fullscreen">
      <div class="ps-topbar">
        <div class="ps-back" id="ps-back">${icon('arrowLeft')} Back</div>
        <div class="ps-label">Linear Algebra Practice Studio</div>
      </div>
      <iframe id="practice-studio-frame" class="ps-iframe" title="Practice Studio"></iframe>
    </div>
  `;
  document.body.appendChild(div);

  const frame = document.getElementById('practice-studio-frame');
  if(frame) frame.srcdoc = decodeB64Utf8(LINEAR_ALGEBRA_STUDIO_B64 || '');

  const backBtn = document.getElementById('ps-back');
  if(backBtn) backBtn.addEventListener('click', ()=>{
    practiceStudioOpen = false;
    render();
  });
}

function renderCalendarPanel(){
  const { dated } = collectDeadlines();
  const today = new Date(); today.setHours(0,0,0,0);
  const horizonEnd = new Date(today); horizonEnd.setDate(horizonEnd.getDate()+30);
  const next30 = dated.filter(d=>d.date>=today && d.date<horizonEnd);

  const viewYear = calendarViewMonth ? calendarViewMonth.year : today.getFullYear();
  const viewMonth = calendarViewMonth ? calendarViewMonth.month : today.getMonth();
  const monthDeadlines = dated.filter(d=>d.date.getFullYear()===viewYear && d.date.getMonth()===viewMonth);
  const deadlineDayKeys = new Set(monthDeadlines.map(d=>d.date.toDateString()));

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();
  const startPad = firstOfMonth.getDay();

  const cells = [];
  for(let i=0;i<startPad;i++) cells.push(null);
  for(let i=1;i<=daysInMonth;i++) cells.push(new Date(viewYear, viewMonth, i));

  const gridHtml = cells.map(d=>{
    if(!d) return `<div class="mini-cal-cell empty"></div>`;
    const key = d.toDateString();
    const isToday = key===today.toDateString();
    const isSelected = key===calendarSelectedDay;
    const hasDeadline = deadlineDayKeys.has(key);
    return `<div class="mini-cal-cell ${isToday?'today':''} ${hasDeadline?'has-dot':''} ${isSelected?'selected':''}" data-daykey="${key}">
      <span class="mini-cal-num">${d.getDate()}</span>${hasDeadline?'<span class="mini-cal-dot"></span>':''}
    </div>`;
  }).join('');

  const showingDay = !!calendarSelectedDay;
  const agendaSource = showingDay
    ? dated.filter(d=>d.date.toDateString()===calendarSelectedDay)
    : next30;
  const agendaHtml = agendaSource.length ? agendaSource.map(d=>`
    <div class="cal-row" data-course="${d.course.id}" style="--block-color:${d.course.accent}">
      <div class="cal-date">${d.date.toLocaleDateString(undefined,{month:'short',day:'numeric'})}${d.estimated?' <span class="cal-est">~</span>':''}</div>
      <div class="cal-main">
        <div class="cal-course">${d.course.code}</div>
        <div class="cal-item">${d.classwork}</div>
      </div>
    </div>`).join('') : `<div class="empty-day">${showingDay ? 'Nothing due this day.' : 'Nothing due in the next 30 days.'}</div>`;

  const hasEstimates = agendaSource.some(d=>d.estimated);
  const isCurrentMonth = viewYear===today.getFullYear() && viewMonth===today.getMonth();
  const monthLabel = firstOfMonth.toLocaleDateString(undefined,{month:'long', year:'numeric'});

  return `
    <div class="panel cal-widget">
      <div class="cal-widget-head" id="cal-widget-toggle">
        <h2 class="headfont">${icon('calendar')} Calendar <span class="cal-widget-sub">next 30 days · ${next30.length} due</span></h2>
        <div class="icon-btn cal-caret ${calendarExpanded?'open':''}">${icon('chevronDown')}</div>
      </div>
      ${calendarExpanded ? `
        <div class="mini-cal-nav">
          <div class="icon-btn sm" id="cal-prev-month">${icon('chevronLeft')}</div>
          <div class="mini-cal-month headfont">${monthLabel}</div>
          <div class="icon-btn sm" id="cal-next-month">${icon('chevronRight')}</div>
          ${!isCurrentMonth || calendarSelectedDay ? `<div class="cal-today-btn" id="cal-jump-today">Today</div>` : ''}
        </div>
        <div class="mini-cal-grid">
          ${['S','M','T','W','T','F','S'].map(d=>`<div class="mini-cal-dow">${d}</div>`).join('')}
          ${gridHtml}
        </div>
        <div class="dim-divider">${showingDay ? new Date(calendarSelectedDay).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}) : 'Next 30 days'}${showingDay ? ` <span class="cal-clear-day" id="cal-clear-day">(show all)</span>` : ''}</div>
        <div class="cal-list">${agendaHtml}</div>
        ${hasEstimates ? `<div class="hint" style="margin-top:8px;">~ estimated from the course's module/week number</div>` : ''}
      ` : ''}
    </div>`;
}

function renderDashboard(){
  const dayCols = DAYS.map((d,i)=>{
    const blocks = [];
    COURSES.forEach(c=>{
      (c.schedule||[]).filter(s=>s.day===d).forEach(s=>{
        blocks.push(`<div class="block" data-course="${c.id}" style="--block-color:${c.accent}">
          <div class="t">${s.start}\u2013${s.end} · ${s.type}${s.room?(' · '+s.room):''}</div>
          <div class="c">${c.code}</div>
        </div>`);
      });
    });
    return `<div class="day-col ${i===TODAY_IDX?'is-today':''}">
      <div class="day-name">${d}</div>
      ${blocks.length ? blocks.join('') : '<div class="empty-day">No campus classes</div>'}
    </div>`;
  }).join('');

  const loadedCount = COURSES.filter(c=>c.hasMaterial).length;
  const progressSegs = COURSES.map(c=>`<div class="progress-seg ${c.hasMaterial?'on':''}" style="--seg-color:${c.accent}"></div>`).join('');

  const courseCards = COURSES.map((c,i)=>`
    <div class="course-card enter" data-course="${c.id}" style="--card-color:${c.accent}; animation-delay:${i*45}ms">
      <div class="code">${c.code}</div>
      <div class="name">${c.name}</div>
      <div class="instr">${c.instructor && c.instructor!=='—' ? c.instructor : 'Async · Slate Online'}</div>
      <span class="status-pill ${c.hasMaterial?'has':'none'}">${c.hasMaterial?'Materials loaded':'No materials yet'}</span>
    </div>
  `).join('');

  const supabaseReady = isSupabaseConfigured();

  return `
    <div class="topbar">
      <div>
        <h1 class="headfont">School Center</h1>
        <div class="sub">Abdullah Massraf · Fall 2026 · Honours B.Eng (Mechanical)</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <div class="progress-pill">
          <div class="progress-track">${progressSegs}</div>
          ${loadedCount} of ${COURSES.length} courses loaded
          <span style="display:inline-flex;align-items:center;margin-left:4px;color:${supabaseReady?'var(--accent-2)':'var(--accent-3)'}" title="${supabaseReady?'Connected to Supabase':'Using local memory'}">
            ${icon('cloud')}
          </span>
        </div>
        <div class="today-badge headfont">${new Date().toLocaleDateString(undefined,{weekday:'long', month:'short', day:'numeric'})}</div>
        <div class="icon-btn" id="open-settings" title="Theme, Cloud & AI settings">${icon('gear')}</div>
      </div>
    </div>

    <div class="panel">
      <h2 class="headfont">This week</h2>
      <div class="week-grid">${dayCols}</div>
    </div>

    ${renderCalendarPanel()}

    <div class="panel">
      <h2 class="headfont">Courses</h2>
      <div class="course-grid">${courseCards}</div>
    </div>

    <div class="footer-note">Click a course to open its workspace — lectures, materials, worksheets, and tutoring notes.</div>
  `;
}

function renderCourse(c){
  const tabs = ['materials','lectures','worksheets','syllabus','notes'];
  const tabLabel = {
    materials: 'AI Materials & Documents',
    lectures: 'Lectures',
    worksheets: 'Worksheets',
    syllabus: 'Course Outline',
    notes: 'Tutor Notes'
  };

  let body = '';

  if(state.tab === 'materials'){
    const cloudMaterials = c.cloudMaterials || [];
    if(!cloudMaterials.length){
      body = `
        <div class="no-material" style="text-align:center;padding:32px 16px;">
          <p>No document files uploaded for ${c.code} yet.</p>
          <button class="btn-primary" id="go-upload-btn" style="margin-top:12px;">Upload Course Files</button>
        </div>
      `;
    } else {
      body = cloudMaterials.map((m, idx) => {
        const json = m.content_json || {};
        const statusClass = m.status === 'completed' ? 'ok' : (m.status === 'error' ? 'err' : '');
        const questions = json.practice_questions || [];
        const concepts = json.key_concepts || [];

        return `
          <div class="lecture-block enter" style="margin-bottom:20px; animation-delay:${idx*40}ms">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;">
              <div>
                <h3 style="margin:0 0 4px 0;">${m.title}</h3>
                <div style="font-size:0.75rem;color:var(--muted);">${m.moduleTitle || 'General'} · Type: ${m.type}</div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <span class="file-chip" style="margin:0;padding:4px 10px;">
                  <span class="status ${statusClass}">${m.status}</span>
                </span>
                ${m.file_url ? `
                  <a href="${m.file_url}" target="_blank" rel="noopener noreferrer" class="icon-btn sm" title="Open original document" style="text-decoration:none;">
                    ${icon('download')}
                  </a>
                ` : ''}
              </div>
            </div>

            ${m.error_message ? `
              <div style="color:var(--accent-3);font-size:0.8rem;background:rgba(240,96,138,0.1);padding:8px 12px;border-radius:var(--radius-sm);margin-bottom:12px;">
                Extraction note: ${m.error_message}
              </div>
            ` : ''}

            ${json.summary ? `
              <div style="background:rgba(255,255,255,0.03);border-left:3px solid var(--course-accent, #8B7CF6);padding:12px 14px;border-radius:0 var(--radius-sm) var(--radius-sm) 0;margin-bottom:14px;font-size:0.9rem;">
                <b style="color:var(--ink);display:block;margin-bottom:4px;">Document Summary:</b>
                ${json.summary}
              </div>
            ` : ''}

            ${concepts.length ? `
              <div style="margin-bottom:14px;">
                <div class="dim-divider" style="margin:10px 0 8px 0;">Key Concepts & Formulas</div>
                <ul class="concept-list">
                  ${concepts.map(con => `<li>${con}</li>`).join('')}
                </ul>
              </div>
            ` : ''}

            ${questions.length ? `
              <div style="margin-top:14px;">
                <div class="dim-divider" style="margin:10px 0 8px 0;">Extracted Practice Questions (${questions.length})</div>
                <div style="display:flex;flex-direction:column;gap:10px;">
                  ${questions.map((q, qIdx) => `
                    <div style="background:rgba(0,0,0,0.25);border:1px solid var(--hairline);border-radius:var(--radius-sm);padding:12px 14px;">
                      <div style="font-size:0.92rem;font-weight:600;margin-bottom:6px;">Q${qIdx+1}: ${q.question}</div>
                      <details style="margin-top:6px;cursor:pointer;">
                        <summary style="font-size:0.78rem;color:var(--accent-2);outline:none;">View Step-by-Step Solution</summary>
                        <div style="margin-top:8px;font-size:0.88rem;color:var(--ink);background:rgba(255,255,255,0.03);padding:10px;border-radius:var(--radius-sm);line-height:1.5;">
                          ${q.solution}
                        </div>
                      </details>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            ${json.parsed_markdown ? `
              <details style="margin-top:14px;cursor:pointer;">
                <summary style="font-size:0.8rem;color:var(--muted);outline:none;">Full Parsed Notes</summary>
                <div style="margin-top:10px;font-size:0.88rem;color:var(--ink);white-space:pre-wrap;background:rgba(0,0,0,0.3);padding:14px;border-radius:var(--radius-sm);line-height:1.6;">
                  ${json.parsed_markdown}
                </div>
              </details>
            ` : ''}
          </div>
        `;
      }).join('');
    }
  } else if(state.tab==='lectures'){
    if(!c.lectures || !c.lectures.length){
      body = `<div class="no-material">No lecture summaries added for ${c.name} yet.</div>`;
    } else {
      body = c.lectures.map(l=>`
        <div class="lecture-block">
          <h3>${l.title}</h3>
          <ul class="concept-list">
            ${l.concepts.map(([term,def])=>`<li><b>${term}</b> — ${def}</li>`).join('')}
          </ul>
        </div>
      `).join('');
    }
  } else if(state.tab==='worksheets'){
    const hasAnyWorksheets = (c.worksheets && c.worksheets.length) || c.hasPracticeStudio;
    if(!hasAnyWorksheets){
      body = `<div class="no-material">No worksheets added for ${c.name} yet.</div>`;
    } else if(state.worksheetView===null){
      const bars = [];
      if(c.hasPracticeStudio){
        bars.push(`
          <div class="ws-bar ws-bar-ai" data-worksheet="ai-studio">
            <div class="ws-bar-icon">${icon('spark')}</div>
            <div class="ws-bar-text">
              <div class="ws-bar-title">AI Practice Studio</div>
              <div class="ws-bar-sub">Worked examples + step-by-step practice, generated with AI</div>
            </div>
            <div class="ws-bar-chev">${icon('chevronRight')}</div>
          </div>`);
      }
      (c.worksheets||[]).forEach((w,i)=>{
        bars.push(`
          <div class="ws-bar" data-worksheet="${i}">
            <div class="ws-bar-icon">${icon('doc')}</div>
            <div class="ws-bar-text">
              <div class="ws-bar-title">${w.title}</div>
              <div class="ws-bar-sub">${w.items.length} problem${w.items.length===1?'':'s'}</div>
            </div>
            <div class="ws-bar-chev">${icon('chevronRight')}</div>
          </div>`);
      });
      body = `<div class="ws-bar-list">${bars.join('')}</div>`;
    } else {
      const w = c.worksheets[state.worksheetView];
      body = `
        <div class="ws-detail-head">
          <div class="backlink" id="ws-back">${icon('arrowLeft')} Back to worksheets</div>
        </div>
        <div class="lecture-block">
          <h3>${w.title}</h3>
          <ul class="ws-list">${w.items.map(i=>`<li>${i}</li>`).join('')}</ul>
        </div>
      `;
    }
  } else if(state.tab==='syllabus'){
    if(!c.syllabus || !c.syllabus.length){
      body = `<div class="no-material">No course outline available for ${c.name} yet.</div>`;
    } else {
      body = `
        ${c.evaluation ? `
        <div class="lecture-block">
          <h3>Evaluation</h3>
          <div class="eval-grid">
            ${c.evaluation.map(([k,v])=>`<div>${k}</div><div class="v">${v}</div>`).join('')}
          </div>
          ${c.textbook ? `<div class="dim-divider">Textbook</div><div>${c.textbook}</div>` : ''}
        </div>` : ''}
        <div class="lecture-block">
          <h3>Weekly Topics</h3>
          <table class="syllabus">
            <tr><th>Wk</th><th>Week of</th><th>Topics</th><th>Classwork</th></tr>
            ${c.syllabus.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('')}
          </table>
        </div>
      `;
    }
  } else if(state.tab==='notes'){
    body = `
      <div class="note-form">
        <textarea id="note-input" placeholder="Add a note from today's tutoring session..."></textarea>
        <button id="note-add">Save note</button>
      </div>
      <div id="notes-list">Loading notes…</div>
    `;
  }

  return `
    <div style="--course-accent:${c.accent}">
      <div class="topbar">
        <div class="backlink" id="back-btn">${icon('arrowLeft')} Back to dashboard</div>
        <div class="icon-btn" id="open-settings" title="Upload & Settings">${icon('gear')}</div>
      </div>
      <div class="course-header">
        <h2 class="headfont"><span class="accent-dot"></span>${c.code} — ${c.name}</h2>
        <div class="meta">${c.instructor && c.instructor!=='—' ? c.instructor : 'Async · Slate Online'}</div>
      </div>
      <div class="tabs">
        ${tabs.map(t=>`<div class="tab ${state.tab===t?'active':''}" data-tab="${t}">${tabLabel[t]}</div>`).join('')}
      </div>
      <div class="panel">${body}</div>
    </div>
  `;
}

/* =========================================================================
   NOTES PERSISTENCE
   ========================================================================= */
async function loadNotes(courseId){
  try{
    const res = await storage.get(`notes:${courseId}`, false);
    return res && res.value ? JSON.parse(res.value) : [];
  }catch(e){ return []; }
}
async function saveNotes(courseId, notes){
  try{ await storage.set(`notes:${courseId}`, JSON.stringify(notes), false); }
  catch(e){ console.error('Could not save notes', e); }
}

async function renderNotesList(courseId){
  const list = document.getElementById('notes-list');
  if(!list) return;
  const notes = await loadNotes(courseId);
  if(!notes.length){
    list.innerHTML = `<div class="no-notes">No tutor notes yet for this course. Notes you add here will stay saved.</div>`;
    return;
  }
  list.innerHTML = notes.slice().reverse().map(n=>`
    <div class="note-item" data-id="${n.id}">
      <div class="del" data-del="${n.id}">remove</div>
      <div class="when">${new Date(n.createdAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</div>
      <div>${n.text.replace(/</g,'&lt;')}</div>
    </div>
  `).join('');

  list.querySelectorAll('[data-del]').forEach(el=>{
    el.addEventListener('click', async ()=>{
      const id = el.getAttribute('data-del');
      const cur = await loadNotes(courseId);
      const next = cur.filter(n=>n.id!==id);
      await saveNotes(courseId, next);
      renderNotesList(courseId);
    });
  });
}

/* =========================================================================
   SETTINGS & CLOUD / UPLOAD MODAL
   ========================================================================= */
const API_KEY_STORAGE = 'schoolcenter_ai_key_v1';

async function loadApiKey(){
  try{
    const res = await storage.get(API_KEY_STORAGE, false);
    return res && res.value ? res.value : '';
  }catch(e){ return ''; }
}
async function saveApiKey(key){
  try{ await storage.set(API_KEY_STORAGE, key, false); }
  catch(e){ console.error('Could not save API key', e); }
}

function openSettings(){ settingsOpen = true; render(); }
function closeSettings(){ settingsOpen = false; pendingFiles = []; render(); }

function renderSettingsModal(){
  const host = document.getElementById('settings-host');
  if(host) host.remove();
  if(!settingsOpen) return;

  const currentSupabaseUrl = localStorage.getItem('sc_supabase_url') || document.querySelector('meta[name="supabase-url"]')?.content || '';
  const currentSupabaseKey = localStorage.getItem('sc_supabase_anon_key') || document.querySelector('meta[name="supabase-anon-key"]')?.content || '';

  const div = document.createElement('div');
  div.id = 'settings-host';
  div.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal">
        <div class="modal-head">
          <h2 class="headfont">Settings & Cloud Pipeline</h2>
          <div class="modal-close" id="modal-close">${icon('close')}</div>
        </div>

        <div class="field-label">Theme</div>
        <div class="theme-row" id="theme-row">
          ${Object.entries(THEME_PRESETS).map(([key,t])=>`
            <div class="swatch ${currentTheme && currentTheme.key===key ? 'active':''}" data-theme-key="${key}"
              style="background:linear-gradient(135deg, ${t.accent}, ${t.lava[1]})" title="${t.label}"></div>
          `).join('')}
          <input type="color" class="theme-color-input" id="custom-color-input"
            value="${currentTheme && currentTheme.accentHex ? currentTheme.accentHex : '#8B7CF6'}"
            title="Custom accent color">
        </div>
        <div class="hint">Pick a lava lamp palette or custom color accent.</div>

        <div class="field-label" style="margin-top:22px;">Supabase Cloud Backend</div>
        <input type="text" id="supabase-url-input" placeholder="https://your-project.supabase.co" value="${currentSupabaseUrl}" style="margin-bottom:8px;" />
        <input type="password" id="supabase-key-input" placeholder="sb_publishable_..." value="${currentSupabaseKey}" />
        <div class="hint">Your project credentials enable real-time cloud persistence and automated Gemini edge indexing.</div>
        <div style="margin-top:10px;display:flex;gap:8px;">
          <button class="btn-primary" id="save-supabase-btn">Save Cloud Config</button>
        </div>

        <div class="field-label" style="margin-top:22px;">Google Gemini API Key (Direct Fallback)</div>
        <input type="password" id="api-key-input" placeholder="AIza..." value="" />
        <div class="hint">Used when uploading files without an Edge Function, or testing models locally. Get one free at <span style="color:var(--accent)">aistudio.google.com</span>.</div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-primary" id="save-key-btn">Save Gemini Key</button>
          <button class="btn-ghost" id="clear-key-btn">Clear</button>
        </div>

        <div class="field-label" style="margin-top:24px;">Cloud Document Ingestion (Drag & Drop)</div>
        <div class="upload-drop" id="upload-drop">
          Drop course files here or tap to select<br>
          <span class="hint">PDFs, DOCX, TXT, MD, Images — automatic Gemini 2.0 extraction</span>
          <input type="file" id="file-input" multiple accept=".pdf,.docx,.txt,.md,.csv,.png,.jpg" style="display:none;">
        </div>

        <select class="upload-select" id="target-course">
          ${COURSES.map(c=>`<option value="${c.id}" ${state.courseId===c.id?'selected':''}>${c.code} — ${c.name}</option>`).join('')}
        </select>

        <div id="file-list"></div>

        <div style="margin-top:14px;">
          <button class="btn-primary" id="process-files-btn" ${pendingFiles.length? '':'disabled'}>
            Process with AI Pipeline
          </button>
        </div>

        <div class="ai-log" id="ai-log"></div>
      </div>
    </div>
  `;
  document.body.appendChild(div);
  attachSettingsHandlers();
}

function logAI(msg){
  const log = document.getElementById('ai-log');
  if(!log) return;
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function showToast(msg){
  const existing = document.querySelector('.settings-toast');
  if(existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'settings-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 2600);
}

function renderFileList(){
  const list = document.getElementById('file-list');
  if(!list) return;
  list.innerHTML = pendingFiles.map((f,i)=>`
    <div class="file-chip">
      <div class="name">${f.file.name}</div>
      <div class="status ${f.status==='completed'?'ok':(f.status==='error'?'err':'')}" title="${f.errMsg||''}">
        ${f.statusText || f.status}
      </div>
      <div class="rm" data-rm="${i}">${icon('close')}</div>
    </div>
  `).join('');

  list.querySelectorAll('[data-rm]').forEach(el=>{
    el.addEventListener('click', ()=>{
      pendingFiles.splice(Number(el.getAttribute('data-rm')),1);
      renderFileList();
    });
  });

  const processBtn = document.getElementById('process-files-btn');
  if(processBtn && !isProcessingFiles){
    const readyCount = pendingFiles.filter(f=>f.status==='ready').length;
    processBtn.disabled = readyCount === 0;
    processBtn.textContent = readyCount > 0 
      ? `Process ${readyCount} Document${readyCount>1?'s':''} with AI` 
      : 'Process with AI Pipeline';
  }
}

async function attachSettingsHandlers(){
  const backdrop = document.getElementById('modal-backdrop');
  const modal = backdrop ? backdrop.querySelector('.modal') : null;
  if(backdrop) backdrop.addEventListener('click', (e)=>{ if(e.target===backdrop) closeSettings(); });
  if(modal) modal.addEventListener('click', (e)=>e.stopPropagation());
  const closeBtn = document.getElementById('modal-close');
  if(closeBtn) closeBtn.addEventListener('click', closeSettings);

  // Supabase Save
  const saveSbBtn = document.getElementById('save-supabase-btn');
  if(saveSbBtn){
    saveSbBtn.addEventListener('click', async ()=>{
      const u = document.getElementById('supabase-url-input').value;
      const k = document.getElementById('supabase-key-input').value;
      saveSupabaseConfig(u, k);
      showToast('Supabase settings saved');
      await syncDataFromSupabase();
    });
  }

  // Gemini Key
  const keyInput = document.getElementById('api-key-input');
  if(keyInput){
    loadApiKey().then(k=>{ if(keyInput) keyInput.value = k; });
  }
  const saveKeyBtn = document.getElementById('save-key-btn');
  if(saveKeyBtn){
    saveKeyBtn.addEventListener('click', async ()=>{
      await saveApiKey(keyInput.value.trim());
      showToast('Gemini API key saved');
    });
  }
  const clearKeyBtn = document.getElementById('clear-key-btn');
  if(clearKeyBtn){
    clearKeyBtn.addEventListener('click', async ()=>{
      await saveApiKey('');
      keyInput.value = '';
      showToast('Gemini API key cleared');
    });
  }

  // Theme
  document.querySelectorAll('[data-theme-key]').forEach(el=>{
    el.addEventListener('click', async ()=>{
      const key = el.getAttribute('data-theme-key');
      const t = { ...THEME_PRESETS[key], key };
      applyTheme(t);
      await saveTheme(t);
      render();
    });
  });
  const customColor = document.getElementById('custom-color-input');
  if(customColor){
    customColor.addEventListener('input', async ()=>{
      const t = buildCustomTheme(customColor.value);
      applyTheme(t);
      await saveTheme(t);
    });
    customColor.addEventListener('change', ()=>{ render(); });
  }

  // File Upload
  const drop = document.getElementById('upload-drop');
  const fileInput = document.getElementById('file-input');
  if(drop && fileInput){
    drop.addEventListener('click', ()=>fileInput.click());
    drop.addEventListener('dragover', (e)=>{ e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', ()=>drop.classList.remove('drag'));
    drop.addEventListener('drop', (e)=>{
      e.preventDefault(); drop.classList.remove('drag');
      queueFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', ()=>{
      queueFiles(fileInput.files);
    });
  }

  const processBtn = document.getElementById('process-files-btn');
  if(processBtn){
    processBtn.addEventListener('click', executeProcessingPipeline);
  }

  renderFileList();
}

function queueFiles(fileListRaw){
  const files = Array.from(fileListRaw || []);
  const targetCourseId = document.getElementById('target-course')?.value || (COURSES[0] && COURSES[0].id);
  files.forEach(f=>{
    pendingFiles.push({
      file: f,
      status: 'ready',
      statusText: 'Ready',
      courseId: targetCourseId
    });
  });
  renderFileList();
}

async function executeProcessingPipeline(){
  if(isProcessingFiles) return;
  const todo = pendingFiles.filter(f=>f.status==='ready');
  if(!todo.length){
    logAI('No files in queue.');
    return;
  }

  isProcessingFiles = true;
  const processBtn = document.getElementById('process-files-btn');
  if(processBtn){ processBtn.disabled = true; processBtn.textContent = 'Processing files...'; }

  for(const item of todo){
    const course = courseById(item.courseId);
    try {
      if(isSupabaseConfigured()){
        // Upload to Cloud Storage & Edge Function Pipeline
        await uploadAndProcessFile({
          file: item.file,
          course,
          onProgress: (prog)=>{
            item.status = prog.status;
            item.statusText = prog.text;
            renderFileList();
          },
          onLog: (msg)=>logAI(msg)
        });
      } else {
        // Standalone client processing
        logAI(`Supabase is not configured — reading "${item.file.name}" locally...`);
        item.status = 'processing';
        item.statusText = 'Reading text...';
        renderFileList();
        
        let textContent = '';
        if (item.file.name.toLowerCase().endsWith('.pdf')) {
          throw new Error('PDF direct browser parsing requires Supabase Edge pipeline. Please configure Supabase in settings.');
        } else {
          textContent = await item.file.text();
        }

        const fallbackKey = await loadApiKey();
        if(!fallbackKey) throw new Error('No Gemini API key found for standalone processing.');

        logAI(`Calling Gemini API directly...`);
        // Client fallback call
        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(fallbackKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [{ text: `Analyze course document for ${course.code}: \n"""${textContent.slice(0, 10000)}"""\nReturn JSON: {"summary":"...","key_concepts":["..."],"practice_questions":[{"question":"...","solution":"..."}]}` }]
            }],
            generationConfig: { responseMimeType: 'application/json' }
          })
        });

        if(!geminiRes.ok) throw new Error(`Gemini HTTP error ${geminiRes.status}`);
        const resData = await geminiRes.json();
        const rawJson = resData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const parsed = JSON.parse(rawJson);

        if(!course.cloudMaterials) course.cloudMaterials = [];
        course.cloudMaterials.push({
          id: 'local_' + Date.now(),
          title: item.file.name,
          type: 'lecture',
          content_json: parsed,
          status: 'completed'
        });
        course.hasMaterial = true;

        item.status = 'completed';
        item.statusText = 'Added to course ✓';
        logAI(`✓ Document processed for ${course.code}!`);
      }
    } catch(err) {
      console.error(err);
      item.status = 'error';
      item.statusText = 'Failed';
      item.errMsg = err.message;
      logAI(`✗ Error processing ${item.file.name}: ${err.message}`);
    }
    renderFileList();
  }

  isProcessingFiles = false;
  if(processBtn){ processBtn.disabled = false; }
  await syncDataFromSupabase();
  render();
  showToast('Course materials updated');
}

/* =========================================================================
   EVENT HANDLERS ATTACHMENT
   ========================================================================= */
function attachHandlers(){
  const settingsBtn = document.getElementById('open-settings');
  if(settingsBtn) settingsBtn.addEventListener('click', openSettings);

  const goUpload = document.getElementById('go-upload-btn');
  if(goUpload) goUpload.addEventListener('click', openSettings);

  document.querySelectorAll('[data-worksheet]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const v = el.getAttribute('data-worksheet');
      if(v==='ai-studio'){
        practiceStudioOpen = true;
      } else {
        state.worksheetView = parseInt(v,10);
      }
      render();
    });
  });

  const wsBack = document.getElementById('ws-back');
  if(wsBack) wsBack.addEventListener('click', ()=>{
    state.worksheetView = null;
    render();
  });

  const calToggle = document.getElementById('cal-widget-toggle');
  if(calToggle) calToggle.addEventListener('click', ()=>{
    calendarExpanded = !calendarExpanded;
    if(!calendarExpanded){ calendarViewMonth = null; calendarSelectedDay = null; }
    render();
  });

  const calPrev = document.getElementById('cal-prev-month');
  if(calPrev) calPrev.addEventListener('click', (e)=>{
    e.stopPropagation();
    const today = new Date();
    const cur = calendarViewMonth || { year: today.getFullYear(), month: today.getMonth() };
    let { year, month } = cur;
    month--; if(month<0){ month=11; year--; }
    calendarViewMonth = { year, month };
    calendarSelectedDay = null;
    render();
  });

  const calNext = document.getElementById('cal-next-month');
  if(calNext) calNext.addEventListener('click', (e)=>{
    e.stopPropagation();
    const today = new Date();
    const cur = calendarViewMonth || { year: today.getFullYear(), month: today.getMonth() };
    let { year, month } = cur;
    month++; if(month>11){ month=0; year++; }
    calendarViewMonth = { year, month };
    calendarSelectedDay = null;
    render();
  });

  const calJumpToday = document.getElementById('cal-jump-today');
  if(calJumpToday) calJumpToday.addEventListener('click', (e)=>{
    e.stopPropagation();
    calendarViewMonth = null;
    calendarSelectedDay = null;
    render();
  });

  const calClearDay = document.getElementById('cal-clear-day');
  if(calClearDay) calClearDay.addEventListener('click', (e)=>{
    e.stopPropagation();
    calendarSelectedDay = null;
    render();
  });

  document.querySelectorAll('.mini-cal-cell[data-daykey]').forEach(el=>{
    el.addEventListener('click', (e)=>{
      e.stopPropagation();
      const key = el.getAttribute('data-daykey');
      calendarSelectedDay = calendarSelectedDay===key ? null : key;
      render();
    });
  });

  document.querySelectorAll('[data-course]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const cId = el.getAttribute('data-course');
      state = { view:'course', courseId: cId, tab:'materials', worksheetView:null };
      render();
    });
  });

  const back = document.getElementById('back-btn');
  if(back) back.addEventListener('click', ()=>{ 
    state = { view:'dashboard', courseId:null, tab:'materials', worksheetView:null }; 
    render(); 
  });

  document.querySelectorAll('[data-tab]').forEach(el=>{
    el.addEventListener('click', ()=>{
      state.tab = el.getAttribute('data-tab');
      state.worksheetView = null;
      render();
    });
  });

  if(state.view==='course' && state.tab==='notes'){
    renderNotesList(state.courseId);
    const addBtn = document.getElementById('note-add');
    if(addBtn){
      addBtn.addEventListener('click', async ()=>{
        const input = document.getElementById('note-input');
        const text = input.value.trim();
        if(!text) return;
        const notes = await loadNotes(state.courseId);
        notes.push({ id: 'n'+Date.now(), text, createdAt: Date.now() });
        await saveNotes(state.courseId, notes);
        input.value = '';
        renderNotesList(state.courseId);
      });
    }
  }
}

/* =========================================================================
   INITIALIZATION
   ========================================================================= */
(async function init(){
  const canvas = document.getElementById('lava-canvas');
  if(canvas) lavaEngine = createLavaEngine(canvas);
  const theme = await loadTheme();
  applyTheme(theme);
  if(lavaEngine) lavaEngine.start();

  // Initial render
  render();

  // Connect Realtime listener if Supabase is active
  setupRealtimeListener((updatedMaterial) => {
    logAI(`Realtime update: Material ${updatedMaterial.title} is now ${updatedMaterial.status}`);
    syncDataFromSupabase();
  });

  // Fetch initial data from Supabase
  await syncDataFromSupabase();
})();
