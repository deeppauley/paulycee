"""Relative energy proxy from short audio samples, not a proprietary energy rating."""
import hashlib,json,os,pathlib,secrets,threading
import numpy as np
from beat_analysis import pcm,duration
_lock=threading.Lock()
def energy(source,track,cache):
    source=pathlib.Path(source);cache=pathlib.Path(cache);cache.mkdir(parents=True,exist_ok=True);stat=source.stat()
    key=hashlib.sha256(f'energy-v1|{source}|{stat.st_size}|{stat.st_mtime_ns}'.encode()).hexdigest();target=cache/(key+'.json')
    if target.exists():return json.loads(target.read_text())
    with _lock:
        if target.exists():return json.loads(target.read_text())
        length=duration(source);samples=pcm(source,min(max(0,length*.3),max(0,length-16)),16)
        count=len(samples)//160
        if count<10:result={'energy':None,'method':'insufficient audio'}
        else:
            frames=samples[:count*160].reshape(count,160);rms=np.sqrt(np.mean(frames**2,axis=1)+1e-12)
            level=float(np.clip((20*np.log10(np.mean(rms)+1e-8)+36)/30,0,1))
            onset=float(np.mean(np.maximum(0,np.diff(rms)))/(np.mean(rms)+1e-8))
            pulse=float(np.clip(onset*5,0,1))
            result={'energy':round(.65*level+.35*pulse,3),'method':'short-sample loudness/onset proxy'}
        temp=cache/(key+'-'+secrets.token_hex(4)+'.json');temp.write_text(json.dumps(result));os.replace(temp,target);return result
