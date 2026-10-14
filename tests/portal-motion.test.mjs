import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PortalPassage, PortalEmergence, PORTAL_TRAVEL_SPEED } from '../src/props/RoomExitPortal.js';

test('portal entrances and exits travel steadily at the Dean blade pace and restore their appearance', () => {
  for (const Passage of [PortalPassage, PortalEmergence]) {
    for (const distance of [3, 10]) {
      const group = new THREE.Group();
      const material = new THREE.MeshStandardMaterial();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.4), material);
      body.position.y = 0.9; group.add(body);
      const destination = group.position.clone();
      const passage = new Passage(group, new THREE.Vector3(0, 2.2, distance));
      let previous = passage.update(0);
      const speeds = [];
      for (let frame = 0; frame < 30; frame++) {
        const dt = passage.duration / 30;
        const current = passage.update(dt);
        speeds.push(current.distanceTo(previous) / dt);
        previous = current;
      }
      assert.ok(Math.min(...speeds) > PORTAL_TRAVEL_SPEED * 0.98, 'Travel never lingers near either end');
      assert.ok(Math.max(...speeds) < PORTAL_TRAVEL_SPEED * 1.02, 'Travel never accelerates past the blade-run pace');
      assert.ok(Math.max(...speeds) / Math.min(...speeds) < 1.02, 'Both directions keep a steady physical speed');
      if (Passage === PortalEmergence) {
        passage.update(0.001);
        assert.equal(group.visible, true);
        assert.equal(group.scale.x, 1);
        assert.ok(group.position.distanceTo(destination) < 1e-8, 'Emerging finishes on the exact safe landing');
      } else {
        passage.update(0.001);
        assert.equal(group.visible, false);
        assert.equal(passage.complete, false, 'The transition gets only a short settling interval');
        passage.update(0.12);
        assert.equal(passage.complete, true);
        passage.restore();
        assert.equal(group.visible, true);
        assert.equal(group.scale.x, 1);
      }
      assert.equal(material.opacity, 1);
      assert.equal(material.transparent, false);
      assert.equal(material.depthWrite, true);
      body.geometry.dispose(); material.dispose();
    }
  }
});
