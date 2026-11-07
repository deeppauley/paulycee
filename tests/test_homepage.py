"""Check the homepage remix playlist and current/past event layout."""
import functools,http.server,json,pathlib,threading
from playwright.sync_api import sync_playwright

ROOT=pathlib.Path(__file__).resolve().parents[1]
SHOTS=pathlib.Path(r'C:\Users\paule\Desktop\Pauly Cee Stream Server\Website November Update')
SHOTS.mkdir(parents=True,exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        # Match GitHub Pages byte-range support for realistic native-audio seeking.
        if self.path.split('?')[0].endswith('.mp3'):
            data=pathlib.Path(self.translate_path(self.path)).read_bytes();start,end=0,len(data)-1
            partial=self.headers.get('Range','').startswith('bytes=')
            if partial:
                first,last=self.headers['Range'][6:].split('-');start=int(first or 0);end=min(int(last) if last else end,end)
            self.send_response(206 if partial else 200);self.send_header('Content-Type','audio/mpeg');self.send_header('Accept-Ranges','bytes')
            if partial:self.send_header('Content-Range',f'bytes {start}-{end}/{len(data)}')
            self.send_header('Content-Length',str(end-start+1));self.end_headers()
            try:self.wfile.write(data[start:end+1])
            except (ConnectionResetError,BrokenPipeError):pass
        else:super().do_GET()
    def copyfile(self,*args):
        try:super().copyfile(*args)
        except (ConnectionResetError,BrokenPipeError):pass

def run(root):
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(root)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            b=p.chromium.launch(channel='msedge',headless=True)
            page=b.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.route('**/*.mp4',lambda r:r.abort())
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.wait_for_function('document.querySelector(\'.remix-audio\').readyState>=1')
            assert page.locator('.remix-track-select option').count()==2
            assert page.locator('.remix-details strong').inner_text()=='ANOTHER ONE'
            assert page.locator('#upcoming .event-directory article').count()==1
            assert page.locator('#harvard-night-market time').get_attribute('datetime')=='2026-11-14T19:30:00-05:00'
            assert '7:30 PM' in page.locator('#harvard-night-market').inner_text()
            assert page.locator('#past-events #halloween-event .halloween-photo').count()==1
            assert page.locator('#past-events #asian-food-beer-festival').count()==1
            assert page.locator('#asian-food-beer-festival .beer-festival-photo').count()==1
            graph=json.loads(page.locator('script[type="application/ld+json"]').first.text_content())['@graph']
            assert next(e for e in graph if e['@id'].endswith('#harvard-night-market'))['startDate']=='2026-11-14T19:30:00-05:00'
            page.locator('.remix-play').click();page.wait_for_function('document.querySelector(\'.remix-audio\').currentTime>.1')
            page.locator('.remix-next').click();page.wait_for_function('document.querySelector(\'.remix-audio\').currentSrc.includes(\'movin-to-the-sun\')&&!document.querySelector(\'.remix-audio\').paused')
            assert page.locator('.remix-track-select').input_value()=='1'
            assert page.locator('.remix-details strong').inner_text()=="MOVIN' TO THE SUN"
            page.wait_for_function('Number.isFinite(document.querySelector(\'.remix-audio\').duration)')
            page.wait_for_function('document.querySelector(\'.remix-audio\').currentTime>.1')
            page.locator('.remix-seek').evaluate('(el)=>{el.value=50;el.dispatchEvent(new Event(\'input\'));}')
            page.wait_for_function('Math.abs(document.querySelector(\'.remix-audio\').currentTime-document.querySelector(\'.remix-audio\').duration/2)<2')
            page.locator('.remix-previous').click();page.wait_for_function('document.querySelector(\'.remix-audio\').currentSrc.includes(\'another-one\')&&!document.querySelector(\'.remix-audio\').paused')
            page.wait_for_function('document.querySelector(\'.remix-audio\').readyState>=1&&Number.isFinite(document.querySelector(\'.remix-audio\').duration)')
            page.locator('.remix-audio').evaluate('(a)=>a.currentTime=a.duration-.1')
            page.wait_for_function('document.querySelector(\'.remix-track-select\').value===\'1\'')
            page.locator('.remix-play').click()
            page.locator('.remix-track-select').select_option('0')
            assert page.locator('.remix-audio').evaluate('(a)=>a.paused')
            for width,height in [(320,740),(390,844),(844,390),(1440,1000)]:
                page.set_viewport_size({'width':width,'height':height});page.evaluate('document.fonts.ready')
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
                for selector in ['.remix-controls','.remix-details','.remix-time']:
                    rect=page.locator(selector).bounding_box();assert rect['x']>=0 and rect['x']+rect['width']<=width+1,(width,selector,rect)
                if root==ROOT and width in (390,1440):
                    page.locator('.remix-player').screenshot(path=str(SHOTS/f'player-{width}.png'))
                    page.locator('#halloween-event').screenshot(path=str(SHOTS/f'halloween-{width}.png'))
                    page.locator('#asian-food-beer-festival').screenshot(path=str(SHOTS/f'beer-festival-{width}.png'))
            assert not errors,errors
            b.close();print(root.name+': PASS ordered two-track playlist, playback/seek/auto-next, pause, November 14 date/time/schema, past events/photo and mobile/desktop layout')
    finally:server.shutdown();server.server_close()

if __name__=='__main__':
    run(ROOT)
    run(ROOT/'dist')
