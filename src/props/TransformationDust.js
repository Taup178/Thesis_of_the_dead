import * as THREE from 'three';

const COUNT = 17;
const smooth = THREE.MathUtils.smoothstep;

/** A bounded batch of turbulent plumes and ground-hugging dust, using the terrain's palette. */
export class TransformationDust {
  constructor(root, color = new THREE.Color(0xbe9762), height = 4.5) {
    this.height = height;
    this.root = new THREE.Group(); this.root.name = 'TransformationDust'; this.root.visible = false; root.add(this.root);
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.opacity = new Float32Array(COUNT);
    const seeds = Float32Array.from({ length: COUNT }, (_, index) => index * 3.731);
    const cores = Float32Array.from({ length: COUNT }, (_, index) => index === 0 || index >= 7 && index <= 12 ? 1 : 0);
    this.geometry.setAttribute('cloudSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    this.geometry.setAttribute('cloudCore', new THREE.InstancedBufferAttribute(cores, 1));
    this.geometry.setAttribute('cloudOpacity', new THREE.InstancedBufferAttribute(this.opacity, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('cloudGround', new THREE.InstancedBufferAttribute(Float32Array.from({ length: COUNT }, (_, i) => i >= 1 && i <= 6 ? 1 : 0), 1));
    // Bake soft noise once. Two cheap texture samples replace per-pixel procedural noise.
    const grid = new Float32Array(16 * 16); let seed = 71123;
    for (let i = 0; i < grid.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; grid[i] = seed / 4294967296; }
    const pixels = new Uint8Array(128 * 128 * 4);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const gx = Math.floor(x / 8), gy = Math.floor(y / 8);
      const fx = smooth((x % 8) / 8, 0, 1), fy = smooth((y % 8) / 8, 0, 1);
      const sample = (dx, dy) => grid[((gy + dy) % 16) * 16 + ((gx + dx) % 16)];
      const value = THREE.MathUtils.lerp(THREE.MathUtils.lerp(sample(0, 0), sample(1, 0), fx),
        THREE.MathUtils.lerp(sample(0, 1), sample(1, 1), fx), fy);
      const offset = (y * 128 + x) * 4;
      pixels[offset] = Math.round(value * 255);
      const secondary = THREE.MathUtils.lerp(THREE.MathUtils.lerp(grid[((gy + 7) % 16) * 16 + ((gx + 3) % 16)], grid[((gy + 7) % 16) * 16 + ((gx + 4) % 16)], fx),
        THREE.MathUtils.lerp(grid[((gy + 8) % 16) * 16 + ((gx + 3) % 16)], grid[((gy + 8) % 16) * 16 + ((gx + 4) % 16)], fx), fy);
      pixels[offset + 1] = Math.round(secondary * 255); pixels[offset + 2] = pixels[offset]; pixels[offset + 3] = 255;
    }
    this.noiseTexture = new THREE.DataTexture(pixels, 128, 128);
    this.noiseTexture.wrapS = this.noiseTexture.wrapT = THREE.RepeatWrapping;
    this.noiseTexture.minFilter = this.noiseTexture.magFilter = THREE.LinearFilter;
    this.noiseTexture.needsUpdate = true;
    this.uniforms = { time: { value: 0 }, cloudNoise: { value: this.noiseTexture }, dustColor: { value: color.clone() } };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, transparent: true,
      depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
      vertexShader: `attribute float cloudSeed;attribute float cloudCore;attribute float cloudOpacity;attribute float cloudGround;
        varying vec2 vUv;varying float vSeed;varying float vCore;varying float vOpacity;varying float vGround;varying float vHeight;
        void main(){vUv=uv;vSeed=cloudSeed;vCore=cloudCore;vOpacity=cloudOpacity;vGround=cloudGround;
          vec4 world=modelMatrix*instanceMatrix*vec4(position,1.);vHeight=world.y;
          gl_Position=projectionMatrix*viewMatrix*world;}`,
      fragmentShader: `uniform float time;uniform sampler2D cloudNoise;uniform vec3 dustColor;
        varying vec2 vUv;varying float vSeed;varying float vCore;varying float vOpacity;varying float vGround;varying float vHeight;
        void main(){if(vOpacity<.001)discard;
          vec2 flow=vUv*5.+vec2(vSeed-time*.16,time*-.35);
          vec4 large=texture2D(cloudNoise,flow/16.);
          vec4 small=texture2D(cloudNoise,(flow*2.13+4.)/16.);
          vec2 p=(vUv-.5)*2.+(large.rg-.5)*.62;
          float radius=length(p);
          float envelope=exp(-dot(p,p)*3.8);
          // Turbulence changes each plume's contour. Density reaches zero before the quad edge.
          float border=1.-smoothstep(.38,.68,radius);
          float cloud=smoothstep(.15,.8,large.r*.7+small.r*.3);
          float density=envelope*border*cloud;
          float alpha=(1.-exp(-density*mix(4.5,10.,vCore)))*vOpacity;
          // Fade before any vertical plane intersects the floor; low horizontal haze fills the contact.
          alpha*=mix(smoothstep(-.02,.48,vHeight),1.,vGround);
          if(alpha<.003)discard;
          float light=.74+cloud*.52+vUv.y*.16;
          vec3 color=dustColor*light;
          gl_FragColor=vec4(color,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    this.clouds = new THREE.InstancedMesh(this.geometry, this.material, COUNT);
    this.clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.clouds.frustumCulled = false; this.clouds.renderOrder = 12; this.root.add(this.clouds);
    this.object = new THREE.Object3D(); this.towardCamera = new THREE.Vector3();
    this.chipGeometry = new THREE.IcosahedronGeometry(1, 0);
    this.chipMaterial = new THREE.MeshStandardMaterial({ color: 0x857057, roughness: 1, flatShading: true });
    this.chips = new THREE.InstancedMesh(this.chipGeometry, this.chipMaterial, 18);
    this.chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.chips.frustumCulled = false; this.root.add(this.chips);
    this.coverage = 0;
  }

  update(age, origin, camera, clearing) {
    const object = this.object;
    this.root.visible = age >= 0 && clearing < 1;
    if (!this.root.visible) { this.coverage = 0; return; }
    const burst = smooth(age, 0, 0.2), fade = 1 - clearing;
    const coreFade = fade * Math.exp(-clearing * 3);
    this.coverage = burst * fade;
    this.uniforms.time.value = age;
    this.towardCamera.copy(camera?.position || origin).sub(origin); this.towardCamera.y = 0; this.towardCamera.normalize();
    for (let index = 0; index < COUNT; index++) {
      const seed = index * 2.39996;
      object.position.copy(origin);
      if (index === 0) {
        object.position.addScaledVector(this.towardCamera, 1.8); object.position.y += this.height * 0.52;
        object.position.x += clearing * 0.8;
        object.scale.set(this.height * 2.7 * burst, this.height * 3.2 * burst, 1);
        this.opacity[index] = burst * coreFade * 0.82;
      } else if (index <= 6) {
        const spread = (0.45 + Math.min(age, 2.8) * (1.1 + index * 0.09)) * burst;
        object.position.x += Math.sin(seed) * spread + age * 0.3;
        object.position.z += Math.cos(seed) * spread;
        object.position.y = 0.065 + index * 0.002;
        const size = (5.5 + Math.min(age, 3) * 1.5) * burst;
        object.scale.set(size, size * 0.8, 1);
        this.opacity[index] = burst * Math.pow(fade, 0.7) * 0.68;
      } else if (index <= 12) {
        // Overlapping dense plumes cover the whole creature, from ankles to above its head.
        // Keep the covering mass in front of the silhouette until the wind slowly disperses it.
        const row = index - 7;
        object.position.addScaledVector(this.towardCamera, 1.9 + row * 0.08);
        object.position.x += Math.sin(seed) * 0.4 + clearing * 1.15;
        object.position.y += 0.4 + row * this.height / 5;
        object.scale.set(this.height * 1.85 * burst, this.height * 1.55 * burst, 1);
        this.opacity[index] = burst * coreFade * 0.82;
      } else {
        const spread = (0.4 + Math.min(age, 2.8) * 0.85) * burst;
        object.position.x += Math.sin(seed) * spread + age * 0.3;
        object.position.z += Math.cos(seed) * spread;
        object.position.y += this.height * 0.7 + Math.min(age, 2.8) * 0.4;
        const size = this.height * 1.2 + Math.min(age, 3) * 0.55;
        object.scale.set(size * burst, size * burst, 1);
        this.opacity[index] = burst * coreFade * 0.86;
      }
      if (index >= 1 && index <= 6) object.rotation.set(-Math.PI / 2, 0, seed);
      else if (camera) { object.quaternion.copy(camera.quaternion); object.rotateZ(Math.sin(seed) * 0.28); }
      else object.rotation.set(0, 0, 0);
      object.updateMatrix(); this.clouds.setMatrixAt(index, object.matrix);
    }
    this.clouds.instanceMatrix.needsUpdate = true; this.geometry.attributes.cloudOpacity.needsUpdate = true;
    for (let index = 0; index < 18; index++) {
      const seed = index * 2.39996, speed = 1.5 + (index % 4) * 0.7;
      object.position.copy(origin);
      object.position.x += Math.sin(seed) * (0.4 + age * speed);
      object.position.z += Math.cos(seed) * (0.4 + age * speed);
      object.position.y = 0.12 + age * (2.5 + (index % 3) * 0.8) - age * age * 4.9;
      object.rotation.set(age * 4 + seed, age * 3, age * 5);
      object.scale.setScalar(age < 1 && object.position.y > 0 ? 0.035 + (index % 3) * 0.025 : 0);
      object.updateMatrix(); this.chips.setMatrixAt(index, object.matrix);
    }
    this.chips.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.root.removeFromParent(); this.clouds.dispose(); this.chips.dispose();
    for (const resource of [this.geometry, this.material, this.noiseTexture, this.chipGeometry, this.chipMaterial]) resource.dispose();
  }
}
