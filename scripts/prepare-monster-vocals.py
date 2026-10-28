"""Master the Higgsfield monster vocals in the remote media sandbox.
Run beside input.json and results.json; produces monster-vocals.zip.
No generation or paid API calls occur in this script.
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
PLAN = json.loads((ROOT / 'input.json').read_text())
JOBS = {j['index']: j for j in json.loads((ROOT / 'results.json').read_text())}
OUTPUT = ROOT / 'prepared'
GAME = OUTPUT / 'public/assets/audio/voices/monster'
MASTERS = OUTPUT / 'audio-staging/monster/masters'
GAME.mkdir(parents=True, exist_ok=True)
MASTERS.mkdir(parents=True, exist_ok=True)
records = []
def run(args):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)
def probe(path):
    return json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(path)]))
for index, clip in enumerate(PLAN['clips']):
    job = JOBS[index]
    if job['status'] != 'completed': raise ValueError('Missing completed clip')
    master = MASTERS / (clip['id'] + '.wav')
    urllib.request.urlretrieve(job['result_url'], master)
    pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(master), '-f', 's16le', '-ac', '1', '-ar', '48000', '-'])
    samples = array.array('h', pcm)
    blocks = [max(abs(x) for x in samples[i:i+960]) / 32768 for i in range(0, len(samples), 960)]
    audible = [i for i, peak in enumerate(blocks) if peak > 0.003]
    if not audible: raise ValueError('Silent generation: ' + clip['id'])
    start = max(0, audible[0] * .02 - .04)
    end = min(len(samples) / 48000, (audible[-1] + 1) * .02 + .1)
    length = end - start
    creature = clip['id'].startswith('growl') or clip['id'] in ['death', 'attack-roar']
    ratio = .72 if creature else .82
    wet = .48 if creature else .30
    graph = (
        '[0:a]aresample=48000,aformat=channel_layouts=mono,highpass=f=55,lowpass=f=7000,asplit=2[clear][body];'
        '[clear]volume=0.9[dry];'
        f'[body]asetrate={int(48000*ratio)},aresample=48000,atempo={1/ratio:.8f},lowpass=f=1100,volume={wet}[chest];'
        '[dry][chest]amix=inputs=2:normalize=0:duration=first,acrusher=bits=12:mix=0.10,'
        'acompressor=threshold=0.2:ratio=2.5:attack=6:release=100,'
        'loudnorm=I=-17:TP=-2.5:LRA=9,aresample=48000,'
        f'afade=t=in:d=0.008,afade=t=out:st={max(.05,length-.07):.6f}:d=0.07[out]'
    )
    target = GAME / (clip['id'] + '.ogg')
    run(['-ss', str(start), '-t', str(length), '-i', str(master), '-filter_complex', graph, '-map', '[out]',
         '-ar', '48000', '-ac', '1', '-c:a', 'libvorbis', '-q:a', '5', str(target)])
    info = probe(target)
    if info['streams'][0]['sample_rate'] != '48000': raise ValueError('Wrong audio rate')
    measured = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(target), '-af', 'volumedetect', '-f', 'null', '-'],
        capture_output=True, text=True, check=True)
    records.append({**clip, 'job_id':job['job_id'], 'model':'seed_audio', 'duration':float(info['format']['duration']),
        'file':target.name, 'sourceStart':start, 'sourceEnd':end,
        'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
        'masterSha256':hashlib.sha256(master.read_bytes()).hexdigest()})
    print(clip['id'], records[-1]['duration'], flush=True)
manifest = {'version':1, 'provider':'Higgsfield', 'model':'seed_audio', 'voice':PLAN['voice'],
    'quotedCredits':PLAN['quotedCredits'],
    'processing':'Source pitch -9, dry voice with time-aligned low throat layer, subtle saturation, -17 LUFS / -2.5 dBTP mastering, 48 kHz mono Vorbis quality 5.',
    'clips':{clip['id']:{'file':clip['file'],'duration':clip['duration'],'text':clip['text']} for clip in records}}
(GAME / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
provenance = OUTPUT / 'audio-staging/monster/clips.json'
provenance.write_text(json.dumps({'manifest':manifest,'clips':records},indent=2)+'\n')
for name in ['input.json','results.json']:
    (OUTPUT / 'audio-staging/monster' / name).write_bytes((ROOT / name).read_bytes())
order = ['growl-01','intro','taunt-01','taunt-02','taunt-03','rush','enrage','growl-02','attack-roar','death']
inputs = []
graph = []
for i, name in enumerate(order):
    inputs += ['-i',str(GAME/(name+'.ogg'))]
    graph.append(f'[{i}:a]apad=pad_dur=0.7,asetpts=PTS-STARTPTS[c{i}]')
graph.append(''.join(f'[c{i}]' for i in range(len(order)))+f'concat=n={len(order)}:v=0:a=1[out]')
preview = OUTPUT / 'audio-staging/monster/monster-voice-preview.mp3'
run([*inputs,'-filter_complex',';'.join(graph),'-map','[out]','-c:a','libmp3lame','-b:a','192k',str(preview)])
archive = ROOT / 'monster-vocals.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as package:
    for file in OUTPUT.rglob('*'):
        if file.is_file(): package.write(file,file.relative_to(OUTPUT))
print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'clips':len(records),'previewSeconds':probe(preview)['format']['duration']}))
