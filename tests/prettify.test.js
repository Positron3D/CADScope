// ABOUTME: Unit tests for the scene-tree node-name prettifier.
// ABOUTME: Run with: node --test tests/prettify.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { prettifyNodeName } from '../assets/prettify.js';

const CASES = [
  // Underscores → spaces, capitalization.
  ['X_Carriage', 'X Carriage'],
  ['a_belt_clip_(1)', 'A Belt Clip'],
  ['heat_set_practice', 'Heat Set Practice'],
  ['XZ_Gantry', 'XZ Gantry'],
  ['Prusa_MK4_Frame_Assembly', 'Prusa MK4 Frame Assembly'],
  // Parenthesized duplicate copies.
  ['M3_Threaded_Insert_(10)', 'M3 Threaded Insert'],
  ['M3x30_SHCS_(3)', 'M3x30 SHCS'],
  // Trailing runs of 3+ digits.
  ['16T002', '16T'],
  ['M3x8_SHCS001', 'M3x8 SHCS'],
  ['SOLID013', 'SOLID'],
  // Short digit tails survive.
  ['M3x8_SHCS', 'M3x8 SHCS'],
  ['8_Adapter', '8 Adapter'],
  // Non-numeric parens survive.
  ['Feet_Assembly_(Assembly)', 'Feet Assembly (Assembly)'],
  ['Front_Grill_&_Screen', 'Front Grill & Screen'],
  ['X_Axis_-_Extrusion_Assembly', 'X Axis - Extrusion Assembly'],
  // Pipeline "-N" dedup suffix.
  ['Fan-2', 'Fan'],
  // Stacked suffixes strip until stable.
  ['Foo_(2)001', 'Foo'],
  // Digits-only names are left alone.
  ['013', '013'],
  // Names that would strip to nothing fall back to the raw name.
  ['(1)', '(1)'],
  // Runs of underscores collapse.
  ['Foo__Bar', 'Foo Bar'],
];

for (const [input, expected] of CASES) {
  test(`prettifyNodeName(${JSON.stringify(input)}) → ${JSON.stringify(expected)}`, () => {
    assert.equal(prettifyNodeName(input), expected);
  });
}

test('empty and missing names pass through unchanged', () => {
  assert.equal(prettifyNodeName(''), '');
  assert.equal(prettifyNodeName(undefined), undefined);
  assert.equal(prettifyNodeName(null), null);
});
