"""On-demand, confidence-gated kick-grid estimation and pitch-preserving preparation.

All decoded audio and rendered files remain in the external PC runtime cache.
"""
import hashlib,json,os,pathlib,secrets,subprocess,threading
import numpy as np

VERSION='smooth-v3'
_lock=threading.Lock()

def pcm(path,start,length):
    result=subprocess.run(['ffmpeg','-v','error','-ss',str(max(0,start)),'-i',str(path),'-t',str(length),'-vn','-ac','1','-ar','8000','-f','f32le','pipe:1'],capture_output=True,check=True,timeout=90)
    return np.frombuffer(result.stdout,dtype='<f4').copy()

def estimate(samples,bpm,origin=0):
    """Fit kick onset phase/period; reject silence, sustained tones and weak grids."""
    if len(samples)<8000*8 or not 40<=bpm<=250:return None
    spectrum=np.fft.rfft(samples);frequency=np.fft.rfftfreq(len(samples),1/8000)
    spectrum[(frequency<35)|(frequency>180)]=0
    low=np.fft.irfft(spectrum,n=len(samples))
    n=len(low)//80
    energy=np.sqrt(np.mean(low[:n*80].reshape(n,80)**2,axis=1)+1e-12)
    onset=np.maximum(0,energy-np.roll(energy,2));onset[:2]=0
    floor=np.percentile(onset,60);onset=np.maximum(0,onset-floor)
    if np.max(onset)<.0001:return None
    # Prevent a single big drop dominating dozens of otherwise inconsistent beats.
    cap=np.percentile(onset[onset>0],90);onset=np.minimum(onset,cap)
    times=np.arange(n)/100
    best=None
    for candidate in np.linspace(bpm*.98,bpm*1.02,161):
        period=60/candidate
        bins=max(20,round(period*100))
        phase=((times+origin)%period/period*bins).astype(int)%bins
        histogram=np.bincount(phase,weights=onset,minlength=bins)
        smooth=histogram+np.roll(histogram,1)*.65+np.roll(histogram,-1)*.65
        peak=int(np.argmax(smooth));score=float(smooth[peak]/(np.mean(smooth)+1e-12))
        if best is None or score>best['score']:
            best={'bpm':float(candidate),'phase':peak/bins*period,'score':score}
    if best['score']<2.2:return None
    period=60/best['bpm']
    beats=np.arange(origin,origin+n/100,period)
    beats+=((best['phase']-beats[0])%period)
    peaks=[]
    for beat in beats:
        i=round((beat-origin)*100)
        if 3<=i<n-3:peaks.append(float(np.max(onset[i-3:i+4])))
    support=float(np.mean(np.array(peaks)>cap*.15)) if peaks else 0
    if support<.55:return None
    best['confidence']=round(min(1,(best['score']-1)/5)*support,3)
    return best

def duration(path):
    return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(path)],timeout=30))

def prepare(source,track,tempo,cache):
    source=pathlib.Path(source);cache=pathlib.Path(cache);cache.mkdir(parents=True,exist_ok=True)
    stat=source.stat()
    token=hashlib.sha256(f'{VERSION}|{source}|{stat.st_mtime_ns}|{stat.st_size}|{tempo}|{track.get("bpm")}|{track.get("intro")}'.encode()).hexdigest()
    media=cache/(token+'.m4a');meta=cache/(token+'.json')
    # Existing streams must never wait behind another track's analysis/render job.
    if media.exists() and meta.exists():return json.loads(meta.read_text()),media
    with _lock:
        if media.exists() and meta.exists():return json.loads(meta.read_text()),media
        original_duration=duration(source);bpm=float(track.get('bpm') or 0)
        head=estimate(pcm(source,0,min(64,original_duration)),bpm)
        tail_start=max(0,original_duration-64)
        tail=estimate(pcm(source,tail_start,64),bpm,tail_start)
        # Only refine the global BPM when independently measured ends agree.
        measured=(head['bpm']+tail['bpm'])/2 if head and tail and abs(head['bpm']-tail['bpm'])<.35 else bpm
        rate=tempo/measured if measured>0 else 1
        # Avoid needless time stretching when the tempos already match. Rubber Band
        # handles stereo music with linked channels and smoothed, preserved pitch.
        if abs(rate-1)<.0005:
            rate=1
            processing=[]
        else:
            processing=['-af',f'rubberband=tempo={rate:.9f}:pitch=1:transients=mixed:detector=compound:phase=laminar:smoothing=on:channels=together']
        temp=cache/(token+'-'+secrets.token_hex(4)+'.m4a')
        try:
            subprocess.run(['ffmpeg','-y','-v','error','-i',str(source),'-vn',*processing,'-ac','2','-ar','44100','-c:a','aac','-b:a','192k','-map_metadata','-1','-movflags','+faststart',str(temp)],check=True,capture_output=True,timeout=180)
            length=duration(temp)
            # Measure the actual rendered stream, including time-stretch encoder delay.
            first=estimate(pcm(temp,0,min(64,length)),tempo)
            end_start=max(0,length-64);last=estimate(pcm(temp,end_start,64),tempo,end_start)
            period=60/tempo
            expected=float(track.get('intro') or 0)/rate
            intro=expected
            if first:intro=max(0,first['phase']+round((expected-first['phase'])/period)*period)
            outro=length
            if last:
                last_bar=intro+np.floor((length-intro)/(4*period))*4*period
                outro=last['phase']+round((last_bar-last['phase'])/period)*period
                if outro>length:outro-=4*period
            # Independent head/tail anchors avoid compounding a shifted XML grid.
            grids=[{'time':intro,'bpm':tempo,'beat':1}] if bpm>0 else []
            confident=bool(first and last and min(first['confidence'],last['confidence'])>=.45 and abs(first['bpm']-tempo)<.3 and abs(last['bpm']-tempo)<.3)
            result={'duration':length,'intro':intro,'mixOutro':float(outro),'grids':grids,'bpm':tempo if bpm else 0,'prepared':True,'analysis':{'introDetected':bool(first),'outroDetected':bool(last),'sourceBpm':measured,'confidence':min(first['confidence'],last['confidence']) if first and last else 0},'mixBeats':32 if confident else 8}
            os.replace(temp,media)
            metadata=cache/(token+'-'+secrets.token_hex(4)+'.json');metadata.write_text(json.dumps(result));os.replace(metadata,meta)
            return result,media
        finally:temp.unlink(missing_ok=True)
