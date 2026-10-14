import * as THREE from 'three';

const noise = `
float burnHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float burnNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(burnHash(i),burnHash(i+vec2(1.,0.)),f.x),mix(burnHash(i+vec2(0.,1.)),burnHash(i+1.),f.x),f.y);}
float burnFbm(vec2 p){return burnNoise(p)*.57+burnNoise(p*2.03)*.28+burnNoise(p*4.11)*.15;}`;
const billboard = `varying vec2 vUv;
void main(){vUv=uv;vec4 world=modelMatrix*vec4(0.,0.,0.,1.);
vec3 right=normalize(vec3(viewMatrix[0][0],0.,viewMatrix[2][0]));
world.xyz+=right*position.x+vec3(0.,position.y,0.);gl_Position=projectionMatrix*viewMatrix*world;}`;

/** A burning front in the paper, with flames, smoke, falling ash and light at that exact front. */
export class DegreeBurnEffects {
  constructor(root, scroll, edgeSign) {
    this.scroll = scroll; this.edgeSign = edgeSign; this.root = new THREE.Group(); this.root.name = 'BurningDegreeEffects';
    root.add(this.root); this.time = 0; this.progress = 0; this.disposed = false;
    this.uniforms = { burnProgress: { value: 0 }, burnTime: { value: 0 },
      degreeInverse: { value: new THREE.Matrix4() }, degreeEdge: { value: edgeSign } };
    this.materials = new Map(); this.originals = []; this.seals = [];
    this.anchor = new THREE.Vector3(); this.particlePosition = new THREE.Vector3();
    scroll.traverse(mesh => {
      if (!mesh.isMesh) return;
      if (mesh.material.metalness > 0.5) { this.seals.push({ mesh, parent: mesh.parent, position: mesh.position.clone(), rotation: mesh.quaternion.clone(), scale: mesh.scale.clone() }); return; }
      const original = mesh.material;
      if (!this.materials.has(original)) {
        const material = original.clone();
        material.onBeforeCompile = shader => {
          Object.assign(shader.uniforms, this.uniforms);
          shader.vertexShader = `uniform mat4 degreeInverse;varying vec3 vDegreeBurnPosition;\n${shader.vertexShader}`
            .replace('#include <project_vertex>', `vDegreeBurnPosition=(degreeInverse*modelMatrix*vec4(transformed,1.)).xyz;\n#include <project_vertex>`);
          shader.fragmentShader = `uniform float burnProgress;uniform float burnTime;uniform float degreeEdge;varying vec3 vDegreeBurnPosition;${noise}\n${shader.fragmentShader}`
            .replace('#include <alphatest_fragment>', `
              float burnFront=.46-burnProgress*.92;
              float burnDistance=burnFront-vDegreeBurnPosition.x*degreeEdge
                +(burnFbm(vDegreeBurnPosition.yz*48.)-.5)*.026;
              if(burnProgress>.001&&burnDistance<0.)discard;
              float charred=(1.-smoothstep(.012,.13,burnDistance))*smoothstep(0.,.025,burnProgress);
              diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.025,.012,.007),charred);
              #include <alphatest_fragment>`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
              float hotEdge=(1.-smoothstep(.003,.024,burnDistance))*smoothstep(0.,.025,burnProgress);
              totalEmissiveRadiance+=vec3(2.6,.36,.025)*hotEdge*(.8+.2*burnNoise(vDegreeBurnPosition.xy*80.+burnTime));`);
        };
        material.customProgramCacheKey = () => 'degree-paper-burn-v1';
        this.materials.set(original, material);
      }
      this.originals.push({ mesh, material: original, castShadow: mesh.castShadow }); mesh.material = this.materials.get(original);
      mesh.castShadow = false; // The consumed paper must not leave the original cylinder's shadow behind.
    });
    this.fireUniforms = { time: { value: 0 }, amount: { value: 0 } };
    this.flameMaterial = new THREE.ShaderMaterial({ uniforms: this.fireUniforms, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, vertexShader: billboard, fragmentShader: `uniform float time;uniform float amount;varying vec2 vUv;${noise}
      void main(){float y=vUv.y;float curl=burnFbm(vec2(vUv.x*4.,y*5.-time*3.4));
        float bend=sin(y*8.-time*3.)*y*.16;
        float width=.82*pow(max(0.,1.-y),.72);
        float density=1.-abs(vUv.x*2.-1.-bend)/max(.01,width)+(curl-.5)*.65;
        float alpha=smoothstep(0.,.22,density)*smoothstep(0.,.05,y)*(1.-smoothstep(.75,1.,y+(curl-.5)*.2))*amount;
        if(alpha<.003)discard;
        vec3 color=mix(vec3(3.,.2,.018),vec3(5.,1.9,.2),smoothstep(.2,.85,density));
        color=mix(color,vec3(7.,4.8,1.8),pow(clamp(density,0.,1.),2.)*(1.-smoothstep(.1,.6,y)));
        gl_FragColor=vec4(color,alpha*.92);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
    this.flameGeometry = new THREE.PlaneGeometry(0.42, 0.7); this.flameGeometry.translate(0, 0.35, 0);
    this.flame = new THREE.Mesh(this.flameGeometry, this.flameMaterial); this.root.add(this.flame);
    this.smokeMaterial = new THREE.ShaderMaterial({ uniforms: this.fireUniforms, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, vertexShader: billboard, fragmentShader: `uniform float time;uniform float amount;varying vec2 vUv;${noise}
      void main(){float x=(vUv.x-.5)*2.+sin(vUv.y*4.-time)*vUv.y*.3;
        float cloud=burnFbm(vec2(x*3.,vUv.y*5.-time*1.4));
        float alpha=cloud*exp(-x*x*5.)*smoothstep(0.,.12,vUv.y)*(1.-vUv.y)*.26*amount;
        gl_FragColor=vec4(vec3(.2,.18,.16),alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
    this.smokeGeometry = new THREE.PlaneGeometry(0.8, 1.6); this.smokeGeometry.translate(0, 0.95, 0);
    this.smoke = new THREE.Mesh(this.smokeGeometry, this.smokeMaterial); this.root.add(this.smoke);
    // Keep the existing sun shadows; a second shadow-casting light would add six scene renders per frame.
    this.light = new THREE.PointLight(0xffa343, 0, 5, 2); this.root.add(this.light);
    this.particleGeometry = new THREE.BufferGeometry();
    this.particles = Array.from({ length: 96 }, (_, index) => ({ index, birth: index * 0.038, origin: null }));
    this.positions = new Float32Array(96 * 3); this.life = new Float32Array(96);
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.particleGeometry.setAttribute('particleLife', new THREE.BufferAttribute(this.life, 1));
    this.particleGeometry.setAttribute('particleSeed', new THREE.Float32BufferAttribute(this.particles.map(p => p.index * 1.731), 1));
    this.particleMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
      vertexShader: `attribute float particleLife;attribute float particleSeed;varying float vLife;varying float vSeed;
        void main(){vLife=particleLife;vSeed=particleSeed;vec4 p=modelViewMatrix*vec4(position,1.);
        gl_Position=projectionMatrix*p;gl_PointSize=clamp(42./max(.5,-p.z),1.,6.);}`,
      fragmentShader: `varying float vLife;varying float vSeed;
        void main(){if(vLife<=0.)discard;vec2 p=gl_PointCoord-.5;float ember=step(.68,fract(vSeed));
        float alpha=(1.-smoothstep(.2,.5,length(p)))*vLife;
        vec3 color=mix(vec3(.09,.075,.055),vec3(3.,.52,.03),ember);
        gl_FragColor=vec4(color,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
    this.ash = new THREE.Points(this.particleGeometry, this.particleMaterial); this.ash.frustumCulled = false; this.root.add(this.ash);
  }

  setActive(active) {
    this.root.visible = active;
    for (const original of this.originals) original.mesh.castShadow = active ? false : original.castShadow;
  }

  edgePosition(progress = this.progress, target = new THREE.Vector3()) {
    return this.scroll.localToWorld(target.set(this.edgeSign * (0.43 - progress * 0.86), 0, 0));
  }

  update(dt, fireTime, progress) {
    this.time += dt; this.progress = progress;
    this.uniforms.burnProgress.value = progress; this.uniforms.burnTime.value = this.time;
    const active = fireTime >= 0 && progress < 1;
    const amount = active ? THREE.MathUtils.smoothstep(fireTime, 0, 0.35)
      * (1 - THREE.MathUtils.smoothstep(progress, 0.8, 1)) : 0;
    const anchor = this.edgePosition(progress, this.anchor);
    this.uniforms.degreeInverse.value.copy(this.scroll.matrixWorld).invert();
    this.flame.position.copy(anchor); this.smoke.position.copy(anchor);
    this.fireUniforms.time.value = this.time; this.fireUniforms.amount.value = amount;
    this.flame.visible = amount > 0; this.smoke.visible = fireTime >= 0;
    this.light.position.copy(anchor); this.light.position.y += 0.08;
    this.light.intensity = 18 * amount * (1 + 0.035 * Math.sin(this.time * 13) + 0.025 * Math.sin(this.time * 21));
    this.ash.visible = fireTime >= 0;
    if (fireTime < 0) return;
    for (const particle of this.particles) {
      const age = fireTime - particle.birth;
      if (age < 0 || age > 1.5) { this.life[particle.index] = 0; continue; }
      if (!particle.origin) particle.origin = anchor.clone();
      const seed = particle.index * 1.731, ember = (seed % 1) > 0.68;
      const p = this.particlePosition.copy(particle.origin);
      p.x += Math.sin(seed) * age * 0.18 + Math.sin(age * 10 + seed) * 0.025;
      p.z += Math.cos(seed * 2) * age * 0.12;
      p.y += (ember ? 0.65 : 0.22) * age - (ember ? 0.1 : 0.65) * age * age;
      p.toArray(this.positions, particle.index * 3); this.life[particle.index] = (1 - age / 1.5) * Math.min(1, age * 20);
    }
    this.particleGeometry.attributes.position.needsUpdate = this.particleGeometry.attributes.particleLife.needsUpdate = true;
    for (const seal of this.seals) {
      const release = THREE.MathUtils.clamp((0.46 - seal.position.x * this.edgeSign) / 0.92, 0.1, 0.85);
      if (progress < release) continue;
      if (seal.dropTime === undefined) { seal.dropTime = this.time; this.root.attach(seal.mesh); seal.origin = seal.mesh.position.clone(); }
      const age = this.time - seal.dropTime;
      seal.mesh.position.copy(seal.origin); seal.mesh.position.y = Math.max(1.23, seal.origin.y - 2.5 * age * age);
      seal.mesh.rotation.x += dt * 2;
    }
    if (progress >= 1) this.scroll.visible = false;
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const { mesh, material, castShadow } of this.originals) { mesh.material = material; mesh.castShadow = castShadow; }
    for (const seal of this.seals) {
      seal.parent.add(seal.mesh); seal.mesh.position.copy(seal.position); seal.mesh.quaternion.copy(seal.rotation); seal.mesh.scale.copy(seal.scale);
    }
    for (const material of this.materials.values()) material.dispose();
    for (const resource of [this.flameGeometry, this.smokeGeometry, this.particleGeometry, this.flameMaterial, this.smokeMaterial, this.particleMaterial]) resource.dispose();
    this.light.shadow.dispose(); this.root.removeFromParent();
  }
}
