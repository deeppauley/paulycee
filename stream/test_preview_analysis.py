import pathlib,tempfile,wave
import numpy as np
from preview_analysis import hook,preview

sr=8000
samples=np.zeros(sr*130)
for start,end,amplitude,note in [(0,32,.03,220),(32,48,.6,330),(48,88,.04,261),(88,104,.6,330),(104,130,.03,440)]:
    t=np.arange((end-start)*sr)/sr
    samples[start*sr:end*sr]=amplitude*(np.sin(2*np.pi*note*t)+.3*np.sin(2*np.pi*note*1.5*t))
position,found=hook(samples,120,130)
assert found and 28<=position<=36,(position,found)
with tempfile.TemporaryDirectory() as tmp:
    path=pathlib.Path(tmp)/'source.wav'
    with wave.open(str(path),'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(sr);f.writeframes((samples*24000).astype('<i2').tobytes())
    info=preview(path,{'bpm':120,'cues':[{'time':40,'name':'First chorus'},{'time':90,'name':'Hook'}]},path.parent/'cache')
    assert info['position']==40 and info['method']=='named cue'
    assert preview(path,{'bpm':120,'cues':[{'time':40,'name':'First chorus'},{'time':90,'name':'Hook'}]},path.parent/'cache')==info
print('PASS repeated energetic hook estimate, named cue priority and preview cache')
