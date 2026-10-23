"""Only explicit search-result clicks may override sampling/Favorite exclusions."""
import json,pathlib,subprocess,sys,tempfile,time,urllib.request
from playwright.sync_api import sync_playwright
from test_server import prepare

def main():
    with tempfile.TemporaryDirectory() as tmp:
        root=pathlib.Path(tmp);xml=prepare(root);base='http://127.0.0.1:4195'
        server=subprocess.Popen([sys.executable,str(pathlib.Path(__file__).with_name('server.py')),'--xml',str(xml),'--state',str(root/'state'),'--port','4195','--public'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                try:urllib.request.urlopen(base+'/library',timeout=2).close();break
                except OSError:time.sleep(.05)
            def favorite(path):
                req=urllib.request.Request(base+path,method='PUT',data=b'{"favorite":true}',headers={'Content-Type':'application/json'})
                with urllib.request.urlopen(req):pass
            with sync_playwright() as p:
                browser=p.chromium.launch(channel='msedge',headless=True)
                try:
                    page=browser.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                    page.add_init_script('''window.audios=[];const N=window.Audio;window.Audio=function(...args){const a=new N(...args);audios.push(a);return a;};window.Audio.prototype=N.prototype;''')
                    page.route('**/stream/connection.json',lambda r:r.fulfill(json={'server':base}))
                    def playing():page.wait_for_function('(el)=>el.textContent.includes(String.fromCharCode(80,97,117,115,101))',arg=page.locator('#play').element_handle(),timeout=30000)
                    def count(n):page.wait_for_function('(x)=>x.el.textContent.startsWith(x.n)',arg={'el':page.locator('#sample-count').element_handle(),'n':str(n)+' '})
                    page.goto('http://127.0.0.1:4187/stream/');page.wait_for_selector('#room',state='visible');page.locator('#play').click();playing();count(1)
                    page.locator('#next').click();playing();count(2)
                    page.locator('#search').fill('Tone 1');button=page.locator('.track button').last;assert button.is_enabled();button.click();playing();count(2)
                    assert page.locator('#now-title').inner_text()=='Tone 1'
                    page.evaluate('audios[0].currentTime=audios[0].duration-.2');page.wait_for_timeout(1000)
                    assert page.evaluate('audios[0].paused'),'Search query leaked into automatic repeat behavior'
                    favorite('/favorites/1002');favorite('/favorites/halloween/1001')
                    page.reload();page.wait_for_selector('#room',state='visible');page.locator('#skip-favorites').check();assert page.locator('#play').is_disabled();count(2)
                    page.locator('#search').fill('Tone 2');assert page.locator('.track button').last.is_enabled();assert page.locator('#play').is_disabled()
                    page.locator('.track button').last.click();playing();count(2);assert page.locator('#now-title').inner_text()=='Tone 2'
                    page.locator('#search').fill('');assert page.locator('.track').filter(has_text='Tone 1').locator('button').last.is_disabled()
                    page.locator('#next').click();assert page.locator('#now-title').inner_text()=='Tone 2'
                    page.locator('#playback-mode').select_option('mix');playing();page.locator('#search').fill('Tone 1');page.locator('.track button').last.click();playing();count(2)
                    assert page.locator('#now-title').inner_text()=='Tone 1'
                    page.locator('#next').click();assert page.locator('#now-title').inner_text()=='Tone 1'
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not errors,errors
                    page.locator('#disconnect').click()
                    print('PASS explicit search replay of heard/normal-Favorite/Halloween-Favorite songs in Preview and Automix; search alone never starts playback; history intact; automatic/Next exclusions still enforced')
                finally:browser.close()
        finally:server.terminate();server.wait(timeout=10)

if __name__=='__main__':main()
