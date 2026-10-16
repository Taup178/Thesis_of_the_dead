import * as THREE from 'three';

const PARTICLES_PER_BLADE = 112;
const GRAVITY = 15;

/** The bottom arc must intersect an actual deck surface before it can shed sparks. */
export function getSawFloorContact(blade, surface) {
  if (!surface || !Number.isFinite(blade.sparkRadius)) return null;
  const center = blade.wheel.position, radius = blade.sparkRadius;
  const height = center.y + blade.rotor.position.y - surface.y;
  if (height > radius || height < -radius) return null;
  const z = center.z + blade.rotor.position.z;
  if (z < surface.minZ || z > surface.maxZ) return null;
  const halfChord = Math.sqrt(Math.max(0, radius * radius - height * height));
  const minX = Math.max(surface.minX, center.x - halfChord);
  const maxX = Math.min(surface.maxX, center.x + halfChord);
  if (minX > maxX) return null;
  return { x: THREE.MathUtils.clamp(center.x, minX, maxX), y: surface.y, z, minX, maxX };
}

function instancedQuads(count) {
  const plane = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(plane.index.clone());
  geometry.setAttribute('position', plane.attributes.position.clone());
  geometry.setAttribute('uv', plane.attributes.uv.clone());
  geometry.instanceCount = count;
  plane.dispose();
  return geometry;
}

function dynamicAttribute(geometry, name, count, size) {
  const attribute = new THREE.InstancedBufferAttribute(new Float32Array(count * size), size);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute(name, attribute);
  return attribute;
}

/** Pooled incandescent metal: directional spray, gravity, floor bounces and cooling. */
export class SawFloorSparks {
  constructor(level) {
    this.level = level;
    this.time = 0;
    this.seed = 317;
    this.viewport = new THREE.Vector2();
    const count = level.blades.length * PARTICLES_PER_BLADE;
    const geometry = instancedQuads(count);
    this.head = dynamicAttribute(geometry, 'aHead', count, 3);
    this.tail = dynamicAttribute(geometry, 'aTail', count, 3);
    this.heat = dynamicAttribute(geometry, 'aHeat', count, 1);
    this.alpha = dynamicAttribute(geometry, 'aAlpha', count, 1);
    this.width = dynamicAttribute(geometry, 'aWidth', count, 1);
    this.particles = Array.from({ length: count }, () => ({
      position: new THREE.Vector3(), velocity: new THREE.Vector3(), age: 1, life: 0,
      temperature: 1, floorY: 0, bounces: 0,
    }));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uViewportHeight: { value: 900 } },
      vertexShader: `
        attribute vec3 aHead; attribute vec3 aTail;
        attribute float aHeat; attribute float aAlpha; attribute float aWidth;
        uniform float uViewportHeight;
        varying vec2 vUv; varying float vHeat; varying float vAlpha;
        void main() {
          vec4 head = modelViewMatrix * vec4(aHead, 1.0);
          vec4 tail = modelViewMatrix * vec4(aTail, 1.0);
          vec2 direction = head.xy - tail.xy;
          if (dot(direction, direction) < 0.00001) direction = vec2(0.02, 0.01);
          vec2 perpendicular = normalize(vec2(-direction.y, direction.x));
          vec4 view = mix(tail, head, uv.x);
          // Keep the hot streak readable from the normal third-person camera.
          float pixelWidth = -view.z * 6.0 / (uViewportHeight * projectionMatrix[1][1]);
          float width = max(aWidth, pixelWidth);
          view.xy += perpendicular * position.y * width * mix(0.35, 1.0, uv.x);
          gl_Position = projectionMatrix * view;
          vUv = uv; vHeat = aHeat; vAlpha = aAlpha;
        }`,
      fragmentShader: `
        varying vec2 vUv; varying float vHeat; varying float vAlpha;
        void main() {
          float crossSection = max(0.0, 1.0 - abs(vUv.y - 0.5) * 2.0);
          float ends = smoothstep(0.0, 0.14, vUv.x) * (1.0 - smoothstep(0.8, 1.0, vUv.x));
          float core = pow(crossSection, 2.0);
          float halo = pow(crossSection, 0.55);
          float alpha = min(1.0, core * 0.95 + halo * 0.4) * ends * vAlpha;
          if (alpha < 0.003) discard;
          vec3 color = mix(vec3(2.4, 0.28, 0.008), vec3(8.0, 5.5, 1.8), smoothstep(0.15, 1.0, vHeat));
          color *= mix(0.55, 1.0, vUv.x);
          gl_FragColor = vec4(color, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'SawFloorSparkStreaks';
    this.mesh.frustumCulled = false;
    this.mesh.onBeforeRender = renderer => {
      renderer.getDrawingBufferSize(this.viewport);
      material.uniforms.uViewportHeight.value = this.viewport.y;
    };
    level.root.add(this.mesh);

    const glowGeometry = instancedQuads(level.blades.length);
    this.contactPosition = dynamicAttribute(glowGeometry, 'aContact', level.blades.length, 3);
    this.contactStrength = dynamicAttribute(glowGeometry, 'aStrength', level.blades.length, 1);
    const glowMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec3 aContact; attribute float aStrength;
        varying vec2 vUv; varying float vStrength;
        void main() { vUv = uv; vStrength = aStrength;
          vec3 point = aContact + vec3(position.x * 1.15, 0.0, -position.y * 0.6);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0); }`,
      fragmentShader: `varying vec2 vUv; varying float vStrength;
        void main() {
          float radius = length((vUv - 0.5) * 2.0);
          float alpha = pow(max(0.0, 1.0 - radius), 2.0) * vStrength;
          if (alpha < 0.003) discard;
          gl_FragColor = vec4(3.8, 1.15, 0.12, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.glow = new THREE.Mesh(glowGeometry, glowMaterial);
    this.glow.name = 'SawFloorContactGlow'; this.glow.frustumCulled = false;
    level.root.add(this.glow);
    this.emitters = level.blades.map(blade => ({ blade, angle: blade.rotor.rotation.z,
      x: blade.wheel.position.x, carry: 0, cursor: 0 }));
  }

  _random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  _emit(index, emitter, contact, angularSpeed, carriageSpeed) {
    const slot = index * PARTICLES_PER_BLADE + emitter.cursor;
    emitter.cursor = (emitter.cursor + 1) % PARTICLES_PER_BLADE;
    const particle = this.particles[slot];
    particle.position.set(THREE.MathUtils.lerp(contact.minX, contact.maxX, this._random()),
      contact.y + 0.016, contact.z + (this._random() - 0.5) * 0.045);
    const speed = 5 + this._random() * 6.5;
    const direction = Math.sign(angularSpeed);
    particle.velocity.set(direction * speed + carriageSpeed * 0.15,
      1.4 + this._random() ** 2 * 4.2, (this._random() - 0.5) * 2.5);
    particle.age = 0; particle.life = 0.3 + this._random() * 0.55;
    particle.temperature = 0.75 + this._random() * 0.25;
    particle.floorY = contact.y; particle.bounces = 0;
    this.width.array[slot] = 0.02 + this._random() * 0.03;
  }

  update(dt) {
    if (dt <= 0) return;
    this.time += dt;
    this.emitters.forEach((emitter, index) => {
      const blade = emitter.blade;
      const angularSpeed = (blade.rotor.rotation.z - emitter.angle) / dt;
      const carriageSpeed = (blade.wheel.position.x - emitter.x) / dt;
      emitter.angle = blade.rotor.rotation.z; emitter.x = blade.wheel.position.x;
      const contact = getSawFloorContact(blade, this.level.bladeSurface);
      const power = contact ? Math.min(1, Math.abs(angularSpeed) * blade.sparkRadius / 24) : 0;
      this.contactStrength.array[index] = 0;
      if (!contact || power < 0.04) { emitter.carry = 0; return; }
      this.contactPosition.setXYZ(index, contact.x, contact.y + 0.013, contact.z);
      const chatter = 0.72 + 0.28 * Math.sin(this.time * 37 + index * 2.3) ** 2;
      this.contactStrength.array[index] = power * chatter * 0.95;
      emitter.carry += dt * 200 * power * chatter;
      while (emitter.carry >= 1) {
        emitter.carry--;
        this._emit(index, emitter, contact, angularSpeed, carriageSpeed);
      }
    });

    this.particles.forEach((particle, index) => {
      this.alpha.array[index] = 0;
      if (particle.age >= particle.life) return;
      particle.age += dt;
      let remaining = dt;
      while (remaining > 0) {
        const step = Math.min(remaining, 1 / 120); remaining -= step;
        particle.velocity.y -= GRAVITY * step;
        particle.position.addScaledVector(particle.velocity, step);
        if (particle.position.y < particle.floorY + 0.008) {
          particle.position.y = particle.floorY + 0.008;
          particle.velocity.y = Math.abs(particle.velocity.y) * 0.28;
          particle.velocity.x *= 0.58; particle.velocity.z *= 0.58;
          particle.temperature *= 0.8;
          if (++particle.bounces > 2) { particle.age = particle.life; break; }
        }
      }
      const life = Math.max(0, 1 - particle.age / particle.life);
      this.head.setXYZ(index, particle.position.x, particle.position.y, particle.position.z);
      // A constant shutter interval keeps streak lengths stable at different frame rates.
      this.tail.setXYZ(index, particle.position.x - particle.velocity.x * 0.035,
        Math.max(particle.floorY + 0.008, particle.position.y - particle.velocity.y * 0.035),
        particle.position.z - particle.velocity.z * 0.035);
      this.heat.array[index] = life ** 0.45 * particle.temperature;
      this.alpha.array[index] = life ** 0.4;
    });
    for (const attribute of [this.head, this.tail, this.heat, this.alpha, this.width,
      this.contactPosition, this.contactStrength]) attribute.needsUpdate = true;
  }
}
