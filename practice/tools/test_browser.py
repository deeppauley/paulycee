"""Browser/audio smoke test. Pass the private key file; it is never printed."""
import argparse, io, json, math, pathlib, struct, wave
from playwright.sync_api import sync_playwright

p=argparse.ArgumentParser();p.add_argument('--url',default='http://127.0.0.1:4187/practice/');p.add_argument('--key-file',required=True);p.add_argument('--screenshots',required=True);a=p.parse_args()
shots=pathlib.Path(a.screenshots);shots.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1100})
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.add_init_script('''const original=AudioNode.prototype.connect;AudioNode.prototype.connect=function(dest,...args){if(dest instanceof AudioDestinationNode){const analyser=this.context.createAnalyser();analyser.fftSize=2048;original.call(this,analyser);window.audioProbe=analyser;}return original.call(this,dest,...args);};''')
    page.goto(a.url)
    page.locator('#access-key').fill('A'*43);page.locator('#unlock-form button').click()
    page.wait_for_function("document.querySelector('#status').textContent.includes('did not unlock')")
    page.locator('#access-key').fill(pathlib.Path(a.key_file).read_text().strip());page.locator('#unlock-form button').click()
    page.wait_for_selector('#room',state='visible');assert page.locator('#tracks .track').count()==80
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(shots/'practice-desktop.png'))
    page.locator('#play').click();page.wait_for_function("document.querySelector('#play').textContent.includes('Pause')",timeout=60000)
    page.wait_for_timeout(1500)
    def rms():return page.evaluate('''()=>{const s=new Float32Array(audioProbe.fftSize);audioProbe.getFloatTimeDomainData(s);return Math.sqrt(s.reduce((a,b)=>a+b*b,0)/s.length);}''')
    assert rms()>0.0001, 'No audio output'
    page.locator('#preview').click();page.wait_for_timeout(5000);print('PREVIEW_STATUS:',page.locator('#status').inner_text(),page.locator('#mix-label').inner_text(),flush=True);page.wait_for_function("document.querySelector('#mix-label').textContent.includes('Mixing')",timeout=60000)
    page.wait_for_timeout(1000);assert rms()>0.0001,'No overlap audio'
    assert page.locator('.deck-state').all_text_contents()==['PLAYING','PLAYING']
    page.locator('#play').click();frozen=page.locator('#elapsed').inner_text();page.wait_for_timeout(1200);assert page.locator('#elapsed').inner_text()==frozen
    page.locator('#play').click();page.wait_for_timeout(2000);print('RESUME_STATUS:',page.locator('#status').inner_text());page.wait_for_function("document.querySelector('#play').textContent.includes('Pause')");assert rms()>0.0001
    page.locator('#next').click();page.wait_for_function("document.querySelector('#play').textContent.includes('Pause')",timeout=60000)
    page.locator('#play').click()
    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(300)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Mobile horizontal overflow'
    page.screenshot(path=str(shots/'practice-mobile.png'))
    page.locator('#intro').fill('999999');page.locator('#save-points').click();assert 'Intro must be before' in page.locator('#status').inner_text()
    page.locator('#lock').click();assert page.locator('#gate').is_visible()
    page.context.set_offline(True);page.reload();page.locator('#access-key').fill(pathlib.Path(a.key_file).read_text().strip());page.locator('#unlock-form button').click();page.wait_for_selector('#room',state='visible');page.locator('#play').click();page.wait_for_function("document.querySelector('#play').textContent.includes('Pause')");page.wait_for_timeout(800);assert rms()>0.0001,'Offline cached audio failed';page.locator('#lock').click();page.context.set_offline(False)
    page.locator('#local-start').click()
    wav=io.BytesIO()
    with wave.open(wav,'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(44100);w.writeframes(b''.join(struct.pack('<h',int(5000*math.sin(i*440*2*math.pi/44100))) for i in range(44100*5)))
    page.locator('#audio-files').set_input_files({'name':'test-tone.wav','mimeType':'audio/wav','buffer':wav.getvalue()})
    page.wait_for_function("document.querySelector('#status').textContent.includes('audio files saved')")
    assert page.locator('#tracks .track').count()==1
    page.locator('#play').click();page.wait_for_function("document.querySelector('#play').textContent.includes('Pause')");page.wait_for_timeout(500);assert rms()>0.001
    page.locator('#play').click()
    xml=b'<DJ_PLAYLISTS><COLLECTION><TRACK Name="Imported tone" Location="file://localhost/C:/test-tone.wav" AverageBpm="120" Tonality="8A"><TEMPO Inizio="0" Bpm="120" Battito="1"/><POSITION_MARK Name="Intro" Start="0" Num="0"/></TRACK></COLLECTION></DJ_PLAYLISTS>'
    page.locator('#xml-file').set_input_files({'name':'test.xml','mimeType':'text/xml','buffer':xml});page.wait_for_function("document.querySelector('#status').textContent.includes('Matched 1')")
    assert '120 BPM' in page.locator('#track-note').inner_text()
    page.locator('#playlist-file').set_input_files({'name':'Test.m3u8','mimeType':'text/plain','buffer':b'#EXTM3U\nC:\\test-tone.wav\n'})
    page.wait_for_function("document.querySelector('#status').textContent.includes('Ordered 1/1')")
    assert not errors,errors
    print('PASS: wrong-key rejection; 80-track unlock; audible playback; dual-deck overlap; pause/resume; next; mobile layout; cue validation; offline unlock/playback; local upload; XML and M3U8 imports. No browser errors.')
    browser.close()
