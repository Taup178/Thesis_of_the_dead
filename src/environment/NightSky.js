import * as THREE from 'three';

function createGlowTexture() {
  const pixels = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const radius = Math.hypot((x - 31.5) / 31.5, (y - 31.5) / 31.5);
      const alpha = Math.exp(-radius * radius * 5) * Math.max(0, 1 - radius) * 255;
      pixels.set([255, 255, 255, alpha], (y * 64 + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(pixels, 64, 64);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createMoonMaterial(texture) {
  const material = new THREE.MeshBasicMaterial({
    map: texture, color: 0xf4f2ed, fog: false, toneMapped: false,
  });
  // Light the lunar surface independently of the forest, with a near-full phase.
  material.onBeforeCompile = shader => {
    shader.uniforms.lunarSun = { value: new THREE.Vector3(1, 0.12, -0.28).normalize() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 lunarNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nlunarNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 lunarNormal;\nuniform vec3 lunarSun;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sunlight = max(dot(normalize(lunarNormal), lunarSun), 0.0);
        diffuseColor.rgb *= mix(0.04, 1.35, pow(sunlight, 0.22));
      `);
  };
  material.customProgramCacheKey = () => 'lunar-surface';
  return material;
}

/** Distant moon and stars follow the player without moving relative to the sky. */
export class NightSky {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'NightSky';
    scene.add(this.group);
    this.horizonColor = new THREE.Color(0x111920);
    this.moonDirection = new THREE.Vector3(-80, 110, -170).normalize();

    let seed = 4281;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const sky = new THREE.Mesh(new THREE.SphereGeometry(430, 32, 20), new THREE.ShaderMaterial({
      uniforms: {
        horizon: { value: this.horizonColor },
        zenith: { value: new THREE.Color(0x020409) },
        moonDirection: { value: this.moonDirection },
      },
      vertexShader: `
        varying vec3 skyDirection;
        void main() {
          skyDirection = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 horizon;
        uniform vec3 zenith;
        uniform vec3 moonDirection;
        varying vec3 skyDirection;
        void main() {
          vec3 direction = normalize(skyDirection);
          float height = max(direction.y, 0.0);
          vec3 skyColor = mix(horizon, zenith, smoothstep(0.0, 0.6, height));
          float moonHaze = pow(max(dot(direction, moonDirection), 0.0), 160.0);
          skyColor += vec3(0.72, 0.76, 0.8) * moonHaze * 0.002;
          gl_FragColor = vec4(skyColor, 1.0);
          #include <colorspace_fragment>
        }
      `,
      side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    }));
    sky.renderOrder = -100;
    this.group.add(sky);

    const positions = [], colors = [], sizes = [];
    const color = new THREE.Color();
    for (let i = 0; i < 700; i++) {
      const height = 0.035 + random() * 0.965;
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(1 - height * height) * 410;
      positions.push(Math.cos(angle) * radius, height * 410, Math.sin(angle) * radius);
      // Most stars are faint; a few have a warmer colour or a brighter core.
      const brightness = 0.035 + Math.pow(random(), 4) * 0.55;
      const temperature = random();
      color.setHex(temperature < 0.12 ? 0xf2dfc4 : temperature < 0.32 ? 0xd1dce9 : 0xe8e7e3);
      colors.push(color.r * brightness, color.g * brightness, color.b * brightness);
      sizes.push(0.9 + Math.sqrt(brightness) * 1.7);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    starGeometry.setAttribute('starColor', new THREE.Float32BufferAttribute(colors, 3));
    starGeometry.setAttribute('starSize', new THREE.Float32BufferAttribute(sizes, 1));
    const starMaterial = new THREE.ShaderMaterial({
      uniforms: { pixelScale: { value: 1 }, moonDirection: { value: this.moonDirection } },
      vertexShader: `
        attribute vec3 starColor;
        attribute float starSize;
        uniform float pixelScale;
        uniform vec3 moonDirection;
        varying vec3 visibleColor;
        void main() {
          vec3 direction = normalize(position);
          float horizonFade = smoothstep(0.035, 0.25, direction.y);
          float moonGlare = pow(max(dot(direction, moonDirection), 0.0), 110.0);
          visibleColor = starColor * horizonFade * (1.0 - moonGlare * 0.9);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.0, starSize * pixelScale);
        }
      `,
      fragmentShader: `
        varying vec3 visibleColor;
        void main() {
          vec2 offset = gl_PointCoord - vec2(0.5);
          float radiusSquared = dot(offset, offset);
          float alpha = exp(-radiusSquared * 14.0) * (1.0 - smoothstep(0.12, 0.25, radiusSquared));
          gl_FragColor = vec4(visibleColor, alpha);
          #include <colorspace_fragment>
        }
      `,
      transparent: true, depthWrite: false, fog: false, toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(starGeometry, starMaterial);
    this.stars.name = 'Stars';
    this.stars.renderOrder = -80;
    const bufferSize = new THREE.Vector2();
    this.stars.onBeforeRender = renderer => {
      starMaterial.uniforms.pixelScale.value = renderer.getDrawingBufferSize(bufferSize).y / 900;
    };
    this.group.add(this.stars);

    let finishLoading;
    this.ready = new Promise(resolve => { finishLoading = resolve; });
    const moonTexture = new THREE.TextureLoader().load(
      './assets/textures/sky/moon-albedo.jpg',
      () => finishLoading(),
      undefined,
      error => { console.warn('[NightSky] Moon texture unavailable:', error); finishLoading(); }
    );
    moonTexture.colorSpace = THREE.SRGBColorSpace;
    const moon = new THREE.Mesh(new THREE.SphereGeometry(3, 48, 32), createMoonMaterial(moonTexture));
    moon.name = 'Moon';
    moon.position.copy(this.moonDirection).multiplyScalar(390);
    // The map's centre is the familiar near side, which lies on the sphere's +X axis.
    moon.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), this.moonDirection.clone().negate());
    moon.renderOrder = -90;
    this.group.add(moon);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: createGlowTexture(), color: 0xe4e7e9, opacity: 0.075, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
    }));
    halo.position.copy(moon.position);
    halo.scale.set(18, 18, 1);
    halo.renderOrder = -85;
    this.group.add(halo);
  }

  update(playerPosition) {
    this.group.position.copy(playerPosition);
  }

  dispose() {
    const resources = new Set();
    this.group.traverse(child => {
      if (child.geometry) resources.add(child.geometry);
      if (child.material) {
        resources.add(child.material);
        if (child.material.map) resources.add(child.material.map);
      }
    });
    for (const resource of resources) resource.dispose();
    this.group.removeFromParent();
  }
}
