"""Validate public library integrity, order, and browser playback without a key."""
import argparse,json,pathlib,subprocess
from playwright.sync_api import sync_playwright
from update_plain_library import entries,norm
import hashlib
p=argparse.ArgumentParser();p.add_argument('--playlist',required=True);p.add_argument('--url',default='http://127.0.0.1:4187/practice/');a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1]/'library'
manifest=json.loads((root/'library.json').read_text(encoding='utf-8'))
tracks=manifest['tracks'];sources=entries(a.playlist)
assert len(tracks)==len(sources)
assert len(set(t['id'] for t in tracks))==len(tracks)
for t,(path,_) in zip(tracks,sources):
    assert t['file']=='track-'+hashlib.sha256(norm(path).encode()).hexdigest()[:20]+'.m4a'
    file=root/t['file'];assert file.stat().st_size<100*1024*1024
    info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(file)]))
    assert info['streams'][0]['codec_name']=='aac'
    assert abs(float(info['streams'][0]['duration'])-t['duration'])<2
print(f'PASS: all {len(tracks)} tracks match playlist order, AAC codec, duration, and file-size limits.',flush=True)
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport={'width':390,'height':844});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.add_init_script('''const original=AudioNode.prototype.connect;AudioNode.prototype.connect=function(dest,...args){if(dest instanceof AudioDestinationNode){const analyser=this.context.createAnalyser();analyser.fftSize=2048;original.call(this,analyser);window.audioProbe=analyser;}return original.call(this,dest,...args);};''')
    page.goto(a.url+'#key=obsolete-bookmark');page.wait_for_selector('#room',state='visible')
    assert page.evaluate('location.hash')==''
    assert page.locator('#tracks .track').count()==len(tracks)
    assert page.locator('#lock').is_hidden()
    assert page.locator('#tracks .track strong').all_text_contents()==[t['name'] for t in tracks]
    page.locator('#play').click();page.wait_for_function("document.querySelector('#play').textContent.includes('Pause')",timeout=60000)
    page.wait_for_function('''()=>{if(!window.audioProbe)return false;const a=new Float32Array(audioProbe.fftSize);audioProbe.getFloatTimeDomainData(a);return a.some(v=>Math.abs(v)>.001);}''')
    page.locator('#preview').click();page.wait_for_function("document.querySelector('#mix-label').textContent.includes('Mixing')",timeout=60000)
    page.wait_for_function("[...document.querySelectorAll('.deck-state')].every(el=>el.textContent==='PLAYING')")
    page.locator('#preview').click()
    page.wait_for_function("document.querySelector('#play').textContent.includes('Pause')")
    page.wait_for_function('(name)=>document.querySelector("#deck-a h2").textContent===name',arg=tracks[2]['name'])
    assert page.locator('#play').evaluate('(el)=>el.nextElementSibling.id')=='preview'
    page.locator('#playback-mode').select_option('background')
    page.locator('#preview').click()
    page.wait_for_function("document.querySelector('#play').textContent.includes('Pause')")
    assert page.locator('#playback-mode').input_value()=='mix'
    page.locator('#play').click()
    page.wait_for_function('navigator.serviceWorker.controller!==null')
    page.context.set_offline(True);page.reload();page.wait_for_selector('#room',state='visible')
    page.locator('#playback-mode').select_option('background');page.locator('#play').click()
    page.wait_for_function("document.querySelector('audio').currentTime>1",timeout=60000)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    print('PASS: keyless loading, exact queue, old bookmark cleanup, audible mixing, dual-deck transition, offline native playback, mobile layout; no browser errors.')
    browser.close()
