"""Isolated browser session-history, shuffle, harmonic ordering and saved-pair tests."""
import copy,json,pathlib,shutil,subprocess,sys,tempfile,time,urllib.request,xml.etree.ElementTree as ET
from playwright.sync_api import sync_playwright
from test_server import prepare

def main():
    with tempfile.TemporaryDirectory() as temp:
        root=pathlib.Path(temp);xml=prepare(root);tree=ET.parse(xml);collection=tree.getroot().find('COLLECTION')
        third=copy.deepcopy(collection[0]);third.set('TrackID','1003');third.set('Name','Tone 3');third.set('AverageBpm','121')
        shutil.copyfile(root/'tone-0.wav',root/'tone-3.wav');third.set('Location','file://localhost/'+str(root/'tone-3.wav').replace('\\','/'));collection.append(third)
        alias=copy.deepcopy(collection[0]);alias.set('TrackID','1004');alias.set('Name','Alias of Tone 1');collection.append(alias);collection.set('Entries','4');tree.write(xml)
        base='http://127.0.0.1:4193';server=subprocess.Popen([sys.executable,str(pathlib.Path(__file__).with_name('server.py')),'--xml',str(xml),'--state',str(root/'state'),'--port','4193','--public'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            def get(path):
                with urllib.request.urlopen(base+path,timeout=20) as r:return json.load(r)
            for _ in range(100):
                try:get('/library');break
                except OSError:time.sleep(.05)
            req=urllib.request.Request(base+'/favorites/1002',method='PUT',data=b'{"favorite":true}',headers={'Content-Type':'application/json'})
            with urllib.request.urlopen(req):pass
            with sync_playwright() as p:
                browser=p.chromium.launch(channel='msedge',headless=True)
                try:
                    page=browser.new_page(viewport={'width':390,'height':844});errors=[];requests=[]
                    page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url))
                    page.add_init_script('''window.audios=[];const N=window.Audio;window.Audio=function(...args){const a=new N(...args);audios.push(a);return a;};window.Audio.prototype=N.prototype;''')
                    page.route('**/stream/connection.json',lambda r:r.fulfill(json={'server':base}))
                    def ready():page.wait_for_selector('#room',state='visible')
                    def playing():page.wait_for_function('audios.some(a=>!a.paused&&a.currentTime>1)',timeout=30000)
                    def heard(n):page.wait_for_function('(x)=>x.el.textContent.startsWith(x.n)',arg={'el':page.locator('#sample-count').element_handle(),'n':str(n)})
                    page.goto('http://127.0.0.1:4187/stream/');ready()
                    assert page.locator('.track').count()==3,'Duplicate source reference was not removed'
                    page.locator('#skip-favorites').check();page.locator('#queue-order').select_option('shuffle');page.locator('#play').click();playing();heard(1)
                    first=page.locator('#now-title').inner_text();assert first!='Tone 2'
                    page.locator('#next').click();heard(2);playing();second=page.locator('#now-title').inner_text();assert second!=first and second!='Tone 2'
                    page.locator('#next').click();assert page.locator('#now-title').inner_text()==second
                    page.locator('#previous').click();assert page.locator('#now-title').inner_text()==second
                    page.locator('#save-transition').click();page.wait_for_function('(el)=>el.children.length===1',arg=page.locator('#transition-pairs').element_handle())
                    page.wait_for_function('(el)=>el.textContent.includes(String.fromCharCode(83,97,118,101,100))',arg=page.locator('#status').element_handle())
                    pairs=get('/transitions')['pairs'];assert len(pairs)==1 and {pairs[0]['from'],pairs[0]['to']}=={'1001','1003'}
                    page.reload();ready();assert page.locator('#play').is_disabled();heard(2)
                    assert page.locator('#queue-order').input_value()=='shuffle' and page.locator('#skip-favorites').is_checked()
                    page.locator('#playlist').select_option('0');assert page.locator('#play').is_disabled(),'Playlist change replayed a sampled song'
                    page.locator('#reset-samples').click();page.locator('#skip-favorites').uncheck();page.locator('#playlist').select_option('all');page.locator('#queue-order').select_option('harmonic')
                    page.locator('#play').click();playing();heard(1)
                    page.wait_for_function('(el)=>el.textContent.includes(String.fromCharCode(66,80,77,32,100,105,102,102,101,114,101,110,99,101))',arg=page.locator('#recommendation-note').element_handle(),timeout=30000)
                    assert page.locator('#next-title').inner_text()=='Tone 3'
                    page.locator('#next').click();playing();heard(2);assert page.locator('#now-title').inner_text()=='Tone 3'
                    assert len([u for u in requests if '/energy/' in u])<=6
                    page.locator('#reset-samples').click();page.locator('#playlist').select_option('transitions')
                    button=page.locator('#transition-pairs button').first;assert button.is_enabled();button.click();playing();heard(1)
                    expected='Tone 1' if pairs[0]['from']=='1001' else 'Tone 3';assert page.locator('#now-title').inner_text()==expected
                    page.locator('#next').click();playing();heard(2);assert page.locator('#now-title').inner_text()!=expected
                    page.locator('#reset-samples').click();page.locator('#playlist').select_option('all');page.locator('#playback-mode').select_option('mix');page.locator('#play').click();playing();heard(1)
                    page.wait_for_function('(el)=>el.textContent.includes(String.fromCharCode(66,80,77,32,100,105,102,102,101,114,101,110,99,101))',arg=page.locator('#recommendation-note').element_handle(),timeout=30000)
                    assert page.locator('#next-title').inner_text()=='Tone 3'
                    page.locator('#jump').click();heard(2);playing();assert page.locator('#now-title').inner_text()=='Tone 3'
                    page.locator('#playback-mode').select_option('preview');playing();heard(2)
                    assert page.locator('#now-title').inner_text()=='Tone 3','Mode change replayed another sampled song'
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not errors,errors
                    page.locator('#disconnect').click()
                    print('PASS shuffle, duplicate-file exclusion, no repeats on next/back/reload/playlist change, optional Favorite exclusion, reset, harmonic+energy ranking, global ordered pair saving and pair audition, mobile layout')
                finally:browser.close()
        finally:server.terminate();server.wait(timeout=10)

if __name__=='__main__':main()
