"""Fast preview integration: original speed, estimated cue, unrestricted scrub, no mix."""
import json,pathlib,subprocess,sys,tempfile,time,urllib.request
from playwright.sync_api import sync_playwright
from test_server import prepare

def main():
    with tempfile.TemporaryDirectory() as temp:
        root=pathlib.Path(temp);xml=prepare(root);base='http://127.0.0.1:4192'
        server=subprocess.Popen([sys.executable,str(pathlib.Path(__file__).with_name('server.py')),'--xml',str(xml),'--state',str(root/'state'),'--port','4192','--public'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen(base+'/library',timeout=2):break
                except OSError:time.sleep(.05)
            with sync_playwright() as p:
                browser=p.chromium.launch(channel='msedge',headless=True)
                try:
                    page=browser.new_page(viewport={'width':390,'height':844});errors=[];requests=[]
                    page.on('pageerror',lambda e:errors.append(str(e)))
                    page.on('request',lambda r:requests.append(r.url))
                    page.add_init_script('''window.previewAudios=[];const NativeAudio=window.Audio;window.Audio=function(...args){const a=new NativeAudio(...args);previewAudios.push(a);return a;};window.Audio.prototype=NativeAudio.prototype;''')
                    page.route('**/stream/connection.json',lambda r:r.fulfill(json={'server':base}))
                    page.goto('http://127.0.0.1:4187/stream/');page.wait_for_selector('#room',state='visible')
                    assert page.locator('#playback-mode').input_value()=='preview'
                    assert page.locator('#tempo').is_disabled()
                    page.locator('#play').click()
                    page.wait_for_function('previewAudios.some(a=>!a.paused&&a.currentTime>5)',timeout=30000)
                    assert page.locator('#now-title').inner_text()=='Tone 1'
                    heart=page.locator('#favorite-current');forward=page.locator('#next')
                    h=heart.bounding_box();n=forward.bounding_box()
                    assert h['height']==n['height'] and h['height']>=112
                    party=page.locator('#halloween-current').bounding_box()
                    assert h['x']<party['x'] and abs(h['y']-party['y'])<1 and h['y']+h['height']<n['y']
                    heart.click();page.wait_for_function('(el)=>el.getAttribute(String.fromCharCode(97,114,105,97,45,112,114,101,115,115,101,100))===String.fromCharCode(116,114,117,101)',arg=heart.element_handle())
                    assert heart.evaluate('(el)=>getComputedStyle(el).color')=='rgb(255, 59, 92)'
                    for _ in range(7):
                        page.wait_for_timeout(1000)
                        assert page.evaluate('previewAudios.filter(a=>!a.paused).length===1&&previewAudios.every(a=>a.playbackRate===1)')
                    assert not any('/prepare/' in r or '?tempo=' in r for r in requests)
                    page.locator('#seek').fill('2');page.locator('#seek').dispatch_event('change')
                    page.wait_for_function('previewAudios.some(a=>!a.paused&&a.currentTime>=2&&a.currentTime<5)')
                    page.locator('#play').click()
                    page.locator('#seek').fill('0');page.locator('#seek').dispatch_event('change')
                    assert page.locator('#elapsed').inner_text()=='0:00'
                    page.locator('#play').click();page.wait_for_timeout(500)
                    assert page.evaluate('previewAudios[0].currentTime<4'),'Scrubbing to intro jumped back to chorus'
                    page.locator('#jump').click();page.wait_for_function('previewAudios[0].currentTime>5')
                    page.locator('#next').click();page.wait_for_function('(el)=>el.textContent===String.fromCharCode(84,111,110,101,32,50)',arg=page.locator('#now-title').element_handle())
                    page.wait_for_function('previewAudios[0].currentTime>5&&!previewAudios[0].paused')
                    page.evaluate('previewAudios[0].currentTime=previewAudios[0].duration-.3')
                    page.wait_for_timeout(1000)
                    assert 'Play' in page.locator('#play').inner_text(),'Last song did not finish cleanly'
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                    assert not errors,errors
                    page.locator('#disconnect').click()
                    print('PASS fast preview default, original source requests, one native deck at rate 1, chorus jump, playing/paused full scrubbing, next preview, clean ending and mobile layout')
                finally:browser.close()
        finally:server.terminate();server.wait(timeout=10)

if __name__=='__main__':main()
