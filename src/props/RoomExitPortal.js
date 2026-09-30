import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** The same animated portal used in the woods, scaled for the room's landing. */
export class RoomExitPortal {
  constructor(parent, position) {
    this.root = new THREE.Group(); this.root.name = 'SophomoreExitPortal'; this.root.position.copy(position); parent.add(this.root);
    this.center = position.clone().add(new THREE.Vector3(0, 2.2, 0));
    this.light = new THREE.PointLight(0x65ffb5, 45, 13, 2); this.light.position.set(0, 2.2, 0.6); this.root.add(this.light);
    const stone = new THREE.MeshStandardMaterial({ color: 0x46504a, metalness: 0.3, roughness: 0.7 });
    this.fallback = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.23, 12, 48), stone);
    this.fallback.position.y = 2.2; this.root.add(this.fallback);
    this.time = 0;
  }

  async load() {
    try {
      const gltf = await new GLTFLoader().loadAsync('./assets/models/portal/portal.gltf');
      this.model = gltf.scene;
      for (const [name, diameter] of [['Object_35', 10.3135], ['Object_17', 7.4], ['Object_19', 8.2]]) {
        const geometry = this.model.getObjectByName(name)?.geometry; if (!geometry) continue;
        geometry.computeBoundingBox(); const center = geometry.boundingBox.getCenter(new THREE.Vector3());
        const size = geometry.boundingBox.getSize(new THREE.Vector3());
        geometry.translate(-center.x, -center.y, -center.z); geometry.scale(diameter / size.x, diameter / size.x, diameter / size.x); geometry.translate(0, 4, 0);
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      }
      this.model.scale.setScalar(0.65); this.model.position.y = 1.68 * 0.65; this.root.add(this.model);
      this.model.traverse(node => {
        if (!node.isMesh) return;
        node.castShadow = node.receiveShadow = true;
        if (node.material.emissive?.getHex()) node.material.emissiveIntensity = 1.7;
      });
      this.fallback.removeFromParent(); this.fallback.geometry.dispose(); this.fallback.material.dispose();
      this.mixer = new THREE.AnimationMixer(this.model);
      for (const clip of gltf.animations) this.mixer.clipAction(clip).play();
      this.mixer.update(0); this.root.updateMatrixWorld(true);
      const opening = this.model.getObjectByName('Object_35');
      if (opening) new THREE.Box3().setFromObject(opening, true).getCenter(this.center);
    } catch (error) { console.warn('Using the room portal fallback:', error); }
    // A deep, moving surface gives the opening depth instead of an empty hoop.
    this.surface = new THREE.Mesh(new THREE.CircleGeometry(1.82, 64), new THREE.ShaderMaterial({
      side: THREE.DoubleSide, uniforms: { time: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `varying vec2 vUv; uniform float time;
        void main(){vec2 p=(vUv-.5)*2.; float r=length(p); float a=atan(p.y,p.x);
          float curl=sin(a*5.+r*18.-time*2.8)*.5+.5;
          float rim=pow(r,5.); float cloud=sin(r*26.-a*3.+time)*.5+.5;
          vec3 c=mix(vec3(.005,.024,.022),vec3(.07,.38,.23),curl*r*.65+cloud*.13);
          c+=vec3(.18,.75,.43)*rim*.65; gl_FragColor=vec4(c,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.surface.position.copy(this.center).sub(this.root.position); this.surface.position.z -= 0.1; this.root.add(this.surface);
  }

  update(dt, entering = false) {
    this.time += dt; this.mixer?.update(dt);
    if (this.surface) this.surface.material.uniforms.time.value = this.time;
    this.light.intensity = (entering ? 70 : 45) + Math.sin(this.time * 2.6) * 5;
  }
}

/** Shrink around the torso while travelling into the opening, with reversible materials. */
export class PortalPassage {
  constructor(group, center, body = group) {
    group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(body, true);
    const start = bounds.isEmpty() ? group.position.clone().add(new THREE.Vector3(0, 1, 0)) : bounds.getCenter(new THREE.Vector3());
    this.group = group; this.time = 0; this.scale = group.scale.clone(); this.visible = group.visible;
    this.localCenter = group.worldToLocal(start.clone());
    const end = center.clone().add(new THREE.Vector3(0, 0, -0.25));
    const control = start.clone().lerp(end, 0.4); control.y = end.y + 0.35;
    this.path = new THREE.QuadraticBezierCurve3(start, control, end);
    const materials = new Set(); body.traverse(node => { if (node.isMesh) for (const mat of Array.isArray(node.material) ? node.material : [node.material]) materials.add(mat); });
    this.materials = [...materials].map(material => ({ material, opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite }));
    for (const { material } of this.materials) { material.transparent = true; material.needsUpdate = true; }
  }
  update(dt) {
    this.time += dt;
    const t = Math.min(1, this.time / 2.2), ease = THREE.MathUtils.smoothstep(t, 0, 1);
    const center = this.path.getPoint(1 - (1 - ease) ** 2);
    this.group.scale.copy(this.scale).multiplyScalar(Math.max(0.001, (1 - ease) ** 1.25));
    this.group.position.copy(center).sub(this.localCenter.clone().multiply(this.group.scale).applyQuaternion(this.group.quaternion));
    const alpha = 1 - THREE.MathUtils.smoothstep(t, 0.55, 1);
    for (const entry of this.materials) { entry.material.opacity = entry.opacity * alpha; entry.material.depthWrite = alpha > 0.95; }
    if (t === 1) this.group.visible = false;
    return center;
  }
  restore() {
    this.group.scale.copy(this.scale); this.group.visible = this.visible;
    for (const entry of this.materials) Object.assign(entry.material, { opacity: entry.opacity, transparent: entry.transparent, depthWrite: entry.depthWrite, needsUpdate: true });
  }
}
