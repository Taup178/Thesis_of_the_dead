import * as THREE from 'three';

/** Small internal cloth volumes close exposed seams on the kit's segmented limbs. */
export class OpeningJointLining {
  constructor(scene, model) {
    this.geometry = new THREE.SphereGeometry(1, 12, 8);
    this.materials = {
      shirt: new THREE.MeshStandardMaterial({ color: 0x365647, roughness: 0.95 }),
      cuff: new THREE.MeshStandardMaterial({ color: 0x292c25, roughness: 0.95 }),
      trousers: new THREE.MeshStandardMaterial({ color: 0x4a8080, roughness: 0.95 }),
    };
    this.parts = [];
    for (const side of ['L', 'R']) {
      for (const [name, material, scale] of [
        [`UpperArm${side}`, 'shirt', [0.073, 0.09, 0.073]],
        [`LowerArm${side}`, 'cuff', [0.072, 0.085, 0.072]],
        [`LowerLeg${side}`, 'trousers', [0.087, 0.09, 0.087]],
      ]) {
        const bone = model.getObjectByName(name);
        if (!bone) continue;
        const mesh = new THREE.Mesh(this.geometry, this.materials[material]);
        mesh.scale.fromArray(scale); mesh.castShadow = false; mesh.receiveShadow = false;
        mesh.name = `OpeningClothLining_${name}`;
        scene.add(mesh); this.parts.push({ mesh, bone });
      }
    }
    this.update();
  }

  update() {
    for (const { mesh, bone } of this.parts) bone.getWorldPosition(mesh.position);
  }

  dispose() {
    for (const { mesh } of this.parts) mesh.removeFromParent();
    this.geometry.dispose();
    Object.values(this.materials).forEach(material => material.dispose());
  }
}
