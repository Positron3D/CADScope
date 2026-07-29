// ABOUTME: Unit tests for the navlib session state machine, driven with
// ABOUTME: verbatim frames captured from Nl-Proxy v1.4.6 on 2026-07-29.
// Run with: node --test tests/spacemouse.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSession, NL_URL, NL_SUBPROTOCOL } from '../assets/spacemouse.js';

const WELCOME = '[0,"yXeYxo5BNoswbxL1",1,"Nl-Proxy v1.4.6.21008 Copyright 2013-2021 3Dconnexion. All rights reserved."]';
const CONNEXION_RESULT = (id) => JSON.stringify([3, id, { connexion: 'x6ub2F8bZFZHmJVi' }]);
const INSTANCE_RESULT = (id) => JSON.stringify([3, id, { instance: 3557366488562 }]);
const READ_EVENT = (srvId, prop) =>
  JSON.stringify([8, '3dconnexion:3dcontroller/3557366488562', [2, srvId, 'self:read', '', prop]]);
const UPDATE_EVENT = (srvId, prop, value) =>
  JSON.stringify([8, '3dconnexion:3dcontroller/3557366488562', [2, srvId, 'self:update', '', prop, value]]);

function harness(overrides = {}) {
  const sent = [];
  const updates = [];
  let registered = 0;
  const session = createSession({
    send: (s) => sent.push(JSON.parse(s)),
    now: () => 1785344665342,
    readProperty: (name) => ({ 'view.affine': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 2, 1] })[name],
    applyUpdate: (name, value) => updates.push([name, value]),
    onRegistered: () => registered++,
    ...overrides,
  });
  return { session, sent, updates, registered: () => registered };
}

// Drives the full handshake; returns the harness in the registered state.
function registeredHarness() {
  const h = harness();
  h.session.onMessage(WELCOME);
  const createId = h.sent.find((m) => m[0] === 2 && m[2] === '3dx_rpc:create')[1];
  h.session.onMessage(CONNEXION_RESULT(createId));
  const ctrlId = h.sent.filter((m) => m[0] === 2 && m[2] === '3dx_rpc:create')[1][1];
  h.session.onMessage(INSTANCE_RESULT(ctrlId));
  return h;
}

test('welcome triggers prefixes and 3dmouse create', () => {
  const h = harness();
  h.session.onMessage(WELCOME);
  const prefixes = h.sent.filter((m) => m[0] === 1);
  assert.deepEqual(prefixes, [
    [1, '3dx_rpc', 'wss://127.51.68.120/3dconnexion#'],
    [1, '3dconnexion', 'wss://127.51.68.120/3dconnexion'],
    [1, 'self', 'spacemouse://local'],
  ]);
  const create = h.sent.find((m) => m[0] === 2);
  assert.equal(create[2], '3dx_rpc:create');
  assert.equal(create[3], '3dconnexion:3dmouse');
  assert.equal(create[4], '0.8.1');
});

test('connexion result triggers controller create with app name', () => {
  const h = harness();
  h.session.onMessage(WELCOME);
  const createId = h.sent.find((m) => m[0] === 2)[1];
  h.session.onMessage(CONNEXION_RESULT(createId));
  const ctrl = h.sent.filter((m) => m[0] === 2 && m[2] === '3dx_rpc:create')[1];
  assert.equal(ctrl[3], '3dconnexion:3dcontroller');
  assert.equal(ctrl[4], 'x6ub2F8bZFZHmJVi');
  assert.deepEqual(ctrl[5], { version: 0.8, name: 'CADScope', rowMajorOrder: false });
});

test('instance result subscribes, focuses, sets timing source, fires onRegistered', () => {
  const h = registeredHarness();
  assert.deepEqual(
    h.sent.find((m) => m[0] === 5),
    [5, '3dconnexion:3dcontroller/3557366488562']);
  const updates = h.sent.filter((m) => m[0] === 2 && m[2] === '3dx_rpc:update').map((m) => m[4]);
  assert.deepEqual(updates[0], { focus: true });
  assert.deepEqual(updates[1], { frame: { timingSource: 1 } });
  assert.equal(h.registered(), 1);
});

test('read events answer with the callback value', () => {
  const h = registeredHarness();
  h.session.onMessage(READ_EVENT('srv1', 'view.affine'));
  const answer = h.sent.find((m) => m[0] === 3 && m[1] === 'srv1');
  assert.deepEqual(answer[2], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 2, 1]);
});

test('unknown property reads answer null', () => {
  const h = registeredHarness();
  h.session.onMessage(READ_EVENT('srv2', 'selection.affine'));
  assert.deepEqual(h.sent.find((m) => m[0] === 3 && m[1] === 'srv2'), [3, 'srv2', null]);
});

test('update events invoke applyUpdate and acknowledge', () => {
  const h = registeredHarness();
  h.session.onMessage(UPDATE_EVENT('srv3', 'motion', true));
  h.session.onMessage(UPDATE_EVENT('srv4', 'view.affine', [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]));
  assert.deepEqual(h.updates[0], ['motion', true]);
  assert.deepEqual(h.updates[1][1], [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]);
  assert.deepEqual(h.sent.find((m) => m[0] === 3 && m[1] === 'srv3'), [3, 'srv3', {}]);
});

test('pumpFrame is a no-op before registration and emits frame time after', () => {
  const h = harness();
  h.session.pumpFrame();
  assert.equal(h.sent.length, 0);
  const r = registeredHarness();
  const before = r.sent.length;
  r.session.pumpFrame();
  const pump = r.sent[before];
  assert.equal(pump[2], '3dx_rpc:update');
  assert.deepEqual(pump[4], { frame: { time: 1785344665342 } });
});

test('exports the discovered endpoint constants', () => {
  assert.equal(NL_URL, 'wss://127.51.68.120:8182');
  assert.equal(NL_SUBPROTOCOL, 'wamp');
});
