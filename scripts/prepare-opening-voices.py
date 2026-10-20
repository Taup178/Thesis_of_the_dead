"""Prepare approved opening speech in Higgsfield's media sandbox, without generation."""
import hashlib,json,math,pathlib,re,subprocess,sys,zipfile
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/home/user/thesis_opening')
data=json.loads((root/'opening-input.json').read_text())
out=root/'prepared'
game=out/'public/assets/audio/voices/opening'
provenance=out/'audio-staging/voices'
masters=provenance/'masters/opening'
masters.mkdir(parents=True,exist_ok=True)
# Boundaries checked against word timestamps and actual silent intervals.
# Only excess silence is omitted; consonants and breaths are retained.
cuts={
 'opening_manipulator_01':[(.35,1.90),(3.34,5.12)],
 'opening_manipulator_02':[(5.88,7.03),(7.60,9.82)],
 'opening_anxious_01':[(.38,1.43),(1.81,3.58)],
 'opening_anxious_02':[(4.08,5.60)],
 'opening_tormentor_01':[(.26,3.0)],
 'opening_protector_01':[(.20,1.06),(1.60,2.70),(3.48,4.42)],
}
profiles={'tormentor':(-.5,.28,.20,.28,1700),'anxious':(.55,.17,.13,.25,2100),
 'manipulator':(.25,.34,.23,.30,1400),'protector':(.05,.24,.06,.20,2300)}
def pan(v):
 a=(v+1)*math.pi/4
 return f'pan=stereo|c0={math.cos(a)}*c0|c1={math.sin(a)}*c0'
clips={};records=[]
for pack in data['packs']:
 identity=pack['identity'];master=root/(identity+'.wav')
 (masters/master.name).write_bytes(master.read_bytes())
 folder=game/identity;folder.mkdir(parents=True,exist_ok=True)
 p,delay,wet,decay,cutoff=profiles[identity]
 for line in pack['lines']:
  ranges=cuts[line['id']];duration=sum(end-start for start,end in ranges)
  count=len(ranges)
  graph='[0:a]asplit='+str(count)+''.join(f'[s{i}]' for i in range(count))+';'
  for i,(start,end) in enumerate(ranges):
   graph+=f'[s{i}]atrim=start={start}:end={end},asetpts=PTS-STARTPTS[c{i}];'
  graph+=''.join(f'[c{i}]' for i in range(count))+f'concat=n={count}:v=0:a=1[compact];'
  graph+=(
   '[compact]pan=mono|c0=0.5*c0+0.5*c1,highpass=f=85,lowpass=f=10500,asplit=3[d][a][b];'
   +f'[d]{pan(p)}[dry];[a]highpass=f=260,lowpass=f={cutoff},volume={wet},adelay={round(delay*1000)}:all=1,{pan(-p*.9)}[e1];'
   +f'[b]highpass=f=340,lowpass=f={cutoff/1.35},volume={wet*decay},adelay={round(delay*2000)}:all=1,{pan(p*.5)}[e2];'
   +'[dry][e1][e2]amix=inputs=3:duration=longest:normalize=0,aresample=44100,earwax,loudnorm=I=-18:TP=-3:LRA=7,'
   +f'afade=t=in:d=0.01,afade=t=out:st={duration+2*delay-.08}:d=0.08[out]')
  relative=identity+'/'+line['id']+'.ogg';target=game/relative
  processed=root/(line['id']+'-effected.wav')
  subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(master),
    '-filter_complex',graph,'-map','[out]','-ar','48000','-c:a','pcm_s24le',str(processed)],check=True)
  levels=subprocess.run(['ffmpeg','-hide_banner','-i',str(processed),'-af','volumedetect','-f','null','-'],capture_output=True,text=True,check=True).stderr
  mean=float(re.search(r'mean_volume: ([-0-9.]+)',levels)[1])
  peak=float(re.search(r'max_volume: ([-0-9.]+)',levels)[1])
  # LUFS integration can fail on a very short utterance. Restore its peak safely
  # before the sole lossy encode, while preserving its stereo/echo proportions.
  correction=min(16,10**((-3.5-peak)/20)) if mean < -28 else 1
  subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(processed),
    '-af',f'volume={correction},alimiter=limit=0.707946:level=0',
    '-ar','48000','-c:a','libvorbis','-q:a','4',str(target)],check=True)
  info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(target)],text=True))
  stream=info['streams'][0]
  if stream['channels']!=2 or stream['sample_rate']!='48000': raise ValueError('Invalid game audio format')
  levels=subprocess.run(['ffmpeg','-hide_banner','-i',str(target),'-af','volumedetect','-f','null','-'],capture_output=True,text=True,check=True).stderr
  clips[line['id']]={'file':relative,'effectsBaked':True,'speechDuration':round(duration,4)}
  records.append({'id':line['id'],'identity':identity,'text':line['text'],'sourceRanges':ranges,
    'speechDuration':round(duration,4),'fileDuration':float(info['format']['duration']),
    'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
    'masterSha256':hashlib.sha256(master.read_bytes()).hexdigest(),
    'shortClipGain':correction,'meanDb':float(re.search(r'mean_volume: ([-0-9.]+)',levels)[1]),
    'peakDb':float(re.search(r'max_volume: ([-0-9.]+)',levels)[1])})
(game/'manifest.json').write_text(json.dumps({'version':1,'clips':clips},indent=2)+'\n')
result={**data,'status':'completed','chargedCredits':1.4,'balanceAfter':86.1,
 'processing':'Original approved voices; edited long silent gaps; stereo placement; dark fading cross-ear repetitions; earwax; -18 LUFS / -3 dBTP mastering; edge fades',
 'alignment':'Offline tiny.en word timestamps plus FFmpeg silence detection',
 'listeningReview':'In-game subjective headphone acceptance remains with the user',
 'clips':records}
(provenance/'opening-results.json').write_text(json.dumps(result,indent=2)+'\n')
(provenance/'opening-alignment.json').write_bytes((root/'opening-alignment.json').read_bytes())
(provenance/'opening-input.json').write_bytes((root/'opening-input.json').read_bytes())
with zipfile.ZipFile(root/'opening-voices.zip','w',zipfile.ZIP_DEFLATED) as package:
 for file in out.rglob('*'):
  if file.is_file():package.write(file,file.relative_to(out))
print(json.dumps({'clips':records,'gameBytes':sum((game/c['file']).stat().st_size for c in clips.values()),
 'archiveBytes':(root/'opening-voices.zip').stat().st_size}))
