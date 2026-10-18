"""Exercise the portal with a temporary local server and generated audio only."""
import argparse,json,pathlib,subprocess,sys,tempfile,time,urllib.parse,urllib.request
from playwright.sync_api import sync_playwright
from test_server import prepare

def main():
    p=argparse.ArgumentParser();p.add_argument('--url',default='http://127.0.0.1:4187/stream/');p.add_argument('--screenshots');a=p.parse_args()
    with tempfile.TemporaryDirectory() as temp:
        root=pathlib.Path(temp);xml=prepare(root);state=root/'state';base='http://127.0.0.1:4191'
        server=subprocess.Popen([sys.executable,str(pathlib.Path(__file__).with_name('server.py')),'--xml',str(xml),'--state',str(state),'--port','4191'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                if (state/'access-key.txt').exists():break
                time.sleep(.05)
            key=(state/'access-key.txt').read_text().strip()
            for _ in range(100):
                try:
                    with urllib.request.urlopen(urllib.request.Request(base+'/library',headers={'Authorization':'Bearer '+key}),timeout=2) as r:json.load(r)
                    break
                except OSError:time.sleep(.05)
            with sync_playwright() as pw:
                browser=pw.chromium.launch(channel='msedge',headless=True);page=browser.new_page(viewport={'width':1440,'height':1100});errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.add_init_script('''const connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(to,...args){if(to instanceof AudioDestinationNode){const a=this.context.createAnalyser();a.fftSize=2048;connect.call(this,a);window.probe=a;}return connect.call(this,to,...args);};''')
                page.goto(a.url);page.locator('#server').fill(base);page.locator('#key').fill('incorrect-access-key-that-is-long-enough');page.locator('#connection button').click();page.wait_for_function("document.querySelector('#status').textContent.includes('not accepted')")
                fragment=urllib.parse.urlencode({'server':base,'key':key});page.goto('about:blank');page.goto(a.url+'#'+fragment);page.wait_for_selector('#room',state='visible')
                assert page.evaluate('location.hash')=='';assert page.locator('.track').count()==2
                page.locator('.track button').nth(0).click();assert page.locator('#favorite-count').inner_text()=='1'
                page.reload();page.wait_for_selector('#room',state='visible');assert page.locator('#favorite-count').inner_text()=='1'
                page.locator('#favorites').click();assert page.locator('.track').count()==1;page.locator('#favorites').click()
                page.locator('#playlist').select_option('0');assert page.locator('.track strong').all_text_contents()==['Tone 2','Tone 1']
                page.locator('#play').click();page.wait_for_function("document.querySelector('#play').textContent.includes('Pause')",timeout=10000)
                page.wait_for_function('''()=>{if(!window.probe)return false;const a=new Float32Array(probe.fftSize);probe.getFloatTimeDomainData(a);return a.some(v=>Math.abs(v)>.01);}''')
                page.locator('#jump').click();page.wait_for_function("document.querySelector('#mix-state').textContent.includes('MIXING')");page.wait_for_function("document.querySelector('#play').textContent.includes('Pause')")
                assert page.locator('#now-title').inner_text()=='Tone 1'
                page.wait_for_timeout(400);page.locator('#play').click();frozen=page.locator('#elapsed').inner_text();page.wait_for_timeout(700);assert page.locator('#elapsed').inner_text()==frozen
                if a.screenshots:
                    shots=pathlib.Path(a.screenshots);shots.mkdir(parents=True,exist_ok=True);page.screenshot(path=str(shots/'stream-desktop.png'))
                page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                if a.screenshots:page.screenshot(path=str(shots/'stream-mobile.png'),full_page=True)
                page.locator('#search').fill('Tone 2');assert page.locator('.track').count()==1
                page.locator('#disconnect').click();assert page.locator('#connect').is_visible();assert not errors,errors
                print('PASS: wrong-key rejection, private link cleanup, playlist order, favorites persistence/filter, audible playback, transition preview, pause, search, mobile width and disconnect. No browser errors.')
                browser.close()
        finally:server.terminate();server.wait(timeout=10)

if __name__=='__main__':main()
