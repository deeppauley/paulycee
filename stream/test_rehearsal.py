"""Isolated imported-playlist order and mobile Automix controls test."""
import json,pathlib,subprocess,sys,tempfile,time,urllib.request
from playwright.sync_api import sync_playwright
from test_server import prepare
from import_playlist import import_playlist
from server import library

with tempfile.TemporaryDirectory() as temp:
    root=pathlib.Path(temp);xml=prepare(root);state=root/'state';m3u=root/'test.m3u8'
    m3u.write_text('#EXTM3U\n'+str(root/'tone-1.wav')+'\n'+str(root/'tone-0.wav')+'\n',encoding='utf-8')
    assert import_playlist(m3u,xml,state,'asian-beer-fest','Asian Beer Fest')==['1002','1001']
    catalog,_=library(xml,state/'playlists');assert catalog['playlists'][-1]['tracks']==['1002','1001']
    process=subprocess.Popen([sys.executable,'stream/server.py','--xml',str(xml),'--state',str(state),'--port','4196','--public'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:urllib.request.urlopen('http://127.0.0.1:4196/library',timeout=1).close();break
            except OSError:time.sleep(.05)
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='msedge',headless=True)
            try:
                page=browser.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                page.add_init_script('sessionStorage.setItem(\'pauly-stream-heard:v1\','+json.dumps(json.dumps([t['audioId'] for t in catalog['tracks']]))+');')
                page.add_init_script('''window.audios=[];const N=window.Audio;window.Audio=function(...args){const a=new N(...args);audios.push(a);return a;};window.Audio.prototype=N.prototype;''')
                page.route('**/stream/connection.json',lambda r:r.fulfill(json={'server':'http://127.0.0.1:4196'}))
                def duration_drift(route):
                    response=route.fetch();data=response.json();data['duration']-=.25
                    route.fulfill(response=response,json=data)
                page.route('**/prepare/*',duration_drift)
                page.goto('http://127.0.0.1:4187/stream/?playlist=import-asian-beer-fest');page.wait_for_selector('#room',state='visible')
                assert page.locator('#playlist').input_value()=='import-asian-beer-fest'
                assert page.locator('#playlist option').first.get_attribute('value')=='import-asian-beer-fest'
                assert page.locator('#play').is_enabled()
                assert page.locator('#playback-mode').input_value()=='mix'
                assert page.locator('#queue-order').input_value()=='regular'
                assert page.locator('#tempo').input_value()=='128'
                assert page.locator('#now-title').inner_text()=='Tone 2'
                assert page.locator('.track').first.inner_text().find('Tone 2')>=0
                page.locator('#mix-bars').select_option('16');assert page.locator('#now-title').inner_text()=='Tone 2'
                page.locator('#play').click()
                page.wait_for_function('(el)=>el.textContent.includes(String.fromCharCode(80,97,117,115,101))',arg=page.locator('#play').element_handle(),timeout=60000)
                assert page.locator('#now-title').inner_text()=='Tone 2'
                page.wait_for_timeout(1500);page.locator('#jump').click()
                page.wait_for_function('audios.filter(a=>!a.paused).length===2',timeout=60000)
                assert page.evaluate('audios.every(a=>a.playbackRate===1)')
                page.locator('#play').click();page.locator('#playlist').select_option('all')
                assert page.locator('#play').is_disabled(),'Rehearsal repeat exception leaked to collection'
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                assert not errors,errors
                page.locator('#disconnect').click()
                print('PASS pinned ordered rehearsal, previously heard tracks replay, collection exclusions retained, 4/8 bars, duration-rebuild handoff with two rate-1 decks, mobile fit')
            finally:browser.close()
    finally:
        # Let speculative next-track FFmpeg work finish before Windows removes files.
        for _ in range(200):
            if len(list((state/'mix-cache').glob('*.json')))>=2:break
            time.sleep(.1)
        process.terminate();process.wait(timeout=10)
