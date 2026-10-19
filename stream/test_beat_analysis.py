"""Synthetic shifted-kick regression and pitch-preserving render/cache checks."""
import pathlib,tempfile,wave,subprocess
import numpy as np
from beat_analysis import estimate,prepare,pcm

def main():
    sr=8000;bpm=128.4;phase=.173;length=80
    t=np.arange(sr*length)/sr
    x=np.sin(2*np.pi*440*t)*.05
    for beat in np.arange(phase,length,60/bpm):
        start=round(beat*sr);n=min(1600,len(x)-start);u=np.arange(n)/sr
        x[start:start+n]+=.8*np.sin(2*np.pi*65*u)*np.exp(-u*32)
    fitted=estimate(x,128)
    assert fitted and abs(fitted['bpm']-bpm)<.08,fitted
    period=60/bpm;error=abs(((fitted['phase']-phase+period/2)%period)-period/2)
    assert error<.03,(error,fitted)
    assert estimate(np.zeros(sr*30),128) is None
    assert estimate(np.sin(2*np.pi*220*t),128) is None
    with tempfile.TemporaryDirectory() as tmp:
        root=pathlib.Path(tmp);source=root/'kick.wav'
        with wave.open(str(source),'wb') as f:
            f.setnchannels(1);f.setsampwidth(2);f.setframerate(sr);f.writeframes((x*26000).astype('<i2').tobytes())
        metadata,path=prepare(source,{'bpm':128,'intro':0},120,root/'cache')
        assert metadata['prepared'];assert metadata['analysis']['introDetected'];assert metadata['analysis']['outroDetected']
        assert abs(metadata['duration']-length*bpm/120)<.5,metadata
        rendered=pcm(path,10,5);spectrum=np.abs(np.fft.rfft(rendered));frequencies=np.fft.rfftfreq(len(rendered),1/sr)
        band=(frequencies>400)&(frequencies<480)
        assert abs(frequencies[band][np.argmax(spectrum[band])]-440)<1,'Pitch shifted during tempo preparation'
        cached,same=prepare(source,{'bpm':128,'intro':0},120,root/'cache');assert same==path and cached==metadata
    print('PASS shifted kick BPM/phase, silence/tones rejected, steady tempo render, preserved 440 Hz pitch and disk cache')

if __name__=='__main__':main()
