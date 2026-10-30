const KEY = 'thesis-of-the-dead:graphics';
export const GRAPHICS_PRESETS = {
  low: { renderScale: .75, shadows: 'off', textureFiltering: 2, ambientOcclusion: false, bloom: false, antiAliasing: false, colorGrading: false, motionBlur: false },
  medium: { renderScale: 1, shadows: 'medium', textureFiltering: 4, ambientOcclusion: false, bloom: true, antiAliasing: true, colorGrading: false, motionBlur: false },
  high: { renderScale: 1, shadows: 'high', textureFiltering: 8, ambientOcclusion: true, bloom: true, antiAliasing: true, colorGrading: true, motionBlur: false },
  ultra: { renderScale: 1.25, shadows: 'ultra', textureFiltering: 16, ambientOcclusion: true, bloom: true, antiAliasing: true, colorGrading: true, motionBlur: true },
};
export const GRAPHICS_DESCRIPTIONS = {
  low: 'Performance first. Reduced resolution, simple lighting and no post effects.',
  medium: 'Balanced. Soft shadows, smoother edges and a subtle glow around bright lights.',
  high: 'Detailed. Sharper shadows and textures, contact shading and cinematic colour.',
  ultra: 'Maximum quality. Supersampling and the sharpest shadows. Highest GPU cost.',
};

export function graphicsPreset(preset = 'medium') {
  const name = Object.hasOwn(GRAPHICS_PRESETS, preset) ? preset : 'medium';
  return { preset: name, ...GRAPHICS_PRESETS[name], brightness: 1, showFps: false };
}

export function normalizeGraphics(value = {}) {
  const settings = graphicsPreset(value?.preset);
  if (!value || typeof value !== 'object') return settings;
  for (const key of ['ambientOcclusion', 'bloom', 'antiAliasing', 'colorGrading', 'motionBlur', 'showFps']) {
    if (typeof value[key] === 'boolean') settings[key] = value[key];
  }
  if (['off', 'low', 'medium', 'high', 'ultra'].includes(value.shadows)) settings.shadows = value.shadows;
  if ([1, 2, 4, 8, 16].includes(value.textureFiltering)) settings.textureFiltering = value.textureFiltering;
  if (typeof value.renderScale === 'number' && Number.isFinite(value.renderScale)) settings.renderScale = Math.max(.5, Math.min(1.5, value.renderScale));
  if (typeof value.brightness === 'number' && Number.isFinite(value.brightness)) settings.brightness = Math.max(.7, Math.min(1.3, value.brightness));
  return settings;
}

export function isCustomGraphics(settings) {
  return Object.entries(GRAPHICS_PRESETS[settings.preset]).some(([key, value]) => settings[key] !== value);
}

export function loadGraphics() {
  try {
    const saved = globalThis.localStorage?.getItem(KEY);
    if (saved) return normalizeGraphics(JSON.parse(saved));
    return graphicsPreset(globalThis.localStorage?.getItem('thesis-of-the-dead:quality'));
  } catch { return graphicsPreset(); }
}

export function saveGraphics(value) {
  const settings = normalizeGraphics(value);
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
    globalThis.localStorage?.setItem('thesis-of-the-dead:quality', settings.preset);
  } catch { /* Settings still apply when storage is unavailable. */ }
}
