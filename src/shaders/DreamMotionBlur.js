import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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
    this.reset();
  }

  reset() { this.fresh = true; }

  render(dt, active) {
    if (!active) {
      this.reset();
      this.renderer.render(this.scene, this.camera);
      return;
    }
    // The same short trail at different frame rates; never blend across a camera cut.
    this.blur.uniforms.damp.value = this.fresh ? 0 : Math.exp(-Math.max(dt, 1 / 240) / 0.065);
    this.composer.render(dt);
    this.fresh = false;
  }

  setSize(width, height) { this.composer.setSize(width, height); this.reset(); }
}
