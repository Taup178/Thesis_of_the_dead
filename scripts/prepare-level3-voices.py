"""Process the generated per-line WAVs in Higgsfield's media sandbox. No generation calls.

Run from a directory containing level3-input.json and level3-results.json.
Produces level3-voices.zip with game audio, original masters and provenance.
"""
import array
import hashlib
import json
import math
import pathlib
import subprocess
import urllib.request
import zipfile

ROOT = pathlib.Path.cwd()
DATA = json.loads((ROOT / 'level3-input.json').read_text())
JOBS = {job['index']: job for job in json.loads((ROOT / 'level3-results.json').read_text())}
PROFILES = {
    'tormentor': (-0.5, 0.28, 0.20, 0.28, 1700),
    'anxious': (0.55, 0.17, 0.13, 0.25, 2100),
    'manipulator': (0.25, 0.34, 0.23, 0.30, 1400),
    'protector': (0.05, 0.24, 0.06, 0.20, 2300),
}

def pan(value):
    angle = (value + 1) * math.pi / 4
    return f'pan=stereo|c0={math.cos(angle):.7f}*c0|c1={math.sin(angle):.7f}*c0'

output = ROOT / 'prepared-level3'
game = output / 'public/assets/audio/voices/level3'
masters = output / 'audio-staging/voices/masters/level3'
game.mkdir(parents=True, exist_ok=True)
masters.mkdir(parents=True, exist_ok=True)
records, clips = [], {}
lines = [line for cue in DATA['cues'] for line in cue['lines']]
for index, line in enumerate(lines):
    job = JOBS[index]
    if job['status'] != 'completed' or not job.get('result_url'):
        raise ValueError(f'Incomplete generation {index}')
    master = masters / f'{line["id"]}.wav'
    if not master.exists(): urllib.request.urlretrieve(job['result_url'], master)
    raw = master.read_bytes()
    pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(master), '-f', 's16le', '-ac', '1', '-ar', '48000', '-'])
    samples = array.array('h', pcm)
    frames = [max(abs(x) for x in samples[i:i + 960]) / 32768 for i in range(0, len(samples), 960)]
    audible = [i for i, peak in enumerate(frames) if peak > 0.008]
    if not audible: raise ValueError(f'Silent generation {line["id"]}')
    start = max(0, audible[0] * 0.02 - 0.08)
    end = min(len(samples) / 48000, (audible[-1] + 1) * 0.02 + 0.12)
    duration = end - start
    speech = samples[round(start * 48000):round(end * 48000)]
    rms = math.sqrt(sum((x / 32768) ** 2 for x in speech) / len(speech))
    peak = max(abs(x) for x in speech) / 32768
    gain = min(8, 0.11 / max(rms, 0.001), 0.82 / max(peak, 0.001))
    position, delay, wet, decay, cutoff = PROFILES[line['identity']]
    tail = delay * 2
    graph = (
        f'[0:a]aformat=channel_layouts=mono,highpass=f=85,lowpass=f=10500,volume={gain},asplit=3[d][a][b];'
        f'[d]{pan(position)}[dry];'
        f'[a]highpass=f=260,lowpass=f={cutoff},volume={wet},adelay={round(delay * 1000)}:all=1,{pan(-position * 0.9)}[echo1];'
        f'[b]highpass=f=340,lowpass=f={cutoff / 1.35},volume={wet * decay},adelay={round(tail * 1000)}:all=1,{pan(position * 0.5)}[echo2];'
        '[dry][echo1][echo2]amix=inputs=3:duration=longest:normalize=0,aresample=44100,earwax,alimiter=limit=0.85:level=0,'
        f'afade=t=in:st=0:d=0.01,afade=t=out:st={max(0, duration + tail - 0.08)}:d=0.08[out]'
    )
    relative = f'{line["identity"]}/{line["id"]}.ogg'
    target = game / relative; target.parent.mkdir(exist_ok=True)
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(start), '-t', str(duration),
                    '-i', str(master), '-filter_complex', graph, '-map', '[out]', '-ar', '48000', '-c:a', 'libvorbis', '-q:a', '4', str(target)], check=True)
    info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(target)], text=True))
    if info['streams'][0]['channels'] != 2: raise ValueError('Spatial file must be stereo')
    clips[line['id']] = {'file': relative, 'effectsBaked': True, 'speechDuration': duration}
    records.append({**line, 'job_id': job['job_id'], 'file': relative, 'duration': float(info['format']['duration']),
                    'speechDuration': duration, 'masterStart': start, 'masterEnd': end, 'masterSha256': hashlib.sha256(raw).hexdigest(),
                    'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'gain': gain})
    print(f'Prepared {index + 1}/{len(lines)}: {line["id"]} ({duration:.2f}s)', flush=True)
(game / 'manifest.json').write_text(json.dumps({'version': 1, 'clips': clips}, indent=2) + '\n')
provenance = output / 'audio-staging/voices/level3-clips.json'
provenance.write_text(json.dumps({'provider': 'Higgsfield', 'model': 'seed_audio',
    'processing': 'Higgsfield sandbox FFmpeg; stereo placement, dark cross-ear echoes, headphone enhancement, level balancing, limiting, edge fades',
    'format': '48 kHz stereo Ogg Vorbis, quality 4', 'listeningReview': 'Subjective headphone acceptance pending', 'clips': records}, indent=2) + '\n')
archive = ROOT / 'level3-voices.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as package:
    for file in output.rglob('*'):
        if file.is_file(): package.write(file, file.relative_to(output))
print(json.dumps({'clips': len(clips), 'gameBytes': sum((game / clip['file']).stat().st_size for clip in clips.values()),
                  'archive': str(archive), 'archiveBytes': archive.stat().st_size}))
