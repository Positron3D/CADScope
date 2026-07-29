// ABOUTME: Unit tests for the Coral Wave easter-egg module.
// ABOUTME: Run with: node --test tests/coralwave.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  coralWaveRequested, splitUniformsForBox,
  CORAL_TEAL, CORAL_MAGENTA, patchMaterial, CORAL_GLSL,
} from '../assets/coralwave.js';

test('coralWaveRequested only for filament=coralwave', () => {
  assert.equal(coralWaveRequested(new URLSearchParams('?filament=coralwave')), true);
  assert.equal(coralWaveRequested(new URLSearchParams('?filament=CoralWave')), true);
  assert.equal(coralWaveRequested(new URLSearchParams('?filament=pla')), false);
  assert.equal(coralWaveRequested(new URLSearchParams('?model=x')), false);
  assert.equal(coralWaveRequested(new URLSearchParams('')), false);
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
