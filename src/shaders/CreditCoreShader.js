import * as THREE from 'three';

/**
 * CreditCoreShader - Materials for the Level 1 "Academic Credit" energy orbs.
 *
 * Academic Credit Energy System:
 *   createCreditCoreMaterial()  - orb core: procedural inscription-band energy,
 *                                 flowing noise, fresnel rim, subtle vertex swell.
 *   createCreditHaloMaterial()  - additive seal-mark rings orbiting each credit.
 *   createCreditSparkMaterial() - additive point sprites for pickup burst/trail.
 *   createCreditFinaleMaterial()- expanding seal shockwave for the eighth credit.
 *   createCreditColumnMaterial()- rising light column for the eighth credit.
 *
 * All materials animate from a single uTime uniform (driven by Level1.update),
 * so they freeze with the rest of the game when paused. The shader functions
 * use credit-prefixed names to stay self-contained like the burn noise module.
 */

const NOISE = /* glsl */ `
float creditHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float creditNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(creditHash(i), creditHash(i + vec2(1.0, 0.0)), f.x),
    mix(creditHash(i + vec2(0.0, 1.0)), creditHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float creditFbm(vec2 p) {
  return creditNoise(p) * 0.57 + creditNoise(p * 2.03 + 7.3) * 0.28 + creditNoise(p * 4.11 + 3.1) * 0.15;
}`;

/** The collectible orb core. One shared material instance covers all eight credits. */
export function createCreditCoreMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uBoost: { value: 0.0 },   // brief resonance flare when any credit is collected
      uColorDeep: { value: new THREE.Color(0x8a4d00) },
      uColorGold: { value: new THREE.Color(0xffd700) },
      uColorHot: { value: new THREE.Color(0xfff3c4) }
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vPos;
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;

      void main() {
        vPos = position;
        // Subtle breathing swell along the normal keeps the silhouette alive.
        float swell = sin(position.y * 5.0 + uTime * 2.3) * 0.5
          + sin((position.x + position.z) * 6.0 + uTime * 1.6) * 0.5;
        vec3 displaced = position + normal * swell * 0.028;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 world = modelMatrix * vec4(displaced, 1.0);
        vViewDir = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uBoost;
      uniform vec3 uColorDeep;
      uniform vec3 uColorGold;
      uniform vec3 uColorHot;
      varying vec3 vPos;
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;
      ${NOISE}

      void main() {
        // Inscription bands: fine engraved latitude lines, like a seal or book spine.
        float flow = creditFbm(vec2(vPos.x + vPos.z, vPos.y) * 2.4 + vec2(0.0, -uTime * 0.55));
        float bands = sin(vPos.y * 26.0 - uTime * 1.4 + flow * 5.5);
        float engraving = smoothstep(0.55, 0.95, bands) * 0.6
          + smoothstep(0.85, 1.0, sin(vPos.y * 7.0 + uTime * 0.8)) * 0.55;

        // Living plasma shimmer crawling across the surface.
        float shimmer = creditFbm(vPos.xy * 3.2 + vec2(uTime * 0.4, -uTime * 0.9) + vPos.z * 1.7);

        // Fresnel rim lifts the orb out of the moonlit woods.
        float rim = pow(1.0 - clamp(dot(normalize(vWorldNormal), normalize(vViewDir)), 0.0, 1.0), 2.2);

        float pulse = 0.82 + 0.18 * sin(uTime * 2.6);
        vec3 color = mix(uColorDeep, uColorGold, clamp(shimmer * 0.9 + engraving, 0.0, 1.0));
        color += uColorHot * (engraving * 0.85 + rim * 0.7) * pulse;
        color += uColorGold * uBoost * (0.55 + shimmer * 0.8);
        color *= pulse + uBoost * 0.6;

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
}

/** Additive seal-mark ring orbiting a credit. Shared by every halo ring. */
export function createCreditHaloMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uColor: { value: new THREE.Color(0xffd700) }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      ${NOISE}

      void main() {
        float angle = vUv.x * 6.2831853;
        // Eight seal marks around each ring - one per credit in the chapter.
        float markGap = abs(fract(angle * 1.27324) - 0.5);
        float mark = 1.0 - smoothstep(0.16, 0.30, markGap);
        float tube = sin(vUv.y * 3.14159265);
        float flicker = 0.75 + 0.25 * creditFbm(vec2(vUv.x * 6.0, uTime * 0.7));
        float alpha = mark * tube * flicker;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(uColor * (0.9 + mark * 1.6), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
}

/**
 * Additive point sprites shared by the pickup burst and the energy trail.
 * Geometry must provide position, sparkLife, sparkSeed and sparkSize attributes.
 */
export function createCreditSparkMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorEmber: { value: new THREE.Color(0xff8c00) },
      uColorGold: { value: new THREE.Color(0xffd700) },
      uColorHot: { value: new THREE.Color(0xfff3c4) }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float sparkLife;
      attribute float sparkSeed;
      attribute float sparkSize;
      varying float vLife;
      varying float vSeed;
      void main() {
        vLife = sparkLife;
        vSeed = sparkSeed;
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;
        gl_PointSize = clamp(sparkSize * 90.0 / max(0.5, -view.z), 1.0, 22.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorEmber;
      uniform vec3 uColorGold;
      uniform vec3 uColorHot;
      varying float vLife;
      varying float vSeed;
      void main() {
        if (vLife <= 0.0) discard;
        vec2 p = gl_PointCoord - 0.5;
        float falloff = 1.0 - smoothstep(0.12, 0.5, length(p));
        float twinkle = 0.72 + 0.28 * sin(vSeed * 37.0 + vLife * 21.0);
        vec3 color = mix(uColorEmber, uColorGold, vLife);
        color = mix(color, uColorHot, pow(vLife, 3.0));
        gl_FragColor = vec4(color * (1.2 + vLife), falloff * vLife * twinkle);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
}

/**
 * Expanding seal shockwave for the eighth-credit finale.
 * Animate uProgress from 0 to 1; the mesh itself never moves or scales.
 */
export function createCreditFinaleMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uProgress: { value: 1.0 },
      uColorGold: { value: new THREE.Color(0xffd700) },
      uColorHot: { value: new THREE.Color(0xfff3c4) }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uProgress;
      uniform vec3 uColorGold;
      uniform vec3 uColorHot;
      varying vec2 vUv;
      ${NOISE}

      void main() {
        float radius = length(vUv - 0.5) * 2.0;
        float band = 1.0 - smoothstep(0.0, 0.16, abs(radius - uProgress));
        float ripple = 0.7 + 0.3 * creditFbm(vec2(atan(vUv.y - 0.4999, vUv.x - 0.4999) * 2.2, uTime * 1.3));
        float crest = smoothstep(0.75, 1.0, uProgress);
        float alpha = band * ripple * (1.0 - smoothstep(0.55, 1.0, uProgress));
        if (alpha < 0.004) discard;
        vec3 color = mix(uColorGold, uColorHot, crest);
        gl_FragColor = vec4(color * 2.2, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
}

/** Vertical burst of light marking the eighth credit's resonance. Animate uProgress 0 -> 1. */
export function createCreditColumnMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uProgress: { value: 1.0 },
      uColorGold: { value: new THREE.Color(0xffd700) }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uProgress;
      uniform vec3 uColorGold;
      varying vec2 vUv;
      ${NOISE}

      void main() {
        float height = vUv.y;
        float swirl = creditFbm(vec2(vUv.x * 3.0 + uTime * 0.4, height * 2.5 - uTime * 1.8));
        float edges = smoothstep(0.0, 0.25, height) * (1.0 - smoothstep(0.55, 1.0, height));
        float alpha = edges * (0.35 + swirl * 0.65) * (1.0 - smoothstep(0.3, 1.0, uProgress));
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(uColorGold * (1.4 + swirl * 1.6), alpha * 0.8);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
}
