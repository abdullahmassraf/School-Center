// Verification test for Fall 2026 Timetable
import assert from 'node:assert';

const FALL_2026_SCHEDULE = [
  // MONDAY
  { day: 1, dayName: 'Mon', start: '11:00 AM', end: '12:00 PM', courseCode: 'MATH 15325D', courseName: 'Linear Algebra', type: 'Lecture', room: 'C328', instructor: 'Cyrus Hosseini', accent: '#8B7CF6' },
  { day: 1, dayName: 'Mon', start: '1:00 PM', end: '3:00 PM', courseCode: 'MATH 15325D', courseName: 'Linear Algebra', type: 'Lab', room: 'J301', instructor: 'Cyrus Hosseini', accent: '#8B7CF6' },
  { day: 1, dayName: 'Mon', start: '3:00 PM', end: '4:00 PM', courseCode: 'MATH 15325D', courseName: 'Linear Algebra', type: 'Lecture', room: 'J301', instructor: 'TBA', accent: '#8B7CF6' },
  
  // TUESDAY
  { day: 2, dayName: 'Tue', start: '9:00 AM', end: '12:00 PM', courseCode: 'ENGR 36035D', courseName: 'Intro to Energy Systems', type: 'Lecture', room: 'C271', instructor: 'Amin Ghobeity', accent: '#34D1BF' },
  
  // WEDNESDAY
  { day: 3, dayName: 'Wed', start: '10:00 AM', end: '12:00 PM', courseCode: 'MATH 15325D', courseName: 'Linear Algebra', type: 'Lecture', room: 'J301', instructor: 'Cyrus Hosseini', accent: '#8B7CF6' },
  
  // THURSDAY
  { day: 4, dayName: 'Thu', start: '3:00 PM', end: '5:00 PM', courseCode: 'ENGR 36035D', courseName: 'Intro to Energy Systems', type: 'Lab', room: 'A305', instructor: 'Amin Ghobeity', accent: '#34D1BF' },
  
  // FRIDAY
  { day: 5, dayName: 'Fri', start: '1:00 PM', end: '4:00 PM', courseCode: 'ENGR 43301D', courseName: 'Economics & Entrepreneurship', type: 'Lecture', room: 'Online (VTL)', instructor: 'Manju Sunil Varghese', accent: '#F5A623' }
];

function getClassesForDate(dateStr) {
  // Parse date without timezone shift
  const [y, m, d] = dateStr.split('T')[0].split('-').map(Number);
  const dateObj = new Date(y, m - 1, d, 12, 0, 0);
  const dayOfWeek = dateObj.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  return FALL_2026_SCHEDULE.filter(s => s.day === dayOfWeek);
}

// Test Sep 14, 2026 (Monday)
const monClasses = getClassesForDate('2026-09-14T12:00:00');
assert.strictEqual(monClasses.length, 3, 'Monday Sep 14 must have exactly 3 classes');
assert.strictEqual(monClasses[0].room, 'C328');
assert.strictEqual(monClasses[1].room, 'J301');
assert.strictEqual(monClasses[2].room, 'J301');

// Test Sep 15, 2026 (Tuesday)
const tueClasses = getClassesForDate('2026-09-15T12:00:00');
assert.strictEqual(tueClasses.length, 1, 'Tuesday Sep 15 must have 1 Energy Systems lecture');
assert.strictEqual(tueClasses[0].courseCode, 'ENGR 36035D');
assert.strictEqual(tueClasses[0].room, 'C271');
assert.strictEqual(tueClasses[0].instructor, 'Amin Ghobeity');

// Test Sep 16, 2026 (Wednesday)
const wedClasses = getClassesForDate('2026-09-16T12:00:00');
assert.strictEqual(wedClasses.length, 1, 'Wednesday Sep 16 must have 1 Linear Algebra lecture');
assert.strictEqual(wedClasses[0].start, '10:00 AM');
assert.strictEqual(wedClasses[0].end, '12:00 PM');
assert.strictEqual(wedClasses[0].room, 'J301');

// Test Sep 17, 2026 (Thursday)
const thuClasses = getClassesForDate('2026-09-17T12:00:00');
assert.strictEqual(thuClasses.length, 1, 'Thursday Sep 17 must have 1 Energy Systems lab');
assert.strictEqual(thuClasses[0].type, 'Lab');
assert.strictEqual(thuClasses[0].room, 'A305');

// Test Sep 18, 2026 (Friday)
const friClasses = getClassesForDate('2026-09-18T12:00:00');
assert.strictEqual(friClasses.length, 1, 'Friday Sep 18 must have 1 Economics lecture');
assert.strictEqual(friClasses[0].courseCode, 'ENGR 43301D');
assert.strictEqual(friClasses[0].room, 'Online (VTL)');

// Test Sep 19 & 20, 2026 (Saturday & Sunday)
const satClasses = getClassesForDate('2026-09-19T12:00:00');
const sunClasses = getClassesForDate('2026-09-20T12:00:00');
assert.strictEqual(satClasses.length, 0, 'Saturday has 0 campus classes');
assert.strictEqual(sunClasses.length, 0, 'Sunday has 0 campus classes');

console.log('✅ ALL CALENDAR ENGINE TESTS PASSED!');
