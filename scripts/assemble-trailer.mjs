import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve('production/trailer'), edit = join(root, 'edit');
const ffmpeg = join(root, 'tools/ffmpeg.exe'), ffprobe = join(root, 'tools/ffprobe.exe');
mkdirSync(edit, { recursive: true });
const fps = 60, duration = 88;
const font = 'public/assets/ui/fonts/IMFeENsc28P.ttf';
const posix = p => p.replaceAll('\\', '/');
const run = args => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
const probe = file => JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8', windowsHide: true }));
const raw = name => `local-capture/${name}.mp4`;
const cuts = [
  [0, 3, raw('opening_scene'), 0],
  [3, 11, 'ai/shot-1.mp4', 0],
  [11, 13.8, null, ['Shaun is experiencing', 'a psychological episode.']],
  [13.8, 15.85, raw('forest_run'), 1],
  [15.85, 19, raw('forest_credit'), 0],
  [19, 20.4, raw('forest_credit'), 3.15],
  [20.4, 23.2, raw('forest_run'), 0],
  [23.2, 24.2, raw('forest_combat'), 0],
  [24.2, 27.2, raw('forest_combat'), 1],
  [27.2, 29.4, raw('forest_sword'), 0],
  [29.4, 31.85, null, ['EVERY CREDIT HAS A COST.']],
  [31.85, 36.85, 'ai/shot-3.mp4', 0],
  [36.85, 39.85, raw('dungeon_saws'), 0],
  [39.85, 43.35, raw('dungeon_bridge'), 0],
  [43.35, 45.8, raw('dungeon_spikes'), 0.3],
  [45.8, 48.2, null, ['REMEMBER THE WAY.', 'BEFORE IT DISAPPEARS.']],
  [48.2, 51.2, raw('dungeon_memory'), 3],
  [51.2, 54.2, raw('dungeon_memory_run'), 0],
  [54.2, 58.2, raw('dungeon_ambush'), 0.5],
  [58.2, 63.45, raw('desert_house'), 0.25],
  [63.45, 65.85, raw('dean_intro'), 0.5],
  [65.85, 69.05, 'ai/shot-4.mp4', 2],
  [69.05, 77.05, raw('dean_combat'), 0],
  [77.05, 77.53333333333333, raw('forest_sword'), 0.7],
  [77.53333333333333, 78, raw('dungeon_saws'), 1.2],
  [78, 80.8, null, ['HOW MUCH OF YOURSELF', 'WILL YOU LEAVE BEHIND?']],
  [80.8, 81.85, null, []],
  [81.85, 88, null, ['THESIS OF THE DEAD'], 'title'],
].map(([start, end, source, inPoint, kind], index) => ({ index, start, end, source,
  inPoint: source ? inPoint : 0, lines: source ? [] : inPoint, kind: kind || (source ? 'picture' : 'card'),
  frames: Math.round(end * fps) - Math.round(start * fps) }));
for (let i = 0; i < cuts.length; i++) {
  if (i && Math.abs(cuts[i].start - cuts[i - 1].end) > 1e-6) throw Error('Timeline gap');
  if (cuts[i].source && !existsSync(join(root, cuts[i].source))) throw Error(`Missing ${cuts[i].source}`);
}
if (cuts.reduce((n, s) => n + s.frames, 0) !== duration * fps) throw Error('Wrong timeline duration');
writeFileSync(join(root, 'edit-decision-list.json'), JSON.stringify({ duration, fps,
  note: 'Native 60 FPS gameplay; Seedance remains naturally 24 FPS on a 60 FPS timeline. Trimmed selections avoid visual drift; no optical-flow interpolation.', cuts }, null, 2));

async function picture() {
  const list = [];
  for (const cut of cuts) {
    const seconds = cut.frames / fps, name = `segment-${String(cut.index).padStart(2, '0')}`;
    const output = join(edit, name + '.mp4');
    let filters = [];
    const inputs = cut.source ? ['-ss', String(cut.inPoint), '-i', join(root, cut.source)] :
      ['-f', 'lavfi', '-i', `color=c=0x07090a:s=1920x1080:r=${fps}:d=${seconds}`];
    if (cut.source) filters.push(`trim=duration=${seconds}`, 'setpts=PTS-STARTPTS', `fps=${fps}`,
      'eq=contrast=1.025:brightness=-0.008:saturation=0.92');
    else {
      filters.push('noise=alls=2:allf=t+u');
      for (let line = 0; line < cut.lines.length; line++) {
        const file = `production/trailer/edit/${name}-line-${line}.txt`;
        writeFileSync(file, cut.lines[line]);
        const offset = (line - (cut.lines.length - 1) / 2) * 90;
        filters.push(`drawtext=fontfile=${font}:textfile=${file}:fontcolor=0xe9dfcd:fontsize=${cut.kind === 'title' ? 148 : 64}:x=(w-tw)/2:y=(h-th)/2+${offset}:shadowcolor=black@0.4:shadowx=1:shadowy=2`);
      }
      if (cut.lines.length) filters.push('fade=t=in:st=0:d=0.18', `fade=t=out:st=${seconds - (cut.kind === 'title' ? 0.85 : 0.18)}:d=${cut.kind === 'title' ? 0.85 : 0.18}`);
    }
    if (cut.index === 0) filters.push('fade=t=in:st=0:d=0.45');
    if (cut.index === 1 || cut.index === 3) filters.push(`drawtext=fontfile=${font}:text='${cut.index === 1 ? 'CINEMATIC SEQUENCE' : 'IN-ENGINE GAMEPLAY'}':fontsize=24:fontcolor=white@0.55:x=64:y=h-60:enable='between(t,0.2,1.8)'`);
    filters.push('setsar=1', 'format=yuv420p');
    const sourceStat = cut.source ? statSync(join(root, cut.source)) : null;
    const fingerprint = createHash('sha256').update(JSON.stringify({ cut, filters, version: 1,
      sourceSize: sourceStat?.size, sourceModified: sourceStat?.mtimeMs })).digest('hex');
    const stamp = output + '.sha256';
    if (!existsSync(output) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== fingerprint) {
      console.log(`Picture ${cut.index + 1}/${cuts.length}: ${cut.source || cut.lines.join(' / ') || 'black'}`);
      run([...inputs, '-an', '-vf', filters.join(','), '-frames:v', String(cut.frames), '-c:v', 'libx264',
        '-preset', 'medium', '-crf', '15', '-threads', '8', '-profile:v', 'high', '-level:v', '4.2',
        '-g', '120', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', output]);
      writeFileSync(stamp, fingerprint);
    }
    const actual = probe(output).streams.find(s => s.codec_type === 'video');
    if (Number(actual.nb_frames) !== cut.frames) throw Error(`Segment ${cut.index} has ${actual.nb_frames}, expected ${cut.frames} frames`);
    list.push(`file '${posix(output)}'`);
  }
  writeFileSync(join(edit, 'picture.ffconcat'), list.join('\n') + '\n');
}

const selected = JSON.parse(readFileSync(join(root, 'audio-selection.json'), 'utf8')).clips;
const cues = [
  [0.25, 'opening_protector_01', 'Shaun. Listen to me. Get up.'],
  [11.55, 'opening_manipulator_01', 'You have to reach it. Before he does.'],
  [24.5, 'l1_tormentor_02', 'Every credit asks for something back.'],
  [40, 'l1_anxious_02', 'Too close. Too close.'],
  [45.9, 'l2_protector_02', 'Let your eyes settle before your feet move.'],
  [54.5, 'l2_anxious_03', "They're climbing out!"],
  [63.5, 'l3_tormentor_boss_intro', 'There he is. Still holding what you came for.'],
  [74.1, 'opening_tormentor_01', 'This is your last chance. Do you understand?'],
].map(([at, id, text]) => ({ at, id, text, ...selected.find(c => c.id === id) }));

function voices() {
  const inputs = ['-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${duration}`], graph = [], outputs = ['[0:a]'];
  cues.forEach((cue, i) => {
    const clipGraph = [];
    let chain = '[0:a]asetpts=PTS-STARTPTS,aresample=48000,highpass=f=65,acompressor=threshold=0.12:ratio=2:attack=8:release=90,loudnorm=I=-18:TP=-3:LRA=7,aresample=48000';
    if (!cue.effectsBaked) {
      const anxious = cue.id.includes('anxious');
      const delay = anxious ? 170 : 280, wet = anxious ? 0.13 : 0.2;
      const decay = anxious ? 0.25 : 0.28, cutoff = anxious ? 2100 : 1700;
      clipGraph.push(chain + `,aformat=channel_layouts=mono,asplit=3[d${i}][e${i}a][e${i}b]`);
      const pan = anxious ? '0.46*c0|c1=0.888*c0' : '0.866*c0|c1=0.5*c0';
      clipGraph.push(`[d${i}]pan=stereo|c0=${pan}[pd${i}]`);
      clipGraph.push(`[e${i}a]lowpass=f=${cutoff},volume=${wet},adelay=${delay},pan=stereo|c0=${pan}[pe${i}a]`);
      clipGraph.push(`[e${i}b]lowpass=f=${cutoff / 1.35},volume=${wet * decay},adelay=${delay * 2},pan=stereo|c0=${pan}[pe${i}b]`);
      clipGraph.push(`[pd${i}][pe${i}a][pe${i}b]amix=inputs=3:normalize=0,asetpts=PTS-STARTPTS[clip]`);
    } else clipGraph.push(chain + ',aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[clip]');
    const clipFilter = join(edit, `voice-${i}.filter`), clipFile = join(edit, `voice-${i}.wav`);
    writeFileSync(clipFilter, clipGraph.join(';\n'));
    run(['-i', cue.file, '-/filter_complex', clipFilter, '-map', '[clip]', '-c:a', 'pcm_f32le', '-ar', '48000', '-ac', '2', clipFile]);
    const length = Number(probe(clipFile).format.duration);
    if (length < 0.5 || length > 12) throw Error(`Voice ${cue.id} rendered invalid length ${length}`);
    inputs.push('-i', clipFile);
    graph.push(`[${i + 1}:a]asetpts=PTS-STARTPTS,adelay=${Math.round(cue.at * 1000)}|${Math.round(cue.at * 1000)}[v${i}]`);
    outputs.push(`[v${i}]`);
  });
  graph.push(outputs.join('') + `amix=inputs=${outputs.length}:normalize=0:duration=first[voice]`);
  writeFileSync(join(edit, 'voices.filter'), graph.join(';\n'));
  run([...inputs, '-/filter_complex', join(edit, 'voices.filter'), '-map', '[voice]', '-c:a', 'pcm_f32le', '-ar', '48000', '-ac', '2', join(edit, 'voices.wav')]);
}

function effects() {
  const events = [];
  for (const cut of cuts) {
    if (!cut.source?.startsWith('local-capture/')) continue;
    const file = join(root, cut.source.replace('.mp4', '-telemetry.json'));
    const take = JSON.parse(readFileSync(file, 'utf8'));
    const takeEvents = Array.isArray(take.events) ? take.events : take.events ? [take.events] : [];
    for (const e of takeEvents) {
      if (e.time < cut.inPoint || e.time >= cut.inPoint + cut.frames / fps) continue;
      const at = cut.start + e.time - cut.inPoint;
      if (e.event === 'tile_collapse') events.push({ at, file: 'public/assets/audio/brick-wall-impact.mp3', volume: 0.3, pitch: 1, seconds: 2 });
      if (e.event !== 'sfx_trigger' || !/\/(weapon|player)\/|\/zombie\/(attack|hurt|death)/.test(e.source)) continue;
      const source = e.source.replace(/^\.\/assets\//, 'public/assets/');
      if (existsSync(source)) events.push({ at, file: source, volume: Math.min(0.6, e.volume ?? 0.5) * 0.6, pitch: e.pitch || 1, seconds: 2 });
    }
    if (take.name === 'desert_house') {
      let before = 0;
      for (const s of take.states) {
        if (s.housesDestroyed > before && s.time >= cut.inPoint && s.time < cut.inPoint + cut.frames / fps) events.push({
          at: cut.start + s.time - cut.inPoint, file: 'public/assets/audio/brick-wall-impact.mp3', volume: 0.48, pitch: 0.85, seconds: 2 });
        before = s.housesDestroyed;
      }
    }
  }
  // The actual in-game saw sound bridges the cinematic into the real roll.
  events.push({ at: 31.85, file: 'public/assets/audio/concrete-scrape-loop.mp3', volume: 0.13, pitch: 1, seconds: 8 });
  const files = [...new Set(events.map(e => e.file))], inputs = files.flatMap(file => ['-i', file]);
  const graph = [], outputs = [];
  files.forEach((file, input) => {
    const uses = events.map((e, i) => ({ ...e, i })).filter(e => e.file === file);
    graph.push(`[${input}:a]aresample=48000,aformat=channel_layouts=stereo,asplit=${uses.length}` + uses.map(e => `[s${e.i}]`).join(''));
    for (const e of uses) {
      const gain = e.volume;
      graph.push(`[s${e.i}]atrim=duration=${e.seconds},asetpts=PTS-STARTPTS,asetrate=${Math.round(48000 * e.pitch)},aresample=48000,volume=${gain},afade=t=in:d=0.003,afade=t=out:st=${Math.max(0.1, e.seconds / e.pitch - 0.12)}:d=0.12,adelay=${Math.round(e.at * 1000)}|${Math.round(e.at * 1000)}[f${e.i}]`);
      outputs.push(`[f${e.i}]`);
    }
  });
  const room = files.length;
  inputs.push('-f', 'lavfi', '-i', 'anoisesrc=color=pink:sample_rate=48000:amplitude=0.005:duration=11');
  graph.push(`[${room}:a]highpass=f=100,lowpass=f=2500,aformat=channel_layouts=stereo,afade=t=in:d=0.5,afade=t=out:st=9:d=2[room]`);
  outputs.push('[room]');
  const silence = files.length + 1;
  inputs.push('-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${duration}`);
  outputs.unshift(`[${silence}:a]`);
  graph.push(outputs.join('') + `amix=inputs=${outputs.length}:normalize=0:duration=first,acompressor=threshold=0.65:ratio=3:attack=3:release=100[fx]`);
  writeFileSync(join(edit, 'effects.filter'), graph.join(';\n'));
  writeFileSync(join(root, 'sound-events.json'), JSON.stringify(events, null, 2));
  run([...inputs, '-/filter_complex', join(edit, 'effects.filter'), '-map', '[fx]', '-c:a', 'pcm_f32le', '-ar', '48000', '-ac', '2', join(edit, 'effects.wav')]);
}

function mix() {
  const filter = [
    '[0:a]asplit=3[voice][key1][key2]',
    '[2:a]atrim=start=25:end=97,asetpts=PTS-STARTPTS,aresample=48000,afade=t=in:st=0:d=2.5,afade=t=out:st=71.65:d=0.35,volume=0.55,adelay=9000|9000[music]',
    '[music][key1]sidechaincompress=threshold=0.035:ratio=6:attack=25:release=380:makeup=1[ducked]',
    '[1:a][key2]sidechaincompress=threshold=0.04:ratio=3:attack=15:release=260[fxduck]',
    '[ducked][fxduck][voice]amix=inputs=3:normalize=0,atrim=duration=88[premix]',
  ].join(';\n');
  writeFileSync(join(edit, 'mix.filter'), filter);
  run(['-i', join(edit, 'voices.wav'), '-i', join(edit, 'effects.wav'), '-i', 'public/assets/audio/red-moon.mp3',
    '-/filter_complex', join(edit, 'mix.filter'), '-map', '[premix]', '-c:a', 'pcm_f32le', '-ar', '48000', '-ac', '2', join(edit, 'premix.wav')]);
  const measure = spawnSync(ffmpeg, ['-hide_banner', '-i', join(edit, 'premix.wav'), '-af', 'loudnorm=I=-15:TP=-1.5:LRA=9:print_format=json', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (measure.status) throw Error(measure.stderr);
  const match = measure.stderr.match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!match) throw Error('Missing loudness measurements');
  const m = JSON.parse(match[0]); writeFileSync(join(edit, 'loudness-first-pass.json'), JSON.stringify(m, null, 2));
  const normalize = `loudnorm=I=-15:TP=-1.5:LRA=9:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json`;
  run(['-i', join(edit, 'premix.wav'), '-af', normalize, '-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2', join(edit, 'final-mix.wav')]);
}

function subtitles() {
  const stamp = time => { const ms = Math.round(time * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  const text = cues.map((cue, i) => `${i + 1}\n${stamp(cue.at)} --> ${stamp(cue.at + (cue.speechDuration || Number(probe(cue.file).format.duration)))}\n${cue.text}\n`).join('\n');
  writeFileSync(join(root, 'Thesis-of-the-Dead-Reveal-Trailer.srt'), text);
}

if (process.argv.includes('--audio-probe')) {
  for (const filter of ['apad', 'atrim', 'loudnorm']) {
    const help = spawnSync(ffmpeg, ['-hide_banner', '-h', `filter=${filter}`], { encoding: 'utf8', windowsHide: true });
    console.log(help.stdout);
  }
  for (const name of ['voices.wav', 'effects.wav', 'premix.wav']) {
    const file = join(edit, name);
    const result = spawnSync(ffmpeg, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true });
    console.log(name, probe(file).format.duration, result.stderr.split('\n').filter(l => /mean_volume|max_volume/.test(l)).join('\n'));
  }
  for (const filter of ['anull', 'aresample=48000', 'loudnorm=I=-18:TP=-3:LRA=7,aresample=48000', 'apad=whole_dur=8,atrim=duration=8']) {
    const test = spawnSync(ffmpeg, ['-hide_banner', '-i', 'public/assets/audio/voices/opening/protector/opening_protector_01.ogg', '-af', filter, '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true });
    console.log(filter, test.stderr.split('\n').slice(-4).join('\n'));
  }
  process.exit(0);
}
console.log('Building 88-second reveal trailer; no generation jobs are performed by this script.');
await picture();
console.log('Building original voice and synchronized effects stems'); voices(); effects(); mix(); subtitles();
const final = join(root, 'Thesis-of-the-Dead-Reveal-Trailer.mp4');
run(['-f', 'concat', '-safe', '0', '-i', join(edit, 'picture.ffconcat'), '-i', join(edit, 'final-mix.wav'),
  '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000',
  '-t', String(duration), '-movflags', '+faststart', '-metadata', 'title=THESIS OF THE DEAD - Reveal Trailer', final]);
const result = probe(final); writeFileSync(join(root, 'export-probe.json'), JSON.stringify(result, null, 2));
run(['-ss', '83', '-i', final, '-frames:v', '1', join(root, 'Thesis-of-the-Dead-Title.png')]);
console.log(JSON.stringify({ final, seconds: result.format.duration, bytes: result.format.size,
  video: result.streams.find(s => s.codec_type === 'video'), audio: result.streams.find(s => s.codec_type === 'audio') }, null, 2));
