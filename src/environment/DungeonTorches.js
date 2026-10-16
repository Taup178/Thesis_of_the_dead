import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const TORCH_SCALE = 1.25, MOUNT_Y = 2.35, BACK_OFFSET = 0.153669;
const FLAME_Y = MOUNT_Y + 0.66 * TORCH_SCALE;
const FLAME_INSET = (0.35 + BACK_OFFSET) * TORCH_SCALE;
const POWER = 260, RANGE = 23;
const flickerGLSL = `
float firePulse(float t, float p) {
  return 1.0 + .045*sin(t*6.7+p) + .025*sin(t*11.3+p*2.1) + .012*sin(t*19.0+p*.7);
}`;
const noiseGLSL = `
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);
}
float fbm(vec2 p) { return noise(p)*.57+noise(p*2.03)*.28+noise(p*4.11)*.15; }
`;
const billboardVertex = `
attribute float torchPhase;
varying vec2 vUv; varying float vPhase;
#include <fog_pars_vertex>
void main() {
  vUv=uv; vPhase=torchPhase;
  vec4 world=modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
  vec3 right=normalize(vec3(viewMatrix[0][0],0.,viewMatrix[2][0]));
  world.xyz+=right*position.x+vec3(0.,position.y,0.);
  vec4 mvPosition=viewMatrix*world;
  gl_Position=projectionMatrix*mvPosition;
  #include <fog_vertex>
}`;
const fireFragment = `
uniform float time; varying vec2 vUv; varying float vPhase;
#include <fog_pars_fragment>
${flickerGLSL}
${noiseGLSL}
void main() {
  float t=time+vPhase, pulse=firePulse(time,vPhase);
  vec2 p=vec2(vUv.x*2.-1.,vUv.y);
  float tongueHeight=.82+noise(vec2(p.x*4.5,t*.75))*.18+sin(p.x*12.+t*.9)*.055;
  float y=p.y/(tongueHeight*pulse);
  float curl=fbm(vec2(p.x*3.4,y*5.2-t*2.5));
  float bend=(sin(y*5.7-t*2.3)*.13+sin(y*12.-t*3.6)*.055)*y;
  float width=.86*pow(max(0.,1.-y),.72);
  float density=1.-abs(p.x-bend)/max(.012,width)+(curl-.5)*.62;
  float edge=smoothstep(0.,.23,density);
  float alpha=edge*smoothstep(0.,.055,p.y)*(1.-smoothstep(.78,1.,y+(curl-.5)*.24));
  if(alpha<.003)discard;
  float core=pow(clamp(density,0.,1.),2.)*(1.-smoothstep(.15,.72,y));
  vec3 color=mix(vec3(2.8,.18,.012),vec3(5.2,1.6,.12),smoothstep(.15,.8,density));
  color=mix(color,vec3(7.,4.8,1.8),core)*pulse;
  gl_FragColor=vec4(color,alpha*.92);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
const smokeFragment = `
uniform float time; varying vec2 vUv; varying float vPhase;
#include <fog_pars_fragment>
${noiseGLSL}
void main() {
  float t=time*.6+vPhase;
  float x=(vUv.x-.5)*2.+sin(vUv.y*5.-t)*vUv.y*.32;
  float cloud=fbm(vec2(x*3.,vUv.y*5.-t*1.8));
  float alpha=cloud*smoothstep(0.,.15,vUv.y)*(1.-vUv.y)*exp(-x*x*5.)*.075;
  gl_FragColor=vec4(vec3(.16,.12,.075),alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** Textured iron torches, flame motion, and a fixed light budget without camera-driven brightness changes. */
export class DungeonTorches {
  constructor(root, backZ, frontZ) {
    this.root = root; this.time = { value: 0 }; this.disposed = false;
    this.decorated = new WeakSet();
    this.originalHooks = new Map();
    const rows = Math.max(2, Math.ceil((frontZ - backZ - 8) / 12) + 1);
    this.layout = { firstZ: frontZ - 4, spacing: (frontZ - backZ - 8) / (rows - 1), rows, mountY: MOUNT_Y };
    this.anchors = [];
    for (let row = 0; row < rows; row++) for (const side of [-1, 1]) {
      const z = this.layout.firstZ - row * this.layout.spacing;
      this.anchors.push({ position: new THREE.Vector3(side * 10, MOUNT_Y, z),
        flame: new THREE.Vector3(side * (10 - FLAME_INSET), FLAME_Y, z),
        id: row * 2 + (side > 0 ? 1 : 0), row,
        angle: side < 0 ? Math.PI / 2 : -Math.PI / 2, phase: row * 2.399 + (side > 0 ? 1.731 : 0) });
    }
    // One stable, shadow-free pair lights nearby actors. Local shader lights
    // illuminate the rest of the corridor without twelve cube-shadow passes.
    this.lights = Array.from({ length: 2 }, (_, index) => {
      const light = new THREE.PointLight(0xffb65c, POWER, RANGE, 2);
      light.name = `TorchLight_${index}`;
      light.castShadow = false;
      root.add(light); return light;
    });
    this.lightUniforms = {
      dungeonTorchTime: this.time,
      dungeonTorchGrid: { value: new THREE.Vector4(this.layout.firstZ, this.layout.spacing, rows, POWER) },
      dungeonTorchSource: { value: new THREE.Vector3(10 - FLAME_INSET, FLAME_Y + 0.22, RANGE) },
      dungeonTorchColor: { value: this.lights[0].color.clone() },
      dungeonTorchSlotsA: { value: new THREE.Vector4() }, dungeonTorchSlotsB: { value: new THREE.Vector4() },
      dungeonTorchMovedRows: { value: new THREE.Vector4(-1, -1, -1, -1) },
      dungeonTorchMovedZ: { value: new THREE.Vector4() },
    };
    this.update(0, new THREE.Vector3(0, 0, frontZ - 12));
  }

  placeBetweenBladeAnchors(anchorZs) {
    const rails = [...anchorZs].sort((a, b) => b - a);
    if (rails.length < 2) return;
    const gaps = rails.slice(1).map((z, index) => (rails[index] + z) / 2);
    const moved = new Map();
    // Relocate each wall pair together, before building the torch/fire instances.
    for (const anchor of this.anchors) {
      const z = anchor.position.z;
      if (z > rails[0] + 1.75 || z < rails.at(-1) - 1.75) continue;
      const midpoint = gaps.reduce((nearest, gap) => Math.abs(gap - z) < Math.abs(nearest - z) ? gap : nearest);
      moved.set(anchor.row, midpoint);
      anchor.position.z = anchor.flame.z = midpoint;
    }
    const rows = [...moved.keys()], positions = [...moved.values()];
    this.lightUniforms.dungeonTorchMovedRows.value.fromArray(Array.from({ length: 4 }, (_, index) => rows[index] ?? -1));
    this.lightUniforms.dungeonTorchMovedZ.value.fromArray(Array.from({ length: 4 }, (_, index) => positions[index] ?? 0));
    this.update(0, this.lights[0].position.clone());
  }

  async load() {
    const gltf = await new GLTFLoader().loadAsync('./assets/models/dungeon-wall-torch/scene.gltf');
    if (this.disposed) {
      const resources = new Set();
      gltf.scene.traverse(node => {
        if (!node.isMesh) return;
        resources.add(node.geometry); resources.add(node.material);
        for (const value of Object.values(node.material)) if (value?.isTexture) resources.add(value);
      });
      for (const resource of resources) resource.dispose();
      return;
    }
    gltf.scene.updateMatrixWorld(true);
    let source; gltf.scene.traverse(node => { if (node.isMesh) source = node; });
    const geometry = source.geometry;
    geometry.applyMatrix4(source.matrixWorld); geometry.translate(0, 0, BACK_OFFSET);
    const phases = new Float32Array(this.anchors.map(anchor => anchor.phase));
    geometry.setAttribute('torchPhase', new THREE.InstancedBufferAttribute(phases, 1));
    const material = source.material;
    material.emissive.setRGB(1, 1, 1); material.emissiveIntensity = 3.4;
    material.onBeforeCompile = shader => {
      shader.uniforms.torchTime = this.time;
      shader.vertexShader = `attribute float torchPhase; varying float vTorchPhase;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', 'vTorchPhase=torchPhase;\n#include <begin_vertex>');
      shader.fragmentShader = `uniform float torchTime; varying float vTorchPhase;\n${flickerGLSL}\n${shader.fragmentShader}`
        .replace('#include <emissivemap_fragment>', `
          float coalHeat=texture2D(emissiveMap,vEmissiveMapUv).r;
          totalEmissiveRadiance*=vec3(1.,.26,.035)*coalHeat*firePulse(torchTime,vTorchPhase);`);
    };
    material.customProgramCacheKey = () => 'dungeon-torch-coals-v1';
    const transform = new THREE.Object3D();
    this.meshes = [];
    this.batches = [];
    // Small spatial batches let walls behind the camera cull their detailed holders.
    for (let start = 0; start < this.anchors.length; start += 4) {
      const anchors = this.anchors.slice(start, start + 4), batch = geometry.clone();
      batch.setAttribute('torchPhase', new THREE.InstancedBufferAttribute(Float32Array.from(anchors, anchor => anchor.phase), 1));
      const mesh = new THREE.InstancedMesh(batch, material, anchors.length);
      mesh.name = 'DungeonWallTorches'; mesh.castShadow = false; mesh.receiveShadow = true;
      anchors.forEach((anchor, index) => {
        transform.position.copy(anchor.position); transform.rotation.y = anchor.angle;
        transform.scale.setScalar(TORCH_SCALE); transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix);
      });
      mesh.computeBoundingSphere(); this.root.add(mesh); this.meshes.push(mesh);
      this.batches.push({ mesh, minZ: Math.min(...anchors.map(anchor => anchor.position.z)), maxZ: Math.max(...anchors.map(anchor => anchor.position.z)) });
    }
    geometry.dispose(); this.mesh = this.meshes[0];
    this.fire = this._billboards(phases, 0.86, 1.2, 0, fireFragment, 'TorchFlames', 2);
    this.smoke = this._billboards(phases, 1.5, 2.4, 0.9, smokeFragment, 'TorchSmoke', 1);
    this._embers();
  }

  installLighting(root = this.root) {
    root.traverse(node => {
      if (!node.isMesh) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) this.decorateMaterial(material);
    });
  }

  decorateMaterial(material) {
    if (!material.isMeshStandardMaterial || this.decorated.has(material)) return;
    this.decorated.add(material);
    this.originalHooks.set(material, { onBeforeCompile: material.onBeforeCompile, customProgramCacheKey: material.customProgramCacheKey });
    const previous = material.onBeforeCompile.bind(material), key = material.customProgramCacheKey();
    material.onBeforeCompile = shader => {
      previous(shader);
      Object.assign(shader.uniforms, this.lightUniforms);
      shader.vertexShader = `varying vec3 vDungeonTorchWorldPosition;\n${shader.vertexShader}`
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vec4 dungeonWorld=vec4(transformed,1.);
          #ifdef USE_BATCHING
            dungeonWorld=batchingMatrix*dungeonWorld;
          #endif
          #ifdef USE_INSTANCING
            dungeonWorld=instanceMatrix*dungeonWorld;
          #endif
          vDungeonTorchWorldPosition=(modelMatrix*dungeonWorld).xyz;`);
      shader.fragmentShader = `varying vec3 vDungeonTorchWorldPosition;
        uniform float dungeonTorchTime; uniform vec4 dungeonTorchGrid,dungeonTorchSlotsA,dungeonTorchSlotsB,dungeonTorchMovedRows,dungeonTorchMovedZ;
        uniform vec3 dungeonTorchSource,dungeonTorchColor;
        ${flickerGLSL.replace('firePulse', 'dungeonLightPulse')}
        ${shader.fragmentShader}`.replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
          // Only the surrounding three rows can contribute substantial light.
          // Skip sources already represented by the nearby real light pair.
          for(int candidate=0;candidate<6;candidate++) {
            float torchRow=floor((dungeonTorchGrid.x-vDungeonTorchWorldPosition.z)/dungeonTorchGrid.y+.5)+float(candidate/2-1);
            if(torchRow<0.||torchRow>=dungeonTorchGrid.z)continue;
            float torchZ=dungeonTorchGrid.x-torchRow*dungeonTorchGrid.y;
            for(int movedRow=0;movedRow<4;movedRow++) {
              if(abs(dungeonTorchMovedRows[movedRow]-torchRow)<.5)torchZ=dungeonTorchMovedZ[movedRow];
            }
            float sideIndex=mod(float(candidate),2.),torchIndex=torchRow*2.+sideIndex;
            if(any(lessThan(abs(dungeonTorchSlotsA-vec4(torchIndex)),vec4(.5)))||
               any(lessThan(abs(dungeonTorchSlotsB-vec4(torchIndex)),vec4(.5))))continue;
            PointLight distantTorch;
            distantTorch.position=(viewMatrix*vec4((sideIndex*2.-1.)*dungeonTorchSource.x,
              dungeonTorchSource.y,torchZ,1.)).xyz;
            distantTorch.color=dungeonTorchColor*dungeonTorchGrid.w*dungeonLightPulse(dungeonTorchTime,torchRow*2.399+sideIndex*1.731);
            distantTorch.distance=dungeonTorchSource.z; distantTorch.decay=2.;
            IncidentLight torchIncident; getPointLightInfo(distantTorch,geometryPosition,torchIncident);
            if(torchIncident.visible)RE_Direct(torchIncident,geometryPosition,geometryNormal,geometryViewDir,geometryClearcoatNormal,material,reflectedLight);
          }`);
    };
    material.customProgramCacheKey = () => `${key}|physical-dungeon-torches-v4`;
    material.needsUpdate = true;
  }

  _billboards(phases, width, height, offsetY, fragmentShader, name, order) {
    const geometry = new THREE.PlaneGeometry(width, height); geometry.translate(0, height / 2, 0);
    geometry.setAttribute('torchPhase', new THREE.InstancedBufferAttribute(phases, 1));
    const material = new THREE.ShaderMaterial({ uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), time: this.time },
      vertexShader: billboardVertex, fragmentShader, transparent: true,
      depthWrite: false, side: THREE.DoubleSide, fog: true });
    const mesh = new THREE.InstancedMesh(geometry, material, this.anchors.length);
    mesh.name = name; mesh.renderOrder = order;
    const matrix = new THREE.Matrix4();
    this.anchors.forEach((anchor, index) => {
      matrix.makeTranslation(anchor.flame.x, anchor.flame.y + offsetY, anchor.flame.z);
      mesh.setMatrixAt(index, matrix);
    });
    this.root.add(mesh); return mesh;
  }

  _embers() {
    const positions = [], seeds = [];
    for (const anchor of this.anchors) for (let n = 0; n < 3; n++) {
      positions.push(...anchor.flame.toArray()); seeds.push(anchor.phase + n * 3.17);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('sparkSeed', new THREE.Float32BufferAttribute(seeds, 1));
    const material = new THREE.ShaderMaterial({ uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), time: this.time },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
      vertexShader: `uniform float time; attribute float sparkSeed; varying float vLife;
        #include <fog_pars_vertex>
        void main(){float life=fract(time*.31+sparkSeed*.13);vLife=life;
          vec3 p=position+vec3(sin(sparkSeed*3.+life*5.)*life*.32,life*2.2,cos(sparkSeed+life*4.)*life*.18);
          vec4 mvPosition=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mvPosition;
          gl_PointSize=min(4.,55./max(1.,-mvPosition.z))*(1.-life*.45);
          #include <fog_vertex>
        }`,
      fragmentShader: `varying float vLife;
        #include <fog_pars_fragment>
        void main(){float glow=exp(-dot(gl_PointCoord-.5,gl_PointCoord-.5)*20.);
          gl_FragColor=vec4(vec3(2.2,.55,.05),glow*pow(1.-vLife,2.)*smoothstep(0.,.08,vLife)*.65);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }` });
    this.embers = new THREE.Points(geometry, material); this.embers.name = 'TorchEmbers';
    this.embers.renderOrder = 3; this.embers.frustumCulled = false; this.root.add(this.embers);
  }

  update(dt, cameraPosition) {
    if (this.disposed) return;
    this.time.value += dt;
    // Keep distant flames and their light; the detailed holders are too small
    // to resolve past this range and otherwise cost thousands of triangles each.
    for (const batch of this.batches ?? []) batch.mesh.visible =
      cameraPosition.z >= batch.minZ - 80 && cameraPosition.z <= batch.maxZ + 80;
    // Select a complete wall pair, retaining it across tiny camera movements.
    let nearest = this.nearestAnchor ?? 0, distance = Math.abs(this.anchors[nearest].flame.z - cameraPosition.z);
    for (let index = 0; index < this.anchors.length; index += 2) {
      const candidate = Math.abs(this.anchors[index].flame.z - cameraPosition.z);
      if (candidate + 0.35 < distance) { nearest = index; distance = candidate; }
    }
    this.nearestAnchor = nearest;
    this.lightUniforms.dungeonTorchSlotsA.value.set(this.anchors[nearest].id, this.anchors[nearest + 1].id, -1, -1);
    this.lightUniforms.dungeonTorchSlotsB.value.set(-1, -1, -1, -1);
    this.lights.forEach((light, slot) => {
      const anchor = this.anchors[nearest + slot];
      if (!anchor) { light.intensity = 0; return; }
      light.position.copy(anchor.flame); light.position.y += 0.22;
      const t = this.time.value, p = anchor.phase;
      light.intensity = POWER * (1 + .045 * Math.sin(t * 6.7 + p) + .025 * Math.sin(t * 11.3 + p * 2.1) + .012 * Math.sin(t * 19 + p * .7));
    });
  }

  dispose() {
    this.disposed = true;
    // The player survives checkpoint loads and can leave for another chapter.
    // Release this room's shader hooks instead of stacking lighting injections.
    for (const [material, hooks] of this.originalHooks) {
      Object.assign(material, hooks); material.needsUpdate = true;
    }
    this.originalHooks.clear();
  }
}
