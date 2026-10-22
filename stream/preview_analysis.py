"""Estimate the first hook using named cues, then repeated energetic sections.

This is a structural preview cue, not semantic chorus/lyric recognition.
Original audio is never time stretched for previews.
"""
import hashlib,json,os,pathlib,secrets,threading
import numpy as np
from beat_analysis import pcm,duration

_lock=threading.Lock()
VERSION='hook-v1'

def hook(samples,bpm,length,intro=0):
    sr=8000;size=2048;hop=512
    if len(samples)<sr*20:return max(0,min(length*.25,length-1)),False
    frames=np.lib.stride_tricks.sliding_window_view(samples,size)[::hop]
    spectrum=np.abs(np.fft.rfft(frames*np.hanning(size),axis=1))
    frequency=np.fft.rfftfreq(size,1/sr)
    valid=(frequency>=65)&(frequency<=2000)
    midi=np.round(69+12*np.log2(frequency[valid]/440)).astype(int)%12
    chroma=np.stack([np.sum(spectrum[:,valid][:,midi==k],axis=1) for k in range(12)],axis=1)
    rms=np.sqrt(np.mean(frames**2,axis=1)+1e-12)
    # One feature per second keeps the repeated-section search small and deterministic.
    count=int(len(samples)/sr)-1
    features=[];energy=[]
    for second in range(count):
        a=int(second*sr/hop);b=int((second+1)*sr/hop)
        features.append(np.mean(chroma[a:b],axis=0));energy.append(float(np.mean(rms[a:b])))
    features=np.nan_to_num(np.array(features));energy=np.nan_to_num(np.array(energy))
    features/=np.linalg.norm(features,axis=1,keepdims=True)+1e-12
    width=8;best=None
    lower=12 if length<100 else 20;upper=min(count-width-20,100,int(length*.5))
    for start in range(lower,max(lower,upper)):
        section=features[start:start+width]
        loud=float(np.mean(energy[start:start+width]))
        if loud<np.percentile(energy,45):continue
        later=[float(np.mean(np.sum(section*features[j:j+width],axis=1))) for j in range(start+24,count-width,2)]
        repeat=max(later,default=0)
        if repeat<.86:continue
        before=float(np.mean(energy[max(0,start-6):start]))
        rise=min(2,loud/(before+1e-8))
        score=repeat+.25*loud/(np.percentile(energy,85)+1e-8)+.18*rise-.0015*start
        if best is None or score>best[0]:best=(score,start)
    position=float(best[1]) if best else min(60,length*.25)
    if bpm>0:
        bar=240/bpm;position=intro+round((position-intro)/bar)*bar
    return max(0,min(position,length-1)),bool(best)

def preview(source,track,cache):
    source=pathlib.Path(source);cache=pathlib.Path(cache);cache.mkdir(parents=True,exist_ok=True)
    stat=source.stat();key=hashlib.sha256(f'{VERSION}|{source}|{stat.st_mtime_ns}|{stat.st_size}|{track.get("cues",[])}'.encode()).hexdigest()
    target=cache/(key+'.json')
    if target.exists():return json.loads(target.read_text())
    with _lock:
        if target.exists():return json.loads(target.read_text())
        length=duration(source)
        named=[c for c in track.get('cues',[]) if any(word in c.get('name','').lower() for word in ['chorus','hook','drop']) and 0<=c['time']<length]
        if named:position=min(c['time'] for c in named);method='named cue'
        else:
            position,found=hook(pcm(source,0,min(length,180)),track.get('bpm',0),length,track.get('intro',0))
            method='estimated chorus' if found else 'preview estimate'
        result={'position':position,'duration':length,'method':method,'originalSpeed':True}
        temp=cache/(key+'-'+secrets.token_hex(4)+'.json');temp.write_text(json.dumps(result));os.replace(temp,target)
        return result
