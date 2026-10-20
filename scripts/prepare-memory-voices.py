"""Prepare the approved two-line memory pack in Higgsfield's media sandbox."""
import hashlib,json,math,pathlib,subprocess,zipfile
root=pathlib.Path('/home/user/thesis_memory')
out=root/'prepared'
game=out/'public/assets/audio/voices/level2/manipulator'
game.mkdir(parents=True,exist_ok=True)
master=root/'master.wav'
masterdir=out/'audio-staging/voices/masters/level2'
masterdir.mkdir(parents=True,exist_ok=True)
(masterdir/'memory-directions.wav').write_bytes(master.read_bytes())
def pan(value):
    angle=(value+1)*math.pi/4
    return f'pan=stereo|c0={math.cos(angle)}*c0|c1={math.sin(angle)}*c0'
clips={}
records=[]
for direction,start,end in [('left',0,3.12),('right',3.28,5.50)]:
    duration=end-start
    graph=(
        '[0:a]pan=mono|c0=0.5*c0+0.5*c1,highpass=f=85,lowpass=f=10500,asplit=3[d][a][b];'
        f'[d]{pan(.25)}[dry];'
        f'[a]highpass=f=260,lowpass=f=1400,volume=0.23,adelay=340:all=1,{pan(-.225)}[e1];'
        f'[b]highpass=f=340,lowpass=f=1037,volume=0.069,adelay=680:all=1,{pan(.125)}[e2];'
        '[dry][e1][e2]amix=inputs=3:duration=longest:normalize=0,aresample=44100,earwax,'
        'loudnorm=I=-18:TP=-3:LRA=7,'
        f'afade=t=in:d=0.01,afade=t=out:st={duration+.60}:d=0.08[out]')
    name=f'l2_manipulator_{direction}'
    target=game/f'{name}.ogg'
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss',str(start),'-t',str(duration),'-i',str(master),
        '-filter_complex',graph,'-map','[out]','-ar','48000','-c:a','libvorbis','-q:a','4',str(target)],check=True)
    clips[name]={'file':f'manipulator/{name}.ogg','effectsBaked':True,'speechDuration':duration}
    records.append({'id':name,'text':f'Go {direction}. Trust me.','start':start,'end':end,
        'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
receipt={'job_id':'e7aaf727-bf40-4988-8665-e4eb10613535','credits':.3,'voice':'Faye',
    'masterSha256':hashlib.sha256(master.read_bytes()).hexdigest(),
    'processing':'stereo placement; dark cross-ear fading repetitions; earwax; -18 LUFS / -3 dBTP loudnorm; edge fades',
    'alignment':'tiny.en offline word timestamps','clips':records,'manifestClips':clips}
(out/'audio-staging/voices/level2-memory-results.json').write_text(json.dumps(receipt,indent=2)+'\n')
archive=root/'memory-voices.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as package:
    for file in out.rglob('*'):
        if file.is_file(): package.write(file,file.relative_to(out))
print(json.dumps(receipt))
