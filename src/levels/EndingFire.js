import * as THREE from 'three';

const smooth = THREE.MathUtils.smoothstep;
const TAU = Math.PI * 2;

/** Small, overlapping flame volumes follow the animated body, rather than a
 * stationary cage of crossed planes. All flames share one instanced draw call. */
export class EndingFire {
  constructor(scene, player, textures = {}) {
    this.player = player; this.count = 18;
    this.uniforms = { time: { value: 0 }, strength: { value: 0 }, atlas: { value: textures.fire ?? null }, useAtlas: { value: !!textures.fire } };
    const plane = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = plane.index.clone();
    this.geometry.setAttribute('position', plane.attributes.position.clone());
    this.geometry.setAttribute('uv', plane.attributes.uv.clone()); plane.dispose();
    this.offset = new Float32Array(this.count * 3); this.sizes = new Float32Array(this.count * 2);
    this.geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(this.offset, 3));
    this.geometry.setAttribute('size', new THREE.InstancedBufferAttribute(this.sizes, 2));
    this.geometry.setAttribute('seed', new THREE.InstancedBufferAttribute(Float32Array.from({ length: this.count }, (_, i) => i * .618034 % 1), 1));
    this.geometry.instanceCount = this.count;
    this.material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: this.uniforms,
      vertexShader: `attribute vec3 offset; attribute vec2 size; attribute float seed;
        uniform float time; varying vec2 vUv; varying float vSeed;
        void main(){vUv=uv;vSeed=seed;
          vec4 center=modelViewMatrix*vec4(offset,1.);
          center.xy+=vec2(position.x*size.x + sin(time*2.7+seed*23.)*position.y*.035,position.y*size.y);
          gl_Position=projectionMatrix*center;}`,
      fragmentShader: `uniform sampler2D atlas; uniform bool useAtlas; uniform float time, strength;
        varying vec2 vUv; varying float vSeed;
        vec4 frame(float f,vec2 uv){
          vec2 cell=vec2(mod(f,8.),7.-floor(f/8.));
          return texture2D(atlas,(cell+clamp(uv,vec2(.004),vec2(.996)))/8.);
        }
        void main(){
          vec2 uv=vUv; uv.x+=sin(uv.y*9.-time*5.+vSeed*31.)*.035*uv.y;
          float edge=smoothstep(0.,.13,vUv.x)*smoothstep(0.,.13,1.-vUv.x)
                     *smoothstep(0.,.09,vUv.y)*smoothstep(0.,.18,1.-vUv.y);
          float heat, alpha;
          if(useAtlas){
            // Keep the turbulent flame, rejecting the original effect's white
            // flare and grey smoke. Smoke is separately sorted and lit below.
            vec2 sampleUv=vec2(uv.x,uv.y*.64+.02);
            float f=mod(time*(23.+vSeed*5.)+vSeed*64.,64.);
            vec4 tex=mix(frame(floor(f),sampleUv),frame(mod(floor(f)+1.,64.),sampleUv),fract(f));
            heat=smoothstep(.03,.65,tex.r-tex.b);
            alpha=tex.a*smoothstep(.018,.18,tex.r-tex.b);
          }else{
            float wave=sin(uv.y*14.-time*7.+vSeed*29.)*.12;
            heat=pow(max(0.,1.-abs((uv.x-.5+wave)*2.)),2.)*(1.-uv.y);
            alpha=smoothstep(.08,.35,heat);
          }
          vec3 fire=mix(vec3(1.1,.07,.005),vec3(2.4,1.1,.12),heat);
          gl_FragColor=vec4(fire,alpha*edge*strength*.36);
          if(gl_FragColor.a<.002)discard;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    this.flames = new THREE.Mesh(this.geometry, this.material); this.flames.frustumCulled = false; this.flames.renderOrder = 2; scene.add(this.flames);
    const names = ['LowerLegL', 'LowerLegR', 'Hips', 'Abdomen', 'Torso', 'UpperArmR'];
    this.anchors = names.map(name => player.characterModel?.getObjectByName(name));
    this.anchorPositions = names.map(() => new THREE.Vector3());
    this.smoke = [];
    for (let i = 0; i < 14; i++) {
      const material = new THREE.SpriteMaterial({ map: textures.smoke ?? null, color: 0x353238, transparent: true, opacity: 0, depthWrite: false });
      const puff = new THREE.Sprite(material); puff.renderOrder = 1; scene.add(puff); this.smoke.push(puff);
    }
    this.sparkGeometry = new THREE.BufferGeometry(); this.sparkPositions = new Float32Array(32 * 3);
    this.sparkGeometry.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));
    this.sparkMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { opacity: { value: 0 } },
      vertexShader: `void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(12./-p.z,1.,3.);}`,
      fragmentShader: `uniform float opacity;void main(){float a=1.-smoothstep(.05,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(1.,.38,.035,a*opacity);}` });
    this.sparks = new THREE.Points(this.sparkGeometry, this.sparkMaterial); this.sparks.frustumCulled = false; scene.add(this.sparks);
    this.light = new THREE.PointLight(0xff7d24, 0, 6, 2); scene.add(this.light);
    this.rim = new THREE.PointLight(0xff390a, 0, 5, 2); scene.add(this.rim);
  }

  update(t, amount, ash, quality) {
    const origin = this.player.group.position, collapse = smooth(t, 13, 15.5);
    this.uniforms.time.value = t; this.uniforms.strength.value = amount * (1 - ash);
    this.player.group.updateWorldMatrix(true, true);
    for (let j = 0; j < this.anchors.length; j++) {
      if (this.anchors[j]) this.anchors[j].getWorldPosition(this.anchorPositions[j]);
      else this.anchorPositions[j].copy(origin).add(new THREE.Vector3(0, .15 + j * .2, 0));
    }
    for (let i = 0; i < this.count; i++) {
      const seed = i * .618034 % 1, a = seed * TAU, anchor = this.anchorPositions[i % this.anchors.length];
      const life = (t * (.6 + seed * .25) + seed) % 1;
      const height = (.8 + seed * .65) * (.65 + amount * .35) * (1 - collapse * .35);
      const radius = .17 + seed * .14;
      this.offset.set([anchor.x + Math.sin(a) * radius + Math.sin(t * 3 + a) * .035,
        Math.max(.12, anchor.y) + height * .35 + life * .16,
        anchor.z + Math.cos(a) * radius], i * 3);
      this.sizes.set([(.45 + seed * .35) * (1 - collapse * .15), height], i * 2);
    }
    this.geometry.attributes.offset.needsUpdate = true; this.geometry.attributes.size.needsUpdate = true;
    const smokeAmount = smooth(t, 6.5, 10) * (1 - smooth(t, 18, 22));
    for (let i = 0; i < this.smoke.length; i++) {
      const puff = this.smoke[i], seed = i * .618034 % 1, life = (t * .19 + seed) % 1;
      puff.visible = quality !== 'low' || i % 2 === 0;
      puff.position.set(origin.x + Math.sin(seed * 13 + life * 3) * (.15 + life * .45) + life * .3,
        .4 + (1 - collapse) * .65 + life * 2.5, origin.z - .12 + Math.cos(seed * 19) * .23);
      puff.scale.setScalar(.5 + life * 1.1); puff.material.rotation = seed * TAU + life * .45;
      puff.material.opacity = Math.sin(life * Math.PI) * smokeAmount * .19;
      puff.material.color.setRGB(.10 + (1 - life) * .16, .095 + (1 - life) * .06, .10);
    }
    for (let i = 0; i < 32; i++) {
      const seed = i * .618034 % 1, life = (t * (.35 + seed * .3) + seed) % 1;
      this.sparkPositions.set([origin.x + Math.sin(i * 7 + life * 3) * (.25 + life * .35),
        .2 + life * (2.9 - collapse), origin.z + Math.cos(i * 5) * .4], i * 3);
    }
    this.sparkGeometry.attributes.position.needsUpdate = true;
    this.sparkMaterial.uniforms.opacity.value = amount * (1 - ash) * .6;
    const flicker = 1 + .07 * Math.sin(t * 13) + .045 * Math.sin(t * 23.7);
    this.light.position.copy(origin).add(new THREE.Vector3(-.35, .6 - collapse * .3, .6));
    this.rim.position.copy(origin).add(new THREE.Vector3(.4, .85 - collapse * .5, -.4));
    this.light.intensity = amount * (1 - ash) * 9 * flicker;
    this.rim.intensity = amount * (1 - ash) * 5 * flicker;
  }

  dispose() {
    this.geometry.dispose(); this.material.dispose(); this.sparkGeometry.dispose(); this.sparkMaterial.dispose();
    for (const puff of this.smoke) puff.material.dispose();
  }
}
