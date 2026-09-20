/* Unit test: real solar position engine (NOAA low-precision).
 * Verifies day/night inversion fix + correct east→west sun arc with known
 * reference values for the Davis Campus coordinates (43.7230, -79.7130). */
import { solarPosition } from './src/campus-map-3d.js';

const cases = [
  /* [label, ISO-UTC, expectElevMin, expectElevMax, expectAzMin, expectAzMax] */
  ['sunrise ~7:10am EDT', '2026-09-20T11:10:00Z', -3, 3, 80, 100],    // east
  ['noon EDT (high)', '2026-09-20T16:00:00Z', 40, 48, 145, 175],      // south-ish, high
  ['3pm EDT', '2026-09-20T19:00:00Z', 36, 46, 195, 235],              // SW
  ['6pm EDT (low)', '2026-09-20T22:00:00Z', 8, 20, 245, 275],         // west
  /* Below-horizon azimuth is antipodal to noon's (154°+180°≈334°). */
  ['midnight EDT (deep night)', '2026-09-20T04:00:00Z', -50, -32, 320, 350],
  ['winter noon (low arc)', '2026-12-21T17:00:00Z', 18, 27, 165, 205]
];

let failed = 0;
for (const [label, iso, eMin, eMax, aMin, aMax] of cases) {
  const r = solarPosition(new Date(iso));
  const okE = r.elevationDeg >= eMin && r.elevationMax === undefined && r.elevationDeg <= eMax;
  const okA = r.azimuthDeg >= aMin && r.azimuthDeg <= aMax;
  const ok = okE && okA;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(26)} elev=${r.elevationDeg.toFixed(1)}° (want ${eMin}..${eMax})  az=${r.azimuthDeg.toFixed(0)}° (want ${aMin}..${aMax})`);
}
if (failed) { console.error(`${failed} solar case(s) failed`); process.exit(1); }
console.log('SOLAR ENGINE: all reference cases pass — day/night correct, sun rises in the east');
