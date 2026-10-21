import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const root = resolve('production/trailer');
const ffmpeg = join(root, 'tools/ffmpeg.exe'), ffprobe = join(root, 'tools/ffprobe.exe');
const file = join(root, 'Thesis-of-the-Dead-Reveal-Trailer.mp4');
if (!existsSync(file)) throw Error('Final export does not exist');
const data = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8', windowsHide: true }));
const video = data.streams.find(s => s.codec_type === 'video'), audio = data.streams.find(s => s.codec_type === 'audio');
const checks = { dimensions: video.width === 1920 && video.height === 1080,
  cadence: video.r_frame_rate === '60/1', frames: Number(video.nb_frames) === 5280,
  duration: Math.abs(Number(data.format.duration) - 88) < 0.04,
  videoCodec: video.codec_name === 'h264', pixelFormat: ['yuv420p', 'yuvj420p'].includes(video.pix_fmt),
  stereoAudio: audio.codec_name === 'aac' && audio.channels === 2 && audio.sample_rate === '48000',
  fullAudio: Number(audio.duration) > 87.95 };
const decode = spawnSync(ffmpeg, ['-hide_banner', '-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
checks.fullDecode = decode.status === 0 && !decode.stderr.trim();
const measure = spawnSync(ffmpeg, ['-hide_banner', '-i', file, '-vn', '-af', 'loudnorm=I=-15:TP=-1.5:LRA=9:print_format=json', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
if (measure.status) throw Error(measure.stderr);
const loudness = JSON.parse(measure.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)[0]);
checks.loudness = Number(loudness.input_i) >= -16 && Number(loudness.input_i) <= -14;
checks.truePeak = Number(loudness.input_tp) <= -1;
const silence = spawnSync(ffmpeg, ['-hide_banner', '-i', file, '-vn', '-af', 'silencedetect=noise=-50dB:d=0.5', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
const silences = [...silence.stderr.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map(m => ({ start: Number(m[1]), end: Number(m[2]) }));
checks.noUnexpectedMusicDropout = !silences.some(s => s.start > 16 && s.end < 79 && s.end - s.start > 1);
const groups = [[0.6, 4, 9, 12, 14.5, 16.3, 19.7, 22, 26, 28, 30, 34],
  [37, 39, 41, 44, 46.7, 48.6, 50.7, 51.5, 53.5, 55, 57, 59],
  [60.5, 63.8, 65.4, 66.2, 68.7, 70, 73, 76, 79, 81.4, 83, 87]];
for (let group = 0; group < groups.length; group++) {
  const frames = [];
  for (let i = 0; i < groups[group].length; i++) {
    const image = join(root, 'edit', `qa-${group}-${i}.jpg`);
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(groups[group][i]), '-i', file,
      '-frames:v', '1', '-vf', `scale=480:270,drawtext=fontfile=public/assets/ui/fonts/IMFeENsc28P.ttf:text='${groups[group][i]}s':fontsize=20:fontcolor=white:shadowcolor=black:shadowx=1:shadowy=1:x=8:y=8`, image], { windowsHide: true });
    frames.push(image);
  }
  // Convert a deterministic numbered sequence into a native contact sheet.
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '1', '-i', join(root, 'edit', `qa-${group}-%d.jpg`),
    '-vf', 'tile=4x3', '-frames:v', '1', join(root, 'edit', `final-review-${group}.jpg`)], { windowsHide: true });
}
const report = { file, duration: data.format.duration, bytes: Number(data.format.size), checks, loudness, silences,
  music: { originalAsset: 'public/assets/audio/red-moon.mp3', sourceStartSeconds: 25, trailerEntrySeconds: 9 },
  sourceCadence: { actualGameplay: 'native 60 FPS', seedance: 'native 24 FPS preserved on 60 FPS editing timeline; no optical-flow interpolation' },
  note: 'Automated export checks plus contact sheets. These measurements do not substitute for a subjective listening review.' };
writeFileSync(join(root, 'quality-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (Object.values(checks).some(value => !value)) process.exitCode = 1;
