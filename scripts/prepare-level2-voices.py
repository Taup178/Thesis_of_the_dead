"""Run in Higgsfield's media sandbox. No generation calls or retakes.

Inputs: level2-input.json and the four original WAV packs in the working directory.
Output: level2-voices.zip, containing the game assets, masters and provenance.
"""
import hashlib
import json
import math
import pathlib
import struct
import subprocess
import wave
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
DATA = json.loads((ROOT / 'level2-input.json').read_text())
RANGES = {
    'tormentor': [(0.38, 2.68), (3.22, 5.25), (5.90, 7.95), (11.85, 13.32)],
    'anxious': [(0.0, 2.5), (4.24, 7.2), (8.17, 9.54), (10.20, 11.85)],
    # An unsolicited extra phrase after the callback is excluded, without a paid retake.
    'manipulator': [(0.30, 2.04), (4.53, 7.37), (8.15, 12.5)],
    'protector': [(0.16, 3.15), (3.8, 6.55), (7.45, 11.6), (12.3, 15.08),
                  (16.12, 19.56), (20.0, 21.5), (22.29, 24.02), (24.62, 28.08),
                  (28.52, 29.66), (30.61, 33.41), (34.28, 36.4)],
}
PROFILES = {
    'tormentor': {'pan': -0.5, 'delay': 0.28, 'wet': 0.20, 'decay': 0.28, 'cutoff': 1700},
    'anxious': {'pan': 0.55, 'delay': 0.17, 'wet': 0.13, 'decay': 0.25, 'cutoff': 2100},
    'manipulator': {'pan': 0.25, 'delay': 0.34, 'wet': 0.23, 'decay': 0.30, 'cutoff': 1400},
    'protector': {'pan': 0.05, 'delay': 0.24, 'wet': 0.06, 'decay': 0.20, 'cutoff': 2300},
}

def pan(value):
    angle = (value + 1) * math.pi / 4
    return f'pan=stereo|c0={math.cos(angle):.7f}*c0|c1={math.sin(angle):.7f}*c0'

output = ROOT / 'prepared'
game = output / 'public/assets/audio/voices/level2'
masters = output / 'audio-staging/voices/masters/level2'
game.mkdir(parents=True, exist_ok=True)
masters.mkdir(parents=True, exist_ok=True)
records, clips = [], {}
for pack in DATA['packs']:
    identity = pack['identity']
    master = ROOT / f'{identity}.wav'
    raw = master.read_bytes()
    (masters / master.name).write_bytes(raw)
    with wave.open(str(master), 'rb') as wav:
        if wav.getsampwidth() != 2 or wav.getnchannels() != 2:
            raise ValueError('Expected stereo PCM16 WAV master')
        pcm = wav.readframes(wav.getnframes())
    samples = struct.unpack('<' + 'h' * (len(pcm) // 2), pcm)
    peak = max(abs(x) for x in samples) / 32768
    rms = math.sqrt(sum((x / 32768) ** 2 for x in samples) / len(samples))
    gain = min(2, 0.095 / max(rms, 0.001), 0.8 / max(peak, 0.001))
    profile = PROFILES[identity]
    lines = [line for cue in DATA['cues'] for line in cue['lines'] if line['identity'] == identity]
    if len(lines) != len(RANGES[identity]):
        raise ValueError('Script and authored ranges disagree')
    folder = game / identity
    folder.mkdir(exist_ok=True)
    for line, (start, end) in zip(lines, RANGES[identity]):
        duration = end - start
        tail = profile['delay'] * 2
        graph = (
            f'[0:a]pan=mono|c0=0.5*c0+0.5*c1,highpass=f=85,lowpass=f=10500,volume={gain},asplit=3[d][a][b];'
            f'[d]{pan(profile["pan"])}[dry];'
            f'[a]highpass=f=260,lowpass=f={profile["cutoff"]},volume={profile["wet"]},'
            f'adelay={round(profile["delay"] * 1000)}:all=1,{pan(-profile["pan"] * 0.9)}[echo1];'
            f'[b]highpass=f=340,lowpass=f={profile["cutoff"] / 1.35},volume={profile["wet"] * profile["decay"]},'
            f'adelay={round(tail * 1000)}:all=1,{pan(profile["pan"] * 0.5)}[echo2];'
            '[dry][echo1][echo2]amix=inputs=3:duration=longest:normalize=0,'
            'aresample=44100,earwax,alimiter=limit=0.85:level=0,'
            f'afade=t=in:st=0:d=0.01,afade=t=out:st={duration + tail - 0.08}:d=0.08[out]'
        )
        relative = f'{identity}/{line["id"]}.ogg'
        target = game / relative
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                        '-ss', str(start), '-t', str(duration), '-i', str(master),
                        '-filter_complex', graph, '-map', '[out]', '-ar', '48000',
                        '-c:a', 'libvorbis', '-q:a', '4', str(target)], check=True)
        info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format',
                          '-show_streams', '-of', 'json', str(target)], text=True))
        if info['streams'][0]['channels'] != 2:
            raise ValueError('Baked spatial audio must remain stereo')
        clips[line['id']] = {'file': relative, 'effectsBaked': True, 'speechDuration': duration}
        records.append({'id': line['id'], 'identity': identity, 'text': line['text'],
                        'file': relative, 'duration': float(info['format']['duration']),
                        'speechDuration': duration, 'masterStart': start, 'masterEnd': end,
                        'masterSha256': hashlib.sha256(raw).hexdigest(),
                        'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                        'profile': profile, 'packGain': gain})
(game / 'manifest.json').write_text(json.dumps({'version': 1, 'clips': clips}, indent=2) + '\n')
provenance = output / 'audio-staging/voices/level2-clips.json'
provenance.write_text(json.dumps({'processing': 'Higgsfield sandbox FFmpeg; stereo placement, dark cross-ear echoes, earwax stereo enhancement, limiting and edge fades',
    'format': '48 kHz stereo Ogg Vorbis, quality 4',
    'spatialNote': 'Stereo headphone enhancement; not personalized measured binaural capture',
    'alignment': 'Authored cuts checked against offline ASR word timestamps and silence intervals',
    'excluded': 'Unsolicited fragment at 2.1-4.5 seconds in the manipulator master',
    'listeningReview': 'Subjective in-game headphone acceptance pending', 'clips': records}, indent=2) + '\n')
if (ROOT / 'alignment.json').exists():
    (output / 'audio-staging/voices/level2-alignment.json').write_bytes((ROOT / 'alignment.json').read_bytes())
archive = ROOT / 'level2-voices.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as package:
    for file in output.rglob('*'):
        if file.is_file(): package.write(file, file.relative_to(output))
print(json.dumps({'clips': len(clips), 'gameBytes': sum((game / clip['file']).stat().st_size for clip in clips.values()),
                  'archive': str(archive), 'archiveBytes': archive.stat().st_size}))
