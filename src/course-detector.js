// ============================================================================
// src/course-detector.js — Intelligent Course Association & Detection Engine
// ============================================================================

const COURSE_SIGNATURES = [
  {
    id: 'math15325d',
    code: 'MATH15325D',
    name: 'Linear Algebra',
    accent: '#8B7CF6',
    codes: ['MATH15325D', 'MATH15325', 'MATH 15325'],
    keywords: [
      'linear algebra', 'matrix', 'matrices', 'vector', 'vector space',
      'subspace', 'determinant', 'eigenvalue', 'eigenvector', 'rref',
      'echelon', 'pivot', 'cramer', 'null space', 'column space',
      'gram-schmidt', 'orthogonal', 'least squares', 'svd', 'hosseini'
    ]
  },
  {
    id: 'engr36035d',
    code: 'ENGR36035D',
    name: 'Introduction to Energy Systems',
    accent: '#34D1BF',
    codes: ['ENGR36035D', 'ENGR36035', 'ENGR 36035'],
    keywords: [
      'energy systems', 'thermo', 'thermodynamics', 'diesel engine',
      'heat transfer', 'rankine', 'brayton', 'efficiency', 'combustion',
      'turbine', 'power plant', 'refrigeration', 'entropy', 'enthalpy',
      'atomic mass', 'isotopes', 'dr. amin', 'energy'
    ]
  },
  {
    id: 'engr43301d',
    code: 'ENGR43301D',
    name: 'Economics & Entrepreneurship',
    accent: '#F5A623',
    codes: ['ENGR43301D', 'ENGR43301', 'ENGR 43301'],
    keywords: [
      'engineering economics', 'economics', 'entrepreneurship',
      'cash flow', 'net present value', 'npv', 'internal rate of return',
      'irr', 'depreciation', 'interest rate', 'breakeven', 'annuity',
      'capital cost', 'amortization', 'stewart'
    ]
  },
  {
    id: 'anth17028gd',
    code: 'ANTH17028GD',
    name: 'Anthropology of Health',
    accent: '#F0608A',
    codes: ['ANTH17028GD', 'ANTH17028', 'ANTH 17028'],
    keywords: [
      'anthropology', 'anthropology of health', 'medical anthropology',
      'health equity', 'indigenous health', 'cultural health', 'epidemiology',
      'healing systems', 'illness narrative', 'biomedicine', 'land acknowledgement',
      'ginter'
    ]
  },
  {
    id: 'engl17889gd',
    code: 'ENGL17889GD',
    name: 'Composition & Rhetoric',
    accent: '#5FD37A',
    codes: ['ENGL17889GD', 'ENGL17889', 'ENGL 17889'],
    keywords: [
      'composition', 'rhetoric', 'collaborative research', 'research proposal',
      'annotated bibliography', 'peer review', 'thesis statement',
      'rhetorical analysis', 'argument', 'citation', 'mla', 'apa',
      'group contract', 'fhass', 'bloom'
    ]
  }
];

/**
 * Evaluates text or filename and returns the highest-scoring course candidate.
 * @param {string} filename - name of the file
 * @param {string} [contentSnippet=''] - snippet of text from the file or note
 * @param {Array} [allCourses=[]] - optional live courses list
 * @returns {{ courseId: string, courseCode: string, courseName: string, confidence: 'high'|'medium'|'low', reason: string }}
 */
export function detectCourseFromContent(filename = '', contentSnippet = '', allCourses = []) {
  const combined = `${filename} ${contentSnippet}`.toLowerCase();

  let bestMatch = null;
  let highestScore = 0;
  let matchedReason = '';

  for (const sig of COURSE_SIGNATURES) {
    let score = 0;
    let reason = '';

    // Direct course code match in filename = immediate high confidence
    for (const code of sig.codes) {
      if (filename.toLowerCase().includes(code.toLowerCase())) {
        score += 100;
        reason = `Matched course code "${code}" in filename`;
        break;
      }
    }

    // Direct course code match in content snippet
    if (score < 100) {
      for (const code of sig.codes) {
        if (contentSnippet.toLowerCase().includes(code.toLowerCase())) {
          score += 70;
          reason = `Found course code "${code}" inside content`;
          break;
        }
      }
    }

    // Keyword analysis
    let keywordHits = 0;
    for (const kw of sig.keywords) {
      if (combined.includes(kw)) {
        keywordHits++;
        score += 15;
      }
    }

    if (keywordHits > 0 && !reason) {
      reason = `Matched ${keywordHits} domain keyword${keywordHits > 1 ? 's' : ''} for ${sig.name}`;
    }

    if (score > highestScore) {
      highestScore = score;
      bestMatch = sig;
      matchedReason = reason;
    }
  }

  // Determine confidence
  if (bestMatch && highestScore >= 50) {
    return {
      courseId: bestMatch.id,
      courseCode: bestMatch.code,
      courseName: bestMatch.name,
      confidence: highestScore >= 70 ? 'high' : 'medium',
      reason: matchedReason
    };
  }

  // Fallback to first course or default
  const fallback = COURSE_SIGNATURES[0];
  return {
    courseId: fallback.id,
    courseCode: fallback.code,
    courseName: fallback.name,
    confidence: 'low',
    reason: 'No distinctive keywords found; defaulting to primary course.'
  };
}
