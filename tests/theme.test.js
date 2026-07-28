// ABOUTME: Unit tests for the viewer theme resolution logic.
// ABOUTME: Run with: node --test tests/theme.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTheme, nextTheme } from '../assets/theme.js';

test('resolveTheme accepts the two valid stored values', () => {
  assert.equal(resolveTheme('light'), 'light');
  assert.equal(resolveTheme('dark'), 'dark');
});

test('resolveTheme falls back to dark for unrecognized values', () => {
  assert.equal(resolveTheme('blurple'), 'dark');
  assert.equal(resolveTheme(''), 'dark');
  assert.equal(resolveTheme('LIGHT'), 'dark');
});

test('resolveTheme falls back to dark for null and undefined', () => {
  assert.equal(resolveTheme(null), 'dark');
  assert.equal(resolveTheme(undefined), 'dark');
});

test('nextTheme flips between the two themes', () => {
  assert.equal(nextTheme('dark'), 'light');
  assert.equal(nextTheme('light'), 'dark');
});
