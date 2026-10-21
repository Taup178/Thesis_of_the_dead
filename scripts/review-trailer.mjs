import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve('production/trailer');
const ffmpeg = join(root, 'tools/ffmpeg.exe'), ffprobe = join(root, 'tools/ffprobe.exe');
const output = join(root, 'edit/reviews'); await mkdir(output, { recursive: true });
const report = [];
for (const folder of ['ai', 'local-capture']) {
  for (const name of await readdir(join(root, folder))) {
    if (!name.endsWith('.mp4')) continue;
    const file = join(root, folder, name);
    const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
    const video = probe.streams.find(s => s.codec_type === 'video');
    const frames = Number(video.nb_frames), picks = [0, Math.floor(frames / 3), Math.floor(frames * 2 / 3), frames - 2];
    const select = picks.map(n => `eq(n,${n})`).join('+');
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file,
      '-vf', `select='${select}',scale=480:270,tile=2x2,drawtext=fontfile=public/assets/ui/fonts/IMFeENsc28P.ttf:text='${folder} - ${name}':fontsize=24:fontcolor=white:shadowcolor=black:shadowx=2:shadowy=2:x=10:y=10`,
      '-frames:v', '1', join(output, `${folder}-${basename(name, '.mp4')}.jpg`)]);
    report.push({ file: `${folder}/${name}`, width: video.width, height: video.height,
      fps: video.r_frame_rate, frames, duration: Number(probe.format.duration),
      review: `edit/reviews/${folder}-${basename(name, '.mp4')}.jpg` });
  }
}
await writeFile(join(root, 'source-audit.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
