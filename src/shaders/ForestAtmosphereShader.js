import * as THREE from 'three';

/**
 * ForestAtmosphereShader - Materials for the Level 1 "Dynamic Forest Atmosphere".
 *
 * Dynamic Forest Atmosphere System:
 *   createFireflyMaterial()  - GPU-driven firefly points: Lissajous wander, individual
 *                              blink, credit-proximity fade, FogExp2 distance fade.
 *   createMistMaterial()     - instanced cylindrical billboards: procedural fbm opacity,
 *                              slow turbulent drift, near/far and credit fades.
 *   decorateWindMaterial()   - chains an onBeforeCompile injection that adds height-masked,
 *                              per-instance-phased vertex sway to a cloned vegetation
 *                              material (grass, bushes, flowers, tree crowns).
 *
 * All animation reads one shared forestTime uniform (driven by ForestAtmosphere.update
 * from Level1.update), so every effect freezes with the rest of the game when paused.
 * Function and uniform names are forest-prefixed to stay self-contained.
 */

const NOISE = /* glsl */ `
float forestHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float forestNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(forestHash(i), forestHash(i + vec2(1.0, 0.0)), f.x),
    mix(forestHash(i + vec2(0.0, 1.0)), forestHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float forestFbm(vec2 p) {
  return forestNoise(p) * 0.57 + forestNoise(p * 2.03 + 7.3) * 0.28 + forestNoise(p * 4.11 + 3.1) * 0.15;
}`;

/** GLSL fade keeping the academic credits visually dominant: full presence 3+ units out, dim near an orb. */
const CREDIT_FADE_VERTEX = /* glsl */ `
uniform vec3 uCreditPositions[8];
uniform int uCreditCount;
float forestCreditDistance(vec3 worldPos) {
  float nearest = 999.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uCreditCount) break;
    nearest = min(nearest, distance(worldPos, uCreditPositions[i]));
  }
  return nearest;
}`;

/** FogExp2 factor matching the scene fog so effects sink into the night haze like standard materials. */
const FOG_FADE_VERTEX = /* glsl */ `
uniform float uFogDensity;
float forestFogFade(float viewDepth) {
  float fogDepth = uFogDensity * max(0.0, viewDepth);
  return clamp(exp(-fogDepth * fogDepth), 0.0, 1.0);
}`;

/**
 * Additive firefly point sprites. Geometry must provide position (anchor),
 * fireflySeed, fireflySize and fireflyTint attributes. Movement is fully
 * GPU-driven from forestTime; anchors never move on the CPU.
 */
export function createFireflyMaterial({ forestTime, fogColor, fogDensity, creditPositions, creditCount }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      forestTime,
      uPixelScale: { value: 1 },
      uFogDensity: { value: fogDensity },
      uColorGreen: { value: new THREE.Color(0x9fce7e) },
      uColorGold: { value: new THREE.Color(0xffd977) },
      uCreditPositions: { value: creditPositions },
      uCreditCount: { value: creditCount }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float fireflySeed;
      attribute float fireflySize;
      attribute float fireflyTint;
      uniform float forestTime;
      uniform float uPixelScale;
      varying float vGlow;
      varying float vTint;
      varying float vFogFade;
      varying float vCreditFade;
      ${CREDIT_FADE_VERTEX}
      ${FOG_FADE_VERTEX}

      void main() {
        float seed = fireflySeed;
        // Two incommensurate sines per axis read as an organic wander, not an orbit.
        float t = forestTime * (0.45 + fract(seed * 0.371) * 0.5);
        vec3 wander = vec3(
          sin(t * 0.9 + seed * 17.0) + sin(t * 0.53 + seed * 29.0) * 0.6,
          sin(t * 1.1 + seed * 11.0) * 0.45,
          cos(t * 0.8 + seed * 23.0) + cos(t * 0.47 + seed * 13.0) * 0.6
        );
        vec3 displaced = position + wander * vec3(1.5, 0.6, 1.5);
        // Slow-breathing blink with a sharp attack: pow concentrates the glow peak.
        float blinkRate = 0.5 + fract(seed * 7.31) * 1.3;
        float blink = pow(0.5 + 0.5 * sin(forestTime * blinkRate + seed * 41.0), 6.0);
        vGlow = 0.22 + 0.78 * blink;
        vTint = fireflyTint;
        vec4 view = modelViewMatrix * vec4(displaced, 1.0);
        float depth = max(1.0, -view.z);
        vFogFade = forestFogFade(-view.z);
        vCreditFade = 0.15 + 0.85 * smoothstep(1.2, 3.2, forestCreditDistance(displaced));
        gl_Position = projectionMatrix * view;
        gl_PointSize = clamp(fireflySize * uPixelScale * 300.0 / depth, 1.0, 9.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorGreen;
      uniform vec3 uColorGold;
      varying float vGlow;
      varying float vTint;
      varying float vFogFade;
      varying float vCreditFade;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float radiusSq = dot(p, p);
        float core = exp(-radiusSq * 18.0);
        float halo = exp(-radiusSq * 5.0) * 0.35;
        float alpha = (core + halo) * vGlow * vFogFade * vCreditFade;
        if (alpha < 0.004) discard;
        vec3 color = mix(uColorGreen, uColorGold, vTint);
        gl_FragColor = vec4(color * (0.5 + 0.8 * vGlow), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
}

/**
 * Instanced cylindrical-billboard mist. Rendered with an InstancedMesh whose
 * matrices carry anchor + size; the shader drifts, faces and fades each quad.
 */
export function createMistMaterial({ forestTime, fogColor, fogDensity, creditPositions, creditCount }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      forestTime,
      uFogColor: { value: fogColor },
      uFogDensity: { value: fogDensity },
      uColorMist: { value: new THREE.Color(0x8ba2b4) },
      uOpacity: { value: 0.14 },
      uCreditPositions: { value: creditPositions },
      uCreditCount: { value: creditCount }
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float mistSeed;
      uniform float forestTime;
      varying vec2 vUv;
      varying float vSeed;
      varying float vNearFade;
      varying float vCreditFade;
      varying float vFogFade;
      ${CREDIT_FADE_VERTEX}
      ${FOG_FADE_VERTEX}

      void main() {
        vUv = uv;
        vSeed = mistSeed;
        #ifdef USE_INSTANCING
          vec4 center = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float width = length(instanceMatrix[0].xyz);
          float height = length(instanceMatrix[1].xyz);
        #else
          vec4 center = vec4(0.0, 0.0, 0.0, 1.0);
          float width = 1.0;
          float height = 1.0;
        #endif
        // Slow turbulent drift: a tight gust wobble over a long roaming sweep.
        float drift = forestTime * (0.10 + fract(mistSeed * 0.713) * 0.08);
        center.x += sin(drift + mistSeed * 19.0) * 2.2 + sin(forestTime * 0.05 + mistSeed * 7.0) * 3.0;
        center.z += cos(drift * 0.83 + mistSeed * 23.0) * 2.2 + cos(forestTime * 0.043 + mistSeed * 5.0) * 3.0;
        vec3 worldCenter = (modelMatrix * center).xyz;
        vec4 viewCenter = viewMatrix * vec4(worldCenter, 1.0);
        // Cylindrical billboard: anchor to view space, then add the quad corners.
        viewCenter.xy += position.xy * vec2(width, height);
        float depth = max(0.0, -viewCenter.z);
        vNearFade = smoothstep(2.0, 7.0, depth);
        vFogFade = forestFogFade(depth);
        vCreditFade = 0.25 + 0.75 * smoothstep(2.5, 6.0,
          forestCreditDistance(vec3(worldCenter.x, 1.5, worldCenter.z)));
        gl_Position = projectionMatrix * viewCenter;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float forestTime;
      uniform vec3 uColorMist;
      uniform vec3 uFogColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vSeed;
      varying float vNearFade;
      varying float vCreditFade;
      varying float vFogFade;
      ${NOISE}

      void main() {
        // Wisp field crawling slowly across the quad.
        vec2 flow = vec2(forestTime * 0.014 + vSeed, vSeed * 3.1);
        float wisp = forestFbm(vUv * vec2(1.7, 1.15) + flow);
        wisp = smoothstep(0.32, 0.78, wisp);
        // Soft elliptical falloff, denser near the ground edge.
        vec2 e = (vUv - 0.5) * vec2(2.0, 2.3);
        float radial = exp(-dot(e, e) * 2.4);
        float vertical = mix(1.0, 0.35, smoothstep(0.1, 0.9, vUv.y));
        float alpha = wisp * radial * vertical * uOpacity * vNearFade * vCreditFade;
        if (alpha < 0.004) discard;
        // Far billboards converge on the fog colour and vanish into the haze.
        vec3 color = mix(uFogColor, uColorMist, vFogFade);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
}

/**
 * Per-kind wind parameters. Amplitudes are WORLD-space peak displacement at the
 * sway top; the shader divides by the instance scale so a 14 m pine and a 0.4 m
 * grass tuft both move plausible absolute amounts. Heights reference the
 * normalized local Y that extractNatureVariants guarantees (origin grounded,
 * unit height) - so masking never depends on a mesh's original pivot.
 */
export const WIND_PRESETS = {
  'grass': { amplitude: 0.055, base: 0.02, top: 0.55 },
  'flowers': { amplitude: 0.05, base: 0.05, top: 0.7 },
  'bushes': { amplitude: 0.045, base: 0.1, top: 0.85 },
  'trees': { amplitude: 0.12, base: 0.45, top: 1.0 },
  'birch-trees': { amplitude: 0.12, base: 0.45, top: 1.0 },
  'maple-trees': { amplitude: 0.12, base: 0.45, top: 1.0 },
  'pine-trees': { amplitude: 0.1, base: 0.4, top: 1.0 },
  'dead-trees': { amplitude: 0.05, base: 0.6, top: 1.0 }
};

/**
 * Chains a wind-sway injection onto material (following DungeonTorches.decorateMaterial).
 * Must be called on a CLONE owned by the atmosphere - the original stays untouched
 * for StylizedWoods to dispose. Adds forestTime/forestWindStrength uniforms only.
 */
export function decorateWindMaterial(material, kind, forestTime, windStrength) {
  const preset = WIND_PRESETS[kind];
  if (!preset || !material.isMeshStandardMaterial) return false;
  const previous = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey();
  const amplitude = preset.amplitude.toFixed(4);
  const base = preset.base.toFixed(3);
  const top = preset.top.toFixed(3);
  material.onBeforeCompile = shader => {
    previous(shader);
    shader.uniforms.forestTime = forestTime;
    shader.uniforms.forestWindStrength = windStrength;
    shader.vertexShader = `uniform float forestTime;\nuniform float forestWindStrength;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 forestOrigin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float forestScale = max(length(instanceMatrix[0].xyz), 0.001);
        #else
          vec3 forestOrigin = vec3(0.0);
          float forestScale = 1.0;
        #endif
        // Phase from the instance's world XZ de-synchronizes the whole forest.
        float forestPhase = dot(forestOrigin.xz, vec2(0.37, 0.29));
        float forestMask = smoothstep(${base}, ${top}, position.y);
        // A slow gust swell with a faint faster flutter on top.
        float forestGust = sin(forestTime * 1.1 + forestPhase) * 0.62
          + sin(forestTime * 2.7 + forestPhase * 1.7) * 0.28
          + sin(forestTime * 5.3 + forestPhase * 3.1 + position.y * 4.0) * 0.10;
        vec2 forestSway = vec2(0.82, 0.57) * (forestGust * ${amplitude} * forestMask / forestScale)
          + vec2(-0.57, 0.82) * (sin(forestTime * 3.1 + forestPhase * 2.3) * ${amplitude} * 0.22 * forestMask / forestScale);
        transformed.xz += forestSway * forestWindStrength;`);
  };
  material.customProgramCacheKey = () => `${key}|forest-wind-v1:${kind}`;
  material.needsUpdate = true;
  return true;
}
