/* GHG Tool — minimal test runner (zero-dep)
 *
 * Pattern: ogni file *.test.mjs importa { test, expect } da qui,
 * registra i test con test(name, fn). _runner registra automatica-
 * mente passes/failures e fa exit(1) se almeno un test fallisce.
 *
 * Niente Jest/Mocha: il tool è 100% browser-statico e non vogliamo
 * dipendenze di test in package.json.
 */
const _suites = [];
let _currentSuite = null;

export function describe (name, fn) {
  const prev = _currentSuite;
  _currentSuite = { name, tests: [] };
  fn();
  _suites.push(_currentSuite);
  _currentSuite = prev;
}

export function test (name, fn) {
  if (!_currentSuite) {
    // Permette test top-level senza describe
    _currentSuite = { name: '(top-level)', tests: [] };
    _suites.push(_currentSuite);
  }
  _currentSuite.tests.push({ name, fn });
}

export function expect (actual) {
  return {
    toBe (expected) {
      if (!Object.is(actual, expected)) {
        throw new Error(`expected ${repr(expected)}, got ${repr(actual)}`);
      }
    },
    toEqual (expected) {
      if (!deepEq(actual, expected)) {
        throw new Error(`expected ${repr(expected)}, got ${repr(actual)}`);
      }
    },
    toBeCloseTo (expected, digits = 6) {
      const diff = Math.abs(actual - expected);
      const tol = Math.pow(10, -digits) / 2;
      if (!(diff < tol)) {
        throw new Error(`expected ≈${expected} (±${tol}), got ${actual} (Δ ${diff})`);
      }
    },
    toBeNull () {
      if (actual !== null) throw new Error(`expected null, got ${repr(actual)}`);
    },
    toBeTruthy () {
      if (!actual) throw new Error(`expected truthy, got ${repr(actual)}`);
    },
    toBeFalsy () {
      if (actual) throw new Error(`expected falsy, got ${repr(actual)}`);
    },
    toContain (item) {
      if (!Array.isArray(actual) && typeof actual !== 'string') {
        throw new Error(`toContain: expected array/string, got ${repr(actual)}`);
      }
      if (!actual.includes(item)) {
        throw new Error(`expected ${repr(actual)} to contain ${repr(item)}`);
      }
    },
    toHaveLength (n) {
      if (!actual || actual.length !== n) {
        throw new Error(`expected length ${n}, got ${actual && actual.length}`);
      }
    }
  };
}

function deepEq (a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => deepEq(a[k], b[k]));
}
function repr (v) {
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

export async function run () {
  let passed = 0, failed = 0;
  const failures = [];
  for (const s of _suites) {
    console.log(`\n  ${s.name}`);
    for (const t of s.tests) {
      try {
        await t.fn();
        console.log(`    ✓ ${t.name}`);
        passed++;
      } catch (e) {
        console.log(`    ✗ ${t.name}`);
        console.log(`      ${e.message}`);
        failed++;
        failures.push({ suite: s.name, test: t.name, msg: e.message });
      }
    }
  }
  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\n  failures:');
    failures.forEach(f => console.log(`    ${f.suite} > ${f.test}: ${f.msg}`));
    process.exit(1);
  }
}
