"""Separate, persistent favorites lists and adjacent mobile heart controls."""
import json,pathlib,subprocess,sys,tempfile,time,urllib.request
from playwright.sync_api import sync_playwright
from test_server import prepare

def main():
    with tempfile.TemporaryDirectory() as tmp:
        root=pathlib.Path(tmp);xml=prepare(root);base='http://127.0.0.1:4194'
        server=subprocess.Popen([sys.executable,str(pathlib.Path(__file__).with_name('server.py')),'--xml',str(xml),'--state',str(root/'state'),'--port','4194','--public'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                try:urllib.request.urlopen(base+'/library',timeout=2).close();break
                except OSError:time.sleep(.05)
            with sync_playwright() as p:
                browser=p.chromium.launch(channel='msedge',headless=True)
                try:
                    page=browser.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                    page.route('**/stream/connection.json',lambda r:r.fulfill(json={'server':base}))
                    page.goto('http://127.0.0.1:4187/stream/');page.wait_for_selector('#room',state='visible')
                    def count(id,n):page.wait_for_function('(x)=>x.el.textContent===x.n',arg={'el':page.locator(id).element_handle(),'n':str(n)})
                    for width in [320,390,1440]:
                        page.set_viewport_size({'width':width,'height':900});a=page.locator('#favorite-current').bounding_box();b=page.locator('#halloween-current').bounding_box()
                        assert a['height']==b['height']==112 and a['x']<b['x'] and a['y']==b['y']
                        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                    page.set_viewport_size({'width':390,'height':844})
                    page.locator('#halloween-current').click();count('#halloween-count',1);count('#favorite-count',0)
                    page.locator('#favorite-current').click();count('#favorite-count',1);count('#halloween-count',1)
                    page.locator('#favorite-current').click();count('#favorite-count',0);assert page.locator('#halloween-current').get_attribute('aria-pressed')=='true'
                    page.locator('#next').click();page.wait_for_function('(el)=>el.textContent.includes(String.fromCharCode(80,97,117,115,101))',arg=page.locator('#play').element_handle(),timeout=30000)
                    page.locator('#halloween-current').click();count('#halloween-count',2)
                    page.locator('#favorite-current').click();count('#favorite-count',1)
                    page.locator('#halloween-favorites').click();assert page.locator('#queue-title').inner_text()=='Halloween Party Favorites'
                    assert page.locator('.track strong').all_text_contents()==['Tone 1','Tone 2']
                    page.locator('#favorites').click();assert page.locator('.track strong').all_text_contents()==['Tone 2']
                    page.reload();page.wait_for_selector('#room',state='visible');count('#favorite-count',1);count('#halloween-count',2)
                    page.locator('#playlist').select_option('favorites-halloween');assert page.locator('#halloween-favorites').get_attribute('aria-pressed')=='true'
                    page.locator('#reset-samples').click();page.locator('#skip-favorites').check();assert page.locator('#play').is_disabled()
                    assert not errors,errors
                    page.locator('#disconnect').click()
                    print('PASS independent normal/Halloween membership and removal, two adjacent 112px hearts, persisted lists, separate playlist views, BPM ordering, Favorite exclusions and mobile widths')
                finally:browser.close()
        finally:server.terminate();server.wait(timeout=10)

if __name__=='__main__':main()
