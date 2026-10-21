import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MonsterDegreeFlight } from '../src/enemies/MonsterDegreeFlight.js';
import { MonsterRockWaves } from '../src/enemies/MonsterRockWaves.js';

function player(x = 0, z = 14) {
  const p = { group: new THREE.Group(), alive: true, isDodging: false, hits: [],
    takeDamage(damage, impact) { this.hits.push({ damage, source: impact.source.clone() }); } };
  p.group.position.set(x, 0, z); return p;
}

function flight() {
  const root = new THREE.Group(), grip = new THREE.Group(), scroll = new THREE.Group();
  grip.position.set(0.7, 1.6, 0); root.add(grip); grip.add(scroll); scroll.scale.set(0.82, 0.78, 0.78);
  root.updateMatrixWorld(true);
  return { root, grip, scroll, flight: new MonsterDegreeFlight(root, scroll, grip) };
}

for (const dt of [1 / 60, 0.15]) test(`degree crosses the player outbound and from behind on return (${dt}s frames)`, () => {
  const f = flight(), p = player(), scale = f.scroll.getWorldScale(new THREE.Vector3());
  f.flight.launch(p.group.position);
  let returnWasBeyond = false, previous = f.scroll.getWorldPosition(new THREE.Vector3());
  for (let frame = 0; frame < 1500 && f.flight.active; frame++) {
    const before = p.hits.length;
    f.flight.update(dt, p);
    if (p.hits.length > before && f.flight.leg === 'return') returnWasBeyond = previous.z > p.group.position.z;
    previous = f.scroll.getWorldPosition(new THREE.Vector3());
  }
  assert.deepEqual(p.hits.map(hit => hit.damage), [22, 22]);
  assert.ok(returnWasBeyond, 'return threatens from beyond the player, not the boss side');
  assert.equal(f.scroll.parent, f.grip); assert.ok(f.scroll.position.length() < 1e-7);
  assert.ok(f.scroll.getWorldScale(new THREE.Vector3()).distanceTo(scale) < 1e-6);
  f.flight.dispose();
});

test('rolling through outbound does not remove the degree return threat', () => {
  const f = flight(), p = player(); f.flight.launch(p.group.position);
  for (let frame = 0; frame < 1500 && f.flight.active; frame++) {
    p.isDodging = f.flight.leg === 'outbound'; f.flight.update(1 / 60, p);
  }
  assert.deepEqual(p.hits.map(hit => hit.damage), [22]);
  f.flight.dispose();
});

test('degree return commits to the new player position once and can be evaded', () => {
  const f = flight(), p = player(); f.flight.launch(p.group.position);
  p.group.position.x = 3;
  while (f.flight.active && f.flight.leg === 'outbound') f.flight.update(1 / 60, p);
  assert.equal(f.flight.returnAim.x, 3);
  p.group.position.x = -7;
  while (f.flight.active) f.flight.update(1 / 60, p);
  assert.equal(p.hits.length, 0, 'moving out of both committed paths avoids damage');
  assert.equal(f.flight.returnAim.x, 3, 'return does not track the player continuously');
  f.flight.dispose();
});

test('degree flight respects vertical separation and clears safely on death', () => {
  const f = flight(), p = player(); p.group.position.y = 4; f.flight.launch(new THREE.Vector3(0, 0, 14));
  while (f.flight.active && f.flight.leg === 'outbound') f.flight.update(1 / 60, p);
  assert.equal(p.hits.length, 0, 'outbound scroll passes beneath the airborne player');
  p.group.position.y = 8;
  for (let i = 0; i < 500 && f.flight.active; i++) f.flight.update(1 / 60, p);
  assert.equal(p.hits.length, 0);
  f.flight.launch(new THREE.Vector3(0, 0, 14)); p.alive = false; f.flight.update(0.1, p);
  assert.equal(f.flight.active, false); assert.equal(f.scroll.parent, f.grip);
  f.flight.dispose();
});

test('three committed rock lanes travel beyond 45m, damage once each and allow rolling/jumping', () => {
  const root = new THREE.Group(), waves = new MonsterRockWaves(root), p = player(0, 45);
  const directions = [-Math.PI / 6, 0, Math.PI / 6].map(angle => new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)));
  for (const direction of directions) waves.launch(new THREE.Vector3(), direction);
  for (let i = 0; i < 400; i++) waves.update(1 / 60, p);
  assert.deepEqual(p.hits.map(hit => hit.damage), [24], 'only the center lane reaches this player');
  assert.ok(waves.pool.every(wave => !wave.active));
  for (const mode of ['roll', 'jump']) {
    p.hits.length = 0; p.isDodging = mode === 'roll'; p.group.position.y = mode === 'jump' ? 3 : 0;
    waves.launch(new THREE.Vector3(), directions[1]);
    for (let i = 0; i < 100; i++) waves.update(0.1, p);
    assert.equal(p.hits.length, 0, mode);
  }
  waves.dispose(); assert.equal(root.children.length, 0);
});
