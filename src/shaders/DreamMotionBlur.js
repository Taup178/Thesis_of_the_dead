import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { Vector2 } from 'three';
import { CinematicRenderer } from './CinematicRenderer.js';

const GradingShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){vec4 source=texture2D(tDiffuse,vUv);vec3 c=source.rgb;
      float luma=dot(c,vec3(.2126,.7152,.0722));
      c=mix(vec3(luma),c,1.08); c=(c-.5)*1.06+.5;
      c*=vec3(1.025,1.005,.975);
      float edge=smoothstep(.25,.8,length(vUv-.5));
      gl_FragColor=vec4(clamp(c*(1.-edge*.14),0.,1.),source.a);}`,
};

/** A short exposure made from recent frames; HUD and menus stay sharp. */
export class DreamMotionBlur {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.composer = new EffectComposer(renderer);
    this.blur = new AfterimagePass();
    this.blur.compFsMaterial.fragmentShader = `
      uniform sampler2D tOld, tNew;
      uniform float damp;
      varying vec2 vUv;
      void main() {
        vec4 current = texture2D(tNew, vUv);
        gl_FragColor = damp == 0.0 ? current : mix(current, texture2D(tOld, vUv), damp);
      }`;
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(this.blur);
    this.composer.addPass(new OutputPass());
    this.grading = new ShaderPass(GradingShader); this.grading.enabled = false;
    this.fxaa = new ShaderPass(FXAAShader); this.fxaa.enabled = false;
    this.composer.addPass(this.grading); this.composer.addPass(this.fxaa);
    this.graphics = null;
    this.cinematic = new CinematicRenderer(renderer);
    this.reset();
  }

  configure(settings) {
    this.graphics = settings;
    // Allocate expensive effects only when requested; Low also releases their
    // GPU buffers. AO works at half resolution to keep foliage affordable.
    for (const [key, enabled] of [['ao', settings.ambientOcclusion], ['bloom', settings.bloom]]) {
      if (this[key] && !enabled) {
        this.composer.removePass(this[key]); this[key].dispose(); this[key] = null;
      }
    }
    if (settings.ambientOcclusion && !this.ao) {
      this.ao = new SSAOPass(this.scene, this.camera, 1, 1, 16);
      const resize = this.ao.setSize.bind(this.ao);
      this.ao.setSize = (width, height) => resize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
      this.ao.kernelRadius = 5; this.ao.minDistance = .001; this.ao.maxDistance = .05;
      const renderAO = this.ao.render.bind(this.ao);
      this.ao.render = (renderer, ...args) => {
        const autoUpdate = renderer.shadowMap.autoUpdate;
        try { renderer.shadowMap.autoUpdate = false; renderAO(renderer, ...args); }
        finally { renderer.shadowMap.autoUpdate = autoUpdate; }
      };
      this.composer.insertPass(this.ao, 1);
    }
    if (settings.bloom && !this.bloom) {
      this.bloom = new UnrealBloomPass(new Vector2(1, 1), .28, .35, 1.05);
      this.composer.insertPass(this.bloom, this.ao ? 2 : 1);
    }
    if (this.ao) this.ao.enabled = settings.ambientOcclusion;
    if (this.bloom) {
      this.bloom.enabled = settings.bloom;
      this.bloom.strength = settings.preset === 'ultra' ? .4 : settings.preset === 'high' ? .28 : .18;
    }
    this.grading.enabled = settings.colorGrading;
    this.fxaa.enabled = settings.antiAliasing;
    this.hasGraphicsEffects = settings.ambientOcclusion || settings.bloom || settings.colorGrading || settings.antiAliasing;
    const size = this.renderer.getSize(new Vector2()); this.setSize(size.x, size.y);
    this.reset();
  }

  reset() { this.fresh = true; }

  render(dt, strength = 0, scene = this.scene, cinematic = false) {
    if (scene !== this.scene || cinematic) {
      this.reset();
      if (this.cinematic) this.cinematic.render(scene, this.camera, this.graphics?.preset);
      else this.renderer.render(scene, this.camera);
      return;
    }
    if (strength <= 0 && !this.hasGraphicsEffects) {
      this.reset();
      this.renderer.render(this.scene, this.camera);
      return;
    }
    // The same short trail at different frame rates; never blend across a camera cut.
    this.blur.enabled = strength > 0;
    this.blur.uniforms.damp.value = this.fresh || strength <= 0 ? 0 : Math.exp(-Math.max(dt, 1 / 240) / (0.065 * Math.min(strength, 1)));
    this.composer.render(dt);
    this.fresh = strength <= 0;
  }

  setSize(width, height) {
    const ratio = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(ratio); this.composer.setSize(width, height);
    this.fxaa?.uniforms.resolution.value.set(1 / Math.max(1, width * ratio), 1 / Math.max(1, height * ratio));
    this.reset();
  }

  dispose() {
    this.cinematic.dispose();
    for (const pass of this.composer.passes) pass.dispose?.();
    this.composer.dispose();
  }
}
