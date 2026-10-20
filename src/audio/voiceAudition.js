import { AudioManager } from '../core/AudioManager.js';
import { loadVoiceAssets } from './Level1Voices.js';
import { LEVEL2_VOICE_CUES } from './level2VoiceCatalog.js';

const audio = new AudioManager();
// Audition options are temporary. Do not overwrite the player's saved preferences.
audio.internalVoices.settings = { enabled: true, volume: 0.7, mode: 'headphones', subtitles: false };
const get = id => document.getElementById(id);
let recordingUrl;
const identities = ['tormentor', 'anxious', 'manipulator', 'protector'];
const revokeRecording = () => { if (typeof recordingUrl === 'string' && recordingUrl.startsWith('blob:')) URL.revokeObjectURL(recordingUrl); };
const chapterAssets = await loadVoiceAssets('./assets/audio/voices/level2/manifest.json', LEVEL2_VOICE_CUES);
for (const line of LEVEL2_VOICE_CUES.flatMap(cue => cue.lines)) {
  if (!chapterAssets[line.id]) continue;
  const option = document.createElement('option'); option.value = line.id;
  option.textContent = `${line.label}: ${line.text}`;
  get('chapter-line').append(option);
}
get('chapter-line').addEventListener('change', () => {
  audio.internalVoices.unload(); revokeRecording();
  recordingUrl = chapterAssets[get('chapter-line').value] || null;
  const line = LEVEL2_VOICE_CUES.flatMap(cue => cue.lines).find(item => item.id === get('chapter-line').value);
  if (line) get('identity').selectedIndex = identities.indexOf(line.identity);
  get('play').disabled = !recordingUrl;
  get('status').textContent = line ? `${line.text} — effects already included in the recording.` : 'Choose a recording.';
});
const unlock = async () => {
  audio.setVolume(Number(get('master').value) / 100);
  const context = audio.ensureContext();
  if (context?.state === 'suspended') await context.resume();
};
get('recording').addEventListener('change', () => {
  audio.internalVoices.unload();
  revokeRecording();
  get('chapter-line').value = '';
  const file = get('recording').files[0];
  recordingUrl = file ? URL.createObjectURL(file) : null;
  get('play').disabled = !file;
  get('status').textContent = file ? `Ready: ${file.name}` : 'Choose a recording.';
});
get('master').addEventListener('input', () => audio.setVolume(Number(get('master').value) / 100));
get('music').addEventListener('click', async () => {
  await unlock();
  await audio.playTheme('voice-audition', './assets/audio/music/rannsaka.mp3', { volume: 0.62 });
});
get('play').addEventListener('click', async () => {
  await unlock();
  audio.internalVoices.settings.mode = get('output').value;
  const voice = await audio.internalVoices.play(recordingUrl, {
    pan: Number(get('identity').value),
    identity: ['tormentor', 'anxious', 'manipulator', 'protector'][get('identity').selectedIndex],
    onStart: () => { get('status').textContent = 'Voice playing — background mix reduced.'; },
    onEnd: () => { get('status').textContent = audio.internalVoices.active.size ? 'Another voice is still speaking.' : 'Voice ended — background mix recovering.'; },
  });
  if (!voice) get('status').textContent = 'Could not play: check the audio format or wait for a voice to finish.';
});
get('stop').addEventListener('click', () => audio.internalVoices.stop());
get('stop-all').addEventListener('click', () => audio.stopAll());
document.addEventListener('visibilitychange', () => { if (document.hidden) audio.pause(); });
window.addEventListener('pagehide', () => { audio.dispose(); revokeRecording(); });
function showMix() {
  get('mix').textContent = Object.entries(audio.dialogueDuckGains)
    .map(([name, node]) => `${name}: ${Math.round(node.gain.value * 100)}%`).join(' · ') || 'Normal mix';
  requestAnimationFrame(showMix);
}
showMix();
