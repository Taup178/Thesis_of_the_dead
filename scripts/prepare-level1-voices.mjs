// Offline preparation only. Never calls a generation service.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { LEVEL1_VOICE_CUES } from '../src/audio/level1VoiceCatalog.js';

const masterRoot = 'audio-staging/voices/masters/level1';
const outputRoot = 'public/assets/audio/voices/level1';
// Authored boundaries inside the actual silent gaps of the four completed packs.
// They preserve within-line sentence pauses; blindly cutting every silence would split sentences.
const boundaries = {
  tormentor: [0, 3.26, 6.37, 9.84, 11.85, 15.2, 16.88],
  anxious: [0, 3.15, 6.225, 9.5, 13.5],
  manipulator: [0, 5.6, 9.7, 14.8],
  protector: [0, 4.3, 7.97, 11.7, 15.84, 18.535, 22.25, 25.04, 28.38, 30.38],
};

function readWav(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAV');
  let format, data;
  for (let p = 12; p + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', p, p + 4), length = bytes.readUInt32LE(p + 4);
    if (id === 'fmt ') format = { code: bytes.readUInt16LE(p + 8), channels: bytes.readUInt16LE(p + 10), rate: bytes.readUInt32LE(p + 12), bits: bytes.readUInt16LE(p + 22) };
    if (id === 'data') data = bytes.subarray(p + 8, p + 8 + length);
    p += 8 + length + length % 2;
  }
  if (format?.code !== 1 || format.bits !== 16 || format.rate !== 48000 || !data) throw new Error('Expected 48 kHz PCM16 master');
  const samples = new Float32Array(data.length / 2 / format.channels);
  for (let i = 0; i < samples.length; i++) {
    for (let channel = 0; channel < format.channels; channel++) samples[i] += data.readInt16LE((i * format.channels + channel) * 2) / 32768 / format.channels;
  }
  return samples;
}

function wav(samples, rate) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return b;
}

// Windowed-sinc lowpass before 48 → 24 kHz decimation. Dry mono clips stay small
// and the stereo field is authored at runtime, rather than baked into each file.
const taps = Array.from({ length: 47 }, (_, i) => {
  const x = i - 23, cutoff = 0.225;
  return (x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x))
    * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / 46));
});
const tapSum = taps.reduce((a, b) => a + b, 0);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const clips = {}, records = [];
for (const [identity, cuts] of Object.entries(boundaries)) {
  const original = fs.readFileSync(path.join(masterRoot, `${identity}.wav`));
  const input = readWav(original);
  const lines = LEVEL1_VOICE_CUES.flatMap(cue => cue.lines).filter(line => line.identity === identity);
  if (lines.length !== cuts.length - 1) throw new Error(`Line count mismatch: ${identity}`);
  let power = 0, peak = 0;
  for (const x of input) { power += x * x; peak = Math.max(peak, Math.abs(x)); }
  const gain = Math.min(2, 0.095 / Math.sqrt(power / input.length), 0.8 / peak);
  const folder = path.join(outputRoot, identity); fs.mkdirSync(folder, { recursive: true });
  for (let n = 0; n < lines.length; n++) {
    let start = Math.round(cuts[n] * 48000), end = Math.min(input.length, Math.round(cuts[n + 1] * 48000));
    // Trim only the outer near-silence, retaining 60 ms before and 120 ms after speech.
    while (start < end && Math.abs(input[start]) < 0.001) start++;
    while (end > start && Math.abs(input[end - 1]) < 0.001) end--;
    start = Math.max(Math.round(cuts[n] * 48000), start - 2880);
    end = Math.min(input.length, Math.round(cuts[n + 1] * 48000), end + 5760);
    const out = new Float32Array(Math.ceil((end - start) / 2));
    for (let j = 0; j < out.length; j++) {
      let x = 0;
      for (let t = 0; t < taps.length; t++) {
        const index = start + j * 2 + t - 23;
        if (index >= start && index < end) x += input[index] * taps[t] / tapSum;
      }
      out[j] = x * gain * Math.min(1, j / 120, (out.length - 1 - j) / 480);
    }
    if (out.length < 12000) throw new Error(`Unexpectedly short clip: ${lines[n].id}`);
    const bytes = wav(out, 24000), relative = `${identity}/${lines[n].id}.wav`;
    fs.writeFileSync(path.join(outputRoot, relative), bytes);
    clips[lines[n].id] = relative;
    records.push({ id: lines[n].id, identity, text: lines[n].text, file: relative, duration: out.length / 24000,
      masterStart: start / 48000, masterEnd: end / 48000, masterSha256: hash(original), sha256: hash(bytes), gain });
  }
}
fs.writeFileSync(path.join(outputRoot, 'manifest.json'), JSON.stringify({ version: 1, clips }, null, 2) + '\n');
fs.writeFileSync('audio-staging/voices/level1-clips.json', JSON.stringify({
  format: 'mono PCM16 WAV, 24 kHz', masters: 'unaltered stereo PCM16 WAV, 48 kHz',
  preparation: 'Authored silence boundaries, mono downmix, per-identity bounded gain, lowpass decimation, short edge fades',
  listeningReview: 'Pending in-game listening acceptance; no automatic retakes authorized', clips: records,
}, null, 2) + '\n');
console.log(JSON.stringify({ clips: records.length, durationSeconds: records.reduce((sum, r) => sum + r.duration, 0),
  bytes: records.reduce((sum, r) => sum + fs.statSync(path.join(outputRoot, r.file)).size, 0) }));
