"""Exercise the portal with a temporary local server and generated audio only."""
import argparse,json,pathlib,subprocess,sys,tempfile,time,urllib.parse,urllib.request
from playwright.sync_api import sync_playwright
from test_server import prepare

def main():
    p=argparse.ArgumentParser();p.add_argument('--url',default='http://127.0.0.1:4187/stream/');p.add_argument('--screenshots');a=p.parse_args()
    with tempfile.TemporaryDirectory() as temp:
        root=pathlib.Path(temp);xml=prepare(root);state=root/'state';base='http://127.0.0.1:4191'
        server=subprocess.Popen([sys.executable,str(pathlib.Path(__file__).with_name('server.py')),'--xml',str(xml),'--state',str(state),'--port','4191','--public'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen(base+'/library',timeout=2) as r:json.load(r)
                    break
                except OSError:time.sleep(.05)
            with sync_playwright() as pw:
                browser=pw.chromium.launch(channel='msedge',headless=True);page=browser.new_page(viewport={'width':1440,'height':1100});errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.add_init_script('''const connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(to,...args){if(to instanceof AudioDestinationNode){const a=this.context.createAnalyser();a.fftSize=2048;connect.call(this,a);window.probe=a;}return connect.call(this,to,...args);};''')
                page.add_init_script('''window.rateChanges=[];const rate=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'playbackRate');Object.defineProperty(HTMLMediaElement.prototype,'playbackRate',{get:rate.get,set(value){window.rateChanges.push(value);return rate.set.call(this,value);}});''')
                page.route('**/stream/connection.json',lambda route:route.fulfill(json={'server':base}))
                page.goto(a.url);page.wait_for_selector('#room',state='visible')
                page.locator('#playback-mode').select_option('mix')
                assert page.locator('#key').count()==0;assert page.locator('.track').count()==2
                page.locator('.track button').nth(0).click();page.wait_for_function("document.querySelector('#favorite-count').textContent==='1'")
                other=browser.new_context();second=other.new_page()
                second.route('**/stream/connection.json',lambda route:route.fulfill(json={'server':base}))
                second.goto(a.url);second.wait_for_selector('#room',state='visible')
                second.locator('#playback-mode').select_option('mix')
                assert second.locator('#favorite-count').inner_text()=='1','Favorites did not cross browser contexts'
                second.evaluate("localStorage.setItem('pauly-stream-favorites',JSON.stringify(['1002']))")
                second.reload();second.wait_for_selector('#room',state='visible')
                second.locator('#playback-mode').select_option('mix')
                assert second.locator('#favorite-count').inner_text()=='2'
                assert second.evaluate("localStorage.getItem('pauly-stream-favorites')") is None
                second.locator('#favorites').click()
                assert second.locator('.track strong').all_text_contents()==['Tone 1','Tone 2']
                second.locator('#favorite-sort').select_option('bpm-desc')
                assert second.locator('.track strong').all_text_contents()==['Tone 2','Tone 1']
                second.locator('#bpm-min').fill('125');second.locator('#bpm-min').dispatch_event('change')
                assert second.locator('.track strong').all_text_contents()==['Tone 2']
                second.locator('#bpm-min').fill('');second.locator('#bpm-min').dispatch_event('change')
                second.locator('#favorite-sort').select_option('bpm-asc')
                second.locator('#play').click();second.wait_for_function("document.querySelector('#play').textContent.includes('Pause')")
                assert second.locator('#now-title').inner_text()=='Tone 1'
                second.locator('#jump').click();second.wait_for_function("document.querySelector('#mix-state').textContent.includes('MIXING')")
                assert second.locator('#now-title').inner_text()=='Tone 2'
                second.wait_for_function("document.querySelector('#play').textContent.includes('Pause')")
                assert second.locator('#nudge-forward').count()==0
                assert second.evaluate('Array.from(document.querySelectorAll("audio")).every(a=>a.playbackRate===1)')
                second.locator('#play').click();second.locator('#favorites').click()
                second.locator('.track').nth(1).locator('button').first.click();second.wait_for_function("document.querySelector('#favorite-count').textContent==='1'")
                other.close()
                page.reload();page.wait_for_selector('#room',state='visible');assert page.locator('#favorite-count').inner_text()=='1'
                page.locator('#playback-mode').select_option('mix')
                page.locator('#favorites').click();assert page.locator('.track').count()==1;page.locator('#favorites').click()
                page.locator('#playlist').select_option('0');assert page.locator('.track strong').all_text_contents()==['Tone 2','Tone 1']
                page.locator('#play').click();page.wait_for_function("document.querySelector('#play').textContent.includes('Pause')",timeout=10000)
                page.wait_for_function('''()=>{if(!window.probe)return false;const a=new Float32Array(probe.fftSize);probe.getFloatTimeDomainData(a);return a.some(v=>Math.abs(v)>.01);}''')
                for _ in range(35):
                    page.wait_for_timeout(1000)
                    assert 'Pause' in page.locator('#play').inner_text(),page.locator('#status').inner_text()
                    assert page.evaluate('''()=>{const a=new Float32Array(probe.fftSize);probe.getFloatTimeDomainData(a);return a.some(v=>Math.abs(v)>.01);}'''),'Audio cut out'
                assert page.evaluate('rateChanges.length>0 && rateChanges.every(rate=>rate===1)'), 'Browser playback rate changed during prepared streaming'
                page.locator('#jump').click();page.wait_for_function("document.querySelector('#mix-state').textContent.includes('MIXING')");page.wait_for_function("document.querySelector('#play').textContent.includes('Pause')")
                assert page.locator('#now-title').inner_text()=='Tone 1'
                page.wait_for_timeout(400);page.locator('#play').click();frozen=page.locator('#elapsed').inner_text();page.wait_for_timeout(700);assert page.locator('#elapsed').inner_text()==frozen
                if a.screenshots:
                    shots=pathlib.Path(a.screenshots);shots.mkdir(parents=True,exist_ok=True);page.screenshot(path=str(shots/'stream-desktop.png'))
                page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                if a.screenshots:page.screenshot(path=str(shots/'stream-mobile.png'),full_page=True)
                page.locator('#search').fill('Tone 2');assert page.locator('.track').count()==1
                page.locator('#disconnect').click();assert page.locator('#connect').is_visible();assert not errors,errors
                page.route(base+'/audio/1002?*',lambda route:route.fulfill(status=503,body='Unavailable test track'))
                page.reload();page.wait_for_selector('#room',state='visible');page.locator('#playback-mode').select_option('mix');page.locator('#play').click()
                page.wait_for_function("document.querySelector('#play').textContent.includes('Pause')",timeout=10000)
                page.wait_for_timeout(4000)
                assert 'Pause' in page.locator('#play').inner_text(),'A failed next-track preload stopped current audio'
                assert page.evaluate('''()=>{const a=new Float32Array(probe.fftSize);probe.getFloatTimeDomainData(a);return a.some(v=>Math.abs(v)>.01);}''')
                page.locator('#disconnect').click()
                print('PASS: public automatic connection, playlist order, favorites, 35 seconds continuous audio at fixed rate 1, transition preview, pause, search, mobile width and disconnect. No browser errors.')
                browser.close()
        finally:server.terminate();server.wait(timeout=10)

if __name__=='__main__':main()
