// ABOUTME: Unit tests for the settings store and SpaceMouse axis remapping.
// ABOUTME: Run with: node --test tests/settings.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, loadSettings, saveSettings, normalizeMapping,
  applySwapPreset, isSwapPreset, remapMatrixFromMapping, isIdentityMapping,
  mat4Multiply, mat4Transpose, applyMat4ToVec3,
} from '../assets/settings.js';

const fakeStorage = (seed = {}) => {
  const map = new Map(Object.entries(seed));
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
};

test('loadSettings returns defaults on empty or garbage storage', () => {
  assert.deepEqual(loadSettings(fakeStorage()), DEFAULT_SETTINGS);
  assert.deepEqual(loadSettings(fakeStorage({ 'cadscope-settings': '{oops' })), DEFAULT_SETTINGS);
});

test('loadSettings deep-merges saved values over defaults', () => {
  const s = fakeStorage({ 'cadscope-settings': JSON.stringify({ spacemouse: { enabled: false } }) });
  const loaded = loadSettings(s);
  assert.equal(loaded.spacemouse.enabled, false);
  assert.deepEqual(loaded.spacemouse.mapping, DEFAULT_SETTINGS.spacemouse.mapping);
});

test('save/load round-trips', () => {
  const s = fakeStorage();
  const custom = structuredClone(DEFAULT_SETTINGS);
  custom.spacemouse.mapping.io.invert = true;
  saveSettings(s, custom);
  assert.deepEqual(loadSettings(s), custom);
});

test('normalizeMapping swaps the duplicated pair into the displaced row', () => {
  const m = structuredClone(DEFAULT_SETTINGS.spacemouse.mapping);
  m.io.pair = 'x'; // now duplicates lr
  const n = normalizeMapping(m, 'io');
  assert.equal(n.io.pair, 'x');
  assert.equal(n.lr.pair, 'z'); // received io's previous pair
  assert.equal(n.ud.pair, 'y');
});

test('swap preset writes io=y ud=z and is detected', () => {
  const m = applySwapPreset(structuredClone(DEFAULT_SETTINGS.spacemouse.mapping));
  assert.equal(m.io.pair, 'y');
  assert.equal(m.ud.pair, 'z');
  assert.equal(isSwapPreset(m), true);
  assert.equal(isSwapPreset(DEFAULT_SETTINGS.spacemouse.mapping), false);
});

test('identity mapping yields the identity matrix', () => {
  assert.equal(isIdentityMapping(DEFAULT_SETTINGS.spacemouse.mapping), true);
  assert.deepEqual(remapMatrixFromMapping(DEFAULT_SETTINGS.spacemouse.mapping),
    [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
});

test('swap preset matrix exchanges Y and Z', () => {
  const R = remapMatrixFromMapping(applySwapPreset(structuredClone(DEFAULT_SETTINGS.spacemouse.mapping)));
  assert.deepEqual(applyMat4ToVec3(R, [0, 0, 1]), [0, 1, 0]); // driver io(Z) → world Y
  assert.deepEqual(applyMat4ToVec3(R, [0, 1, 0]), [0, 0, 1]); // driver ud(Y) → world Z
  assert.deepEqual(applyMat4ToVec3(R, [1, 0, 0]), [1, 0, 0]);
});

test('inverts negate the mapped axis', () => {
  const m = structuredClone(DEFAULT_SETTINGS.spacemouse.mapping);
  m.lr.invert = true;
  assert.deepEqual(applyMat4ToVec3(remapMatrixFromMapping(m), [1, 0, 0]), [-1, 0, 0]);
});

test('R times its transpose is identity for every permutation and invert combo', () => {
  const pairs = ['x', 'y', 'z'];
  for (const a of pairs) for (const b of pairs) for (const c of pairs) {
    if (a === b || b === c || a === c) continue;
    for (let bits = 0; bits < 8; bits++) {
      const m = {
        lr: { pair: a, invert: !!(bits & 1) },
        ud: { pair: b, invert: !!(bits & 2) },
        io: { pair: c, invert: !!(bits & 4) },
      };
      const R = remapMatrixFromMapping(m);
      assert.deepEqual(mat4Multiply(R, mat4Transpose(R)), [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    }
  }
});
