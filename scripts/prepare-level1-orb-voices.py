"""Prepare six new Level 1 recordings in Higgsfield's media sandbox; no generation calls."""
import hashlib,json,math,pathlib,subprocess,zipfile
root=pathlib.Path('/home/user/thesis_orbs')
out=root/'prepared'
game=out/'public/assets/audio/voices/level1'
masters=out/'audio-staging/voices/masters/level1'
masters.mkdir(parents=True,exist_ok=True)
receipt=json.loads("{\"quotedCredits\":1.6,\"packs\":[{\"identity\":\"protector\",\"voice_id\":\"1550321e-7f5b-526e-b001-02328b03e9bc\",\"lines\":[{\"id\":\"l1_protector_orb1\",\"text\":\"One credit, Shaun. Keep going.\"},{\"id\":\"l1_protector_orb5\",\"text\":\"Five. You are making progress.\"},{\"id\":\"l1_protector_orb8\",\"text\":\"Eight. You earned your way here.\"}],\"params\":{\"model\":\"seed_audio\",\"prompt\":\"One credit, Shaun. Keep going.\\n\\nFive. You are making progress.\\n\\nEight. You earned your way here.\",\"voice_id\":\"1550321e-7f5b-526e-b001-02328b03e9bc\",\"voice_type\":\"preset\",\"format\":\"wav\",\"sample_rate\":48000,\"count\":1,\"use_unlim\":false},\"index\":0,\"job_id\":\"92a0039b-3064-4edc-bb25-874c3341c894\",\"status\":\"completed\",\"result_url\":\"https://d8j0ntlcm91z4.cloudfront.net/user_38qXahK1Cv75h1IHtiKQuHQP38f/hf_20261020_160213_92a0039b-3064-4edc-bb25-874c3341c894.wav\"},{\"identity\":\"manipulator\",\"voice_id\":\"d198dc0b-c4e5-5198-aa1d-ecf5ca0927c4\",\"lines\":[{\"id\":\"l1_manipulator_orb3\",\"text\":\"Three already. Surely that is enough.\"},{\"id\":\"l1_manipulator_orb7\",\"text\":\"One more. Then perhaps he will let you rest.\"}],\"params\":{\"model\":\"seed_audio\",\"prompt\":\"Three already. Surely that is enough.\\n\\nOne more. Then perhaps he will let you rest.\",\"voice_id\":\"d198dc0b-c4e5-5198-aa1d-ecf5ca0927c4\",\"voice_type\":\"preset\",\"format\":\"wav\",\"sample_rate\":48000,\"count\":1,\"use_unlim\":false},\"index\":1,\"job_id\":\"8a76eaa3-c5da-4b6d-b51e-329d6d26550d\",\"status\":\"completed\",\"result_url\":\"https://d8j0ntlcm91z4.cloudfront.net/user_38qXahK1Cv75h1IHtiKQuHQP38f/hf_20261020_160213_8a76eaa3-c5da-4b6d-b51e-329d6d26550d.wav\"},{\"identity\":\"anxious\",\"voice_id\":\"a00bc7f3-0236-5e76-ac65-90137ce0f5a4\",\"lines\":[{\"id\":\"l1_anxious_boss\",\"text\":\"Shaun. The portal. He is coming through.\"}],\"params\":{\"model\":\"seed_audio\",\"prompt\":\"Shaun. The portal. He is coming through.\",\"voice_id\":\"a00bc7f3-0236-5e76-ac65-90137ce0f5a4\",\"voice_type\":\"preset\",\"format\":\"wav\",\"sample_rate\":48000,\"count\":1,\"use_unlim\":false},\"index\":2,\"job_id\":\"05881e51-8236-43b5-86d9-f38d3e9afa9b\",\"status\":\"completed\",\"result_url\":\"https://d8j0ntlcm91z4.cloudfront.net/user_38qXahK1Cv75h1IHtiKQuHQP38f/hf_20261020_160214_05881e51-8236-43b5-86d9-f38d3e9afa9b.wav\"}]}")
ranges={'protector':[(0,3.75),(4.32,7.70),(8.34,11.68)],'manipulator':[(0,3.48),(3.94,7.80)],'anxious':[(0,5.30)]}
profiles={'protector':(.05,.24,.06,.2,2300),'manipulator':(.25,.34,.23,.3,1400),'anxious':(.55,.17,.13,.25,2100)}
def pan(v):
    a=(v+1)*math.pi/4
    return f'pan=stereo|c0={math.cos(a)}*c0|c1={math.sin(a)}*c0'
clips={};records=[]
for pack in receipt['packs']:
    identity=pack['identity'];master=root/(identity+'.wav')
    (masters/(identity+'-orbs.wav')).write_bytes(master.read_bytes())
    folder=game/identity;folder.mkdir(parents=True,exist_ok=True)
    p,delay,wet,decay,cutoff=profiles[identity]
    for line,(start,end) in zip(pack['lines'],ranges[identity]):
        duration=end-start
        # Remove only long silence between the boss warning's sentences, not phonemes.
        prefix=''
        inputlabel='[0:a]'
        if identity=='anxious':
            prefix='[0:a]asplit=3[s0][s1][s2];[s0]atrim=start=0:end=1.15,asetpts=PTS-STARTPTS[c0];[s1]atrim=start=2.02:end=2.85,asetpts=PTS-STARTPTS[c1];[s2]atrim=start=3.82:end=5.30,asetpts=PTS-STARTPTS[c2];[c0][c1][c2]concat=n=3:v=0:a=1[compact];'
            inputlabel='[compact]';duration=1.15+.83+1.48
        graph=(prefix+inputlabel+'pan=mono|c0=0.5*c0+0.5*c1,highpass=f=85,lowpass=f=10500,asplit=3[d][a][b];'
            +f'[d]{pan(p)}[dry];[a]highpass=f=260,lowpass=f={cutoff},volume={wet},adelay={round(delay*1000)}:all=1,{pan(-p*.9)}[e1];'
            +f'[b]highpass=f=340,lowpass=f={cutoff/1.35},volume={wet*decay},adelay={round(delay*2000)}:all=1,{pan(p*.5)}[e2];'
            +'[dry][e1][e2]amix=inputs=3:duration=longest:normalize=0,aresample=44100,earwax,loudnorm=I=-18:TP=-3:LRA=7,'
            +f'afade=t=in:d=0.01,afade=t=out:st={duration+2*delay-.08}:d=0.08[out]')
        relative=identity+'/'+line['id']+'.ogg';target=game/relative
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss',str(start),'-t',str(end-start),'-i',str(master),
            '-filter_complex',graph,'-map','[out]','-ar','48000','-c:a','libvorbis','-q:a','4',str(target)],check=True)
        clips[line['id']]={'file':relative,'effectsBaked':True,'speechDuration':duration}
        records.append({'id':line['id'],'identity':identity,'text':line['text'],'masterStart':start,'masterEnd':end,
            'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'masterSha256':hashlib.sha256(master.read_bytes()).hexdigest()})
result={'quotedCredits':1.6,'packs':receipt['packs'],'manifestClips':clips,'clips':records,
    'processing':'Fading filtered cross-ear echoes; earwax; -18 LUFS / -3 dBTP mastering; edge fades',
    'alignment':'Offline tiny.en word timestamps; boss sentence gaps compacted'}
(out/'audio-staging/voices/level1-orbs-results.json').write_text(json.dumps(result,indent=2)+'\n')
with zipfile.ZipFile(root/'level1-orbs.zip','w',zipfile.ZIP_DEFLATED) as package:
    for file in out.rglob('*'):
        if file.is_file():package.write(file,file.relative_to(out))
print(json.dumps({'clips':len(clips),'archiveBytes':(root/'level1-orbs.zip').stat().st_size}))
