import * as THREE from 'three';

/**
 * VoidShader - Custom shader material for the "Void" portals between levels.
 *
 * Vertex Shader: Warps geometry like a heat haze / rippling abyss.
 * Fragment Shader: Mixes purple and black via procedural noise for a swirling effect.
 *
 * Usage:
 *   const voidMat = createVoidMaterial();
 *   const voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10, 64, 64), voidMat);
 *   // In your update loop: voidMat.uniforms.uTime.value = elapsedTime;
 */

export function createVoidMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uColor1: { value: new THREE.Color(0x1a0033) }, // deep purple
      uColor2: { value: new THREE.Color(0x000000) }, // black
      uColor3: { value: new THREE.Color(0x4a0e8f) }, // bright accent
      uWarpStrength: { value: 0.15 }
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uWarpStrength;
      varying vec2 vUv;
      varying float vDisplacement;

      void main() {
        vUv = uv;

        // Ripple displacement on Y axis
        float wave1 = sin(position.x * 3.0 + uTime * 2.0) * 0.5;
        float wave2 = cos(position.z * 2.5 + uTime * 1.5) * 0.5;
        float wave3 = sin((position.x + position.z) * 1.8 + uTime * 3.0) * 0.3;
        float displacement = (wave1 + wave2 + wave3) * uWarpStrength;

        vDisplacement = displacement;

        vec3 newPos = position;
        newPos.y += displacement;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      uniform vec3 uColor3;
      varying vec2 vUv;
      varying float vDisplacement;

      // Simple hash-based noise
      float hash(vec2 p) {
        float h = dot(p, vec2(127.1, 311.7));
        return fract(sin(h) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f); // smoothstep

        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));

        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      // Fractal Brownian Motion (3 octaves)
      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 3; i++) {
          value += amplitude * noise(p);
          p *= 2.0;
          amplitude *= 0.5;
        }
        return value;
      }

      void main() {
        // Swirling UV distortion
        vec2 uv = vUv;
        vec2 center = uv - 0.5;
        float dist = length(center);
        float angle = atan(center.y, center.x);

        // Swirl
        float swirl = dist * 3.0 - uTime * 0.5;
        uv.x = 0.5 + dist * cos(angle + swirl);
        uv.y = 0.5 + dist * sin(angle + swirl);

        // Layered noise
        float n1 = fbm(uv * 4.0 + uTime * 0.3);
        float n2 = fbm(uv * 8.0 - uTime * 0.5);
        float n = n1 * 0.6 + n2 * 0.4;

        // Colour mixing
        vec3 color = mix(uColor2, uColor1, n);
        color = mix(color, uColor3, smoothstep(0.6, 0.9, n) * 0.5);

        // Glow from displacement
        color += uColor3 * abs(vDisplacement) * 2.0;

        // Vignette (darken edges)
        float vignette = 1.0 - smoothstep(0.2, 0.7, dist);
        color *= vignette * 0.8 + 0.2;

        gl_FragColor = vec4(color, 0.95);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide
  });
}

/**
 * ToonOutlineShader - Cel-shaded outline for the Book Golem boss (Level 3).
 * Applied as a second pass on the boss mesh.
 */
export function createToonOutlineMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOutlineColor: { value: new THREE.Color(0x000000) },
      uOutlineWidth: { value: 0.04 }
    },
    vertexShader: /* glsl */ `
      uniform float uOutlineWidth;

      void main() {
        // Expand along normal for outline
        vec3 pos = position + normal * uOutlineWidth;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uOutlineColor;

      void main() {
        gl_FragColor = vec4(uOutlineColor, 1.0);
      }
    `,
    side: THREE.BackSide // render behind the mesh
  });
}
