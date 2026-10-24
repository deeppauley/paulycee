"""Source + production browser checks; no live site or external writes."""
import functools,http.server,pathlib,threading
from playwright.sync_api import sync_playwright

ROOT=pathlib.Path(__file__).resolve().parents[1]
SHOTS=pathlib.Path(r'C:\Users\paule\Desktop\Pauly Cee Stream Server\Wristband Preview')
SHOTS.mkdir(parents=True,exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass

MOCK='''
window.calls={wake:0,release:0,fullscreen:0,orientation:0};window.testHidden=false;
Object.defineProperty(document,'visibilityState',{get:()=>window.testHidden?'hidden':'visible',configurable:true});
Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{request:async()=>{
  calls.wake++;const lock=new EventTarget();lock.release=async()=>{calls.release++;lock.dispatchEvent(new Event('release'));};return lock;
}}});
Element.prototype.requestFullscreen=async()=>{calls.fullscreen++;throw new Error('Denied');};
'''

def run(root,production=False):
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(root)))
    threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='msedge',headless=True)
            try:
                page=browser.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                page.add_init_script(MOCK)
                page.goto(base+'/QR/');page.locator('#wristband-link').wait_for()
                assert page.locator('#main-link').get_attribute('href')=='https://paulycee.com'
                assert page.locator('#tiktok-link').get_attribute('href')=='https://www.tiktok.com/@paulycee'
                assert 'starting at 5 PM' in page.locator('#wristband-link').inner_text()
                if not production:page.screenshot(path=str(SHOTS/'qr-mobile.png'),full_page=True)
                page.locator('#wristband-link').click();assert page.url==base+'/light-me-up/'
                page.reload();page.locator('#start').wait_for();page.evaluate('document.fonts.ready')
                assert page.evaluate('document.fonts.check(\'900 30px Unbounded\')')
                assert page.locator('#welcome').is_visible();assert 'starting at 5 PM' in page.locator('#welcome .offer').inner_text()
                page.locator('#start').click();page.wait_for_timeout(100)
                assert page.locator('#signal').is_visible();assert page.evaluate('calls.fullscreen')==1
                assert page.evaluate('calls.wake')==1
                for width,height in [(390,844),(844,390),(320,568),(568,320),(360,640),(640,360),(1024,768)]:
                    page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(50)
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,height,'horizontal overflow')
                    assert page.evaluate('document.documentElement.scrollHeight<=innerHeight+1'),(width,height,'vertical overflow')
                    for selector in ['.artist-logo','#signal h2','#signal .offer','.instruction','#exit']:
                        r=page.locator(selector).bounding_box()
                        assert r and r['x']>=0 and r['y']>=0 and r['x']+r['width']<=width+1 and r['y']+r['height']<=height+1,(width,height,selector,r)
                    assert 'starting at 5 PM' in page.locator('#signal .offer').text_content()
                    if not production and width in (390,844):page.screenshot(path=str(SHOTS/f'glow-{width}x{height}.png'))
                page.evaluate('testHidden=true;document.dispatchEvent(new Event(\'visibilitychange\'))');page.wait_for_timeout(50)
                assert page.evaluate('calls.release')==1
                page.evaluate('testHidden=false;document.dispatchEvent(new Event(\'visibilitychange\'))');page.wait_for_timeout(50)
                assert page.evaluate('calls.wake')==2
                page.evaluate('window.dispatchEvent(new Event(\'pagehide\'))');page.wait_for_timeout(50)
                page.evaluate('window.dispatchEvent(new Event(\'pageshow\'))');page.wait_for_timeout(50)
                assert page.evaluate('calls.wake')==3
                page.locator('#exit').click();assert page.locator('#welcome').is_visible()
                assert page.evaluate('calls.release')==3
                assert page.locator('#start').evaluate('(el)=>el===document.activeElement')
                page.emulate_media(reduced_motion='reduce');page.locator('#start').click()
                assert page.locator('.frame').evaluate('(el)=>getComputedStyle(el).animationName')=='none'
                assert page.locator('.logo-halo').evaluate('(el)=>getComputedStyle(el).animationName')=='none'
                page.keyboard.press('Escape');assert page.locator('#welcome').is_visible()
                page.evaluate('Object.defineProperty(navigator,\'wakeLock\',{value:{request:async()=>{throw new Error(\'Denied\');}},configurable:true})')
                page.locator('#start').click();page.wait_for_timeout(50);assert page.locator('#signal').is_visible()
                page.locator('#exit').click()
                page.evaluate('Object.defineProperty(navigator,\'wakeLock\',{value:undefined});document.documentElement.requestFullscreen=undefined')
                page.locator('#start').click();assert page.locator('#signal').is_visible();page.locator('#exit').click()
                page.locator('.back').click();assert page.url==base+'/QR/'
                assert not errors,errors
                print(('PRODUCTION' if production else 'SOURCE')+': PASS QR links/CTA, route refresh, existing logo font, timing, 7 viewport sizes, API denial/absence, wake lifecycle, reduced motion, exit/focus/back')
            finally:browser.close()
    finally:server.shutdown();server.server_close()

if __name__=='__main__':
    run(ROOT)
    if (ROOT/'dist/light-me-up/index.html').exists():run(ROOT/'dist',True)
