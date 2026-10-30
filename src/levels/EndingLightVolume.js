import * as THREE from 'three';

/** Depth-limited scattering of the same window cookie that lights the stage.
 * One scene render plus one bounded fullscreen pass; no overlapping shaft cards.
 */
export class EndingLightVolume {
  constructor(light, cookie) {
    this.light = light;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.size = new THREE.Vector2();
    this.uniforms = {
      colorBuffer: { value: this.target.texture }, depthBuffer: { value: this.target.depthTexture },
      cookie: { value: cookie }, hasCookie: { value: !!cookie },
      inverseProjection: { value: new THREE.Matrix4() }, cameraWorld: { value: new THREE.Matrix4() },
      lightMatrix: { value: new THREE.Matrix4() }, eye: { value: new THREE.Vector3() },
      source: { value: light.position }, amount: { value: 0 }, steps: { value: 32 }, time: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, depthTest: false, depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader: `
        uniform sampler2D colorBuffer, depthBuffer, cookie;
        uniform mat4 inverseProjection, cameraWorld, lightMatrix;
        uniform vec3 eye, source; uniform float amount, time; uniform int steps; uniform bool hasCookie;
        varying vec2 vUv;
        void main(){
          vec3 color=texture2D(colorBuffer,vUv).rgb;
          float depth=texture2D(depthBuffer,vUv).r;
          vec4 endView=inverseProjection*vec4(vUv*2.-1.,depth*2.-1.,1.);
          vec3 endWorld=(cameraWorld*vec4(endView.xyz/endView.w,1.)).xyz;
          vec3 ray=endWorld-eye; float rayDistance=min(length(ray),16.); ray=normalize(ray);
          float stride=rayDistance/float(steps), scattering=0.;
          // Midpoint samples and the feathered cookie keep this quiet at Low
          // resolution; random per-pixel jitter looked like grain in the beams.
          float jitter=.5;
          for(int i=0;i<48;i++){
            if(i>=steps)break;
            vec3 p=eye+ray*(float(i)+jitter)*stride;
            vec4 projected=lightMatrix*vec4(p,1.);
            vec3 uv=projected.xyz/projected.w;
            if(projected.w>0. && uv.x>0. && uv.x<1. && uv.y>0. && uv.y<1. && uv.z<1. && p.y>0.03){
              float mask=hasCookie?texture2D(cookie,uv.xy).r:1.;
              float edge=smoothstep(0.,.1,uv.x)*smoothstep(0.,.1,1.-uv.x)
                        *smoothstep(0.,.1,uv.y)*smoothstep(0.,.1,1.-uv.y);
              float haze=.94+.06*sin(p.x*2.+p.y*3.+time*.12);
              scattering+=mask*edge*haze*stride/(1.+distance(p,source)*.16);
            }
          }
          color+=vec3(1.,.72,.40)*scattering*amount*.028;
          // A quiet lens falloff, not a bright halo around the actor.
          float vignette=1.-.16*smoothstep(.25,.78,length(vUv-.5));
          gl_FragColor=vec4(color*vignette,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad); this.camera = new THREE.Camera();
  }

  render(renderer, scene, camera, amount, time, quality) {
    renderer.getDrawingBufferSize(this.size);
    if (this.target.width !== this.size.x || this.target.height !== this.size.y) this.target.setSize(this.size.x, this.size.y);
    const previous = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(this.target); renderer.render(scene, camera);
      this.light.shadow.updateMatrices(this.light);
      this.uniforms.lightMatrix.value.copy(this.light.shadow.matrix);
      this.uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
      this.uniforms.cameraWorld.value.copy(camera.matrixWorld);
      this.uniforms.eye.value.copy(camera.position);
      this.uniforms.amount.value = amount; this.uniforms.time.value = time;
      this.uniforms.steps.value = quality === 'low' ? 12 : quality === 'high' ? 24 : 18;
      renderer.setRenderTarget(previous); renderer.render(this.scene, this.camera);
    } finally { renderer.setRenderTarget(previous); }
  }

  dispose() { this.target.dispose(); this.target.depthTexture.dispose(); this.quad.geometry.dispose(); this.material.dispose(); }
}
