// ABOUTME: Unit tests for the Coral Wave easter-egg module.
// ABOUTME: Run with: node --test tests/coralwave.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  coralWaveMode, splitUniformsForBox,
  CORAL_TEAL, CORAL_MAGENTA, patchMaterial, CORAL_GLSL,
  hilbertCurve, drawHilbertPattern,
} from '../assets/coralwave.js';

test('coralWaveMode distinguishes plain, hilbert, and off', () => {
  assert.equal(coralWaveMode(new URLSearchParams('?filament=coralwave')), 'coralwave');
  assert.equal(coralWaveMode(new URLSearchParams('?filament=CoralWave')), 'coralwave');
  assert.equal(coralWaveMode(new URLSearchParams('?filament=coralwavehilbert')), 'coralwavehilbert');
  assert.equal(coralWaveMode(new URLSearchParams('?filament=CoralWaveHilbert')), 'coralwavehilbert');
  assert.equal(coralWaveMode(new URLSearchParams('?filament=pla')), null);
  assert.equal(coralWaveMode(new URLSearchParams('?model=x')), null);
  assert.equal(coralWaveMode(new URLSearchParams('')), null);
});

test('splitUniformsForBox centers the divide and scales the blend', () => {
  const u = splitUniformsForBox({ min: { x: 10, y: 0, z: 0 }, max: { x: 30, y: 40, z: 4 } });
  assert.equal(u.splitX, 20);                    // bbox center
  assert.ok(Math.abs(u.blendHalf - 0.8) < 1e-9); // 8% of 20-wide extent / 2
  assert.ok(u.waveFreq > 0);
  assert.ok(u.waveAmp > 0);
});

test('splitUniformsForBox tolerates a degenerate box', () => {
  const u = splitUniformsForBox({ min: { x: 5, y: 5, z: 5 }, max: { x: 5, y: 5, z: 5 } });
  assert.equal(u.splitX, 5);
  assert.ok(u.blendHalf > 0);        // never zero — GLSL smoothstep needs a nonzero band
  assert.ok(Number.isFinite(u.waveFreq));
});

test('filament colors match the spec hexes', () => {
  const hex = (rgb) => rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
  assert.equal(hex(CORAL_TEAL), '0177a1');
  assert.equal(hex(CORAL_MAGENTA), 'c22376');
});

test('GLSL snippet mixes both filament colors', () => {
  assert.ok(CORAL_GLSL.includes('uCoralTeal'));
  assert.ok(CORAL_GLSL.includes('uCoralMagenta'));
  assert.ok(CORAL_GLSL.includes('smoothstep'));
});

test('hilbertCurve fills the unit square in adjacent steps', () => {
  const order = 3;
  const pts = hilbertCurve(order);
  assert.equal(pts.length, 4 ** order);
  const step = 1 / (2 ** order);
  for (const [x, y] of pts) {
    assert.ok(x > 0 && x < 1 && y > 0 && y < 1);
  }
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i][0] - pts[i - 1][0]);
    const dy = Math.abs(pts[i][1] - pts[i - 1][1]);
    assert.ok(Math.abs(dx + dy - step) < 1e-9, `step ${i} is one cell`);
    assert.ok(dx < 1e-9 || dy < 1e-9, `step ${i} is axis-aligned`);
  }
  // No revisits: every cell exactly once.
  assert.equal(new Set(pts.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`)).size, pts.length);
});

test('drawHilbertPattern strokes the whole curve on a black field', () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_, prop) => (typeof prop === 'string')
      ? (...args) => { calls.push([prop, args]); }
      : undefined,
    set: () => true,
  });
  drawHilbertPattern(ctx, 512, 4);
  const names = calls.map(([n]) => n);
  assert.equal(names.filter((n) => n === 'fillRect').length, 1);
  assert.equal(names.filter((n) => n === 'moveTo').length, 1);
  assert.equal(names.filter((n) => n === 'lineTo').length, 4 ** 4 - 1);
  assert.equal(names.at(-1), 'stroke');
});

test('patchMaterial wires hilbert uniforms and world-normal varying', () => {
  const material = { needsUpdate: false };
  const uniforms = {
    ...splitUniformsForBox({ min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 2, z: 2 } }),
    hilbertTex: { isTexture: true }, hilbertScale: 0.025,
    hilbertTint: 0.5, hilbertRelief: 0.6,
  };
  patchMaterial(material, uniforms);
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>',
  };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uHilbertTex.value, uniforms.hilbertTex);
  assert.equal(shader.uniforms.uHilbertScale.value, 0.025);
  assert.ok(shader.vertexShader.includes('vCoralWorldNormal'));
  assert.ok(shader.fragmentShader.includes('uHilbertTex'));
  assert.ok(shader.fragmentShader.includes('vCoralWorldNormal'));
});

test('patchMaterial installs onBeforeCompile without clobbering the material', () => {
  const material = { needsUpdate: false, metalness: 0.3 };
  const uniforms = splitUniformsForBox({ min: { x: -1, y: 0, z: 0 }, max: { x: 1, y: 2, z: 1 } });
  patchMaterial(material, uniforms);
  assert.equal(typeof material.onBeforeCompile, 'function');
  assert.equal(material._coralWave, true);
  assert.equal(material.needsUpdate, true);
  assert.equal(material.metalness, 0.3);

  // The hook injects our uniforms and GLSL into a stub shader.
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>',
  };
  material.onBeforeCompile(shader);
  assert.ok(shader.uniforms.uSplitX);
  assert.ok(shader.uniforms.uCoralTeal);
  assert.ok(shader.fragmentShader.includes('smoothstep'));
  assert.ok(shader.vertexShader.includes('vCoralWorldPos'));
});
