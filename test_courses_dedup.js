import assert from 'node:assert';

function cleanCourseCode(code) {
  return (code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

console.log('Testing cleanCourseCode...');
assert.strictEqual(cleanCourseCode('MATH 15325D'), 'MATH15325D');
assert.strictEqual(cleanCourseCode('MATH15325D'), 'MATH15325D');
assert.strictEqual(cleanCourseCode('math15325d'), 'MATH15325D');
assert.strictEqual(cleanCourseCode('ENGR 36035D'), 'ENGR36035D');
assert.strictEqual(cleanCourseCode('ENGR36035D'), 'ENGR36035D');
assert.strictEqual(cleanCourseCode('ENGR 43301D'), 'ENGR43301D');
assert.strictEqual(cleanCourseCode('ANTH 17028GD'), 'ANTH17028GD');
assert.strictEqual(cleanCourseCode('ENGL 17889GD'), 'ENGL17889GD');

// Simulate Supabase response with unspaced course codes
const dbCourses = [
  { id: 'uuid-1', code: 'MATH15325D', name: 'Linear Algebra', instructor: 'Cyrus Hosseini, PhD PEng' },
  { id: 'uuid-2', code: 'ENGR36035D', name: 'Introduction to Energy Systems', instructor: 'Dr. Amin' },
  { id: 'uuid-3', code: 'ENGR43301D', name: 'Economics & Entrepreneurship', instructor: 'Prof. Stewart' },
  { id: 'uuid-4', code: 'ANTH17028GD', name: 'Anthropology of Health', instructor: 'Jaime Ginter' },
  { id: 'uuid-5', code: 'ENGL17889GD', name: 'Composition & Rhetoric', instructor: 'Professor' }
];

// Initial static courses
let testCourses = [
  { id:'math15325d', code:'MATH 15325D', name:'Linear Algebra' },
  { id:'engr36035d', code:'ENGR 36035D', name:'Intro to Energy Systems' },
  { id:'engr43301d', code:'ENGR 43301D', name:'Economics & Entrepreneurship' },
  { id:'anth17028gd', code:'ANTH 17028GD', name:'Anthropology of Health' },
  { id:'engl17889gd', code:'ENGL 17889GD', name:'Composition & Rhetoric' }
];

dbCourses.forEach(dbC => {
  const dbKey = cleanCourseCode(dbC.code || dbC.id);
  const match = testCourses.find(c => 
    cleanCourseCode(c.code) === dbKey || 
    cleanCourseCode(c.id) === dbKey || 
    (c.dbId && c.dbId === dbC.id)
  );

  if (match) {
    match.dbId = dbC.id;
    if (dbC.name && (!match.name || match.name === dbC.code)) match.name = dbC.name;
    if (dbC.instructor) match.instructor = dbC.instructor;
  } else {
    testCourses.push({
      id: dbC.code.toLowerCase(),
      code: dbC.code,
      name: dbC.name
    });
  }
});

// Strict deduplication
const seen = new Set();
testCourses = testCourses.filter(c => {
  const key = cleanCourseCode(c.code) || cleanCourseCode(c.id);
  if (!key || seen.has(key)) return false;
  seen.add(key);
  return true;
});

assert.strictEqual(testCourses.length, 5, `Expected exactly 5 enrolled courses, got ${testCourses.length}`);
console.log('✅ COURSE DEDUPLICATION TEST PASSED: Exactly 5 enrolled courses verified.');
