"""Check renamed artist site and booking payload without sending mail."""
import functools,http.server,json,pathlib,threading
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[1]/'DJ Bolus Website'
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
s=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(root)))
threading.Thread(target=s.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        b=p.chromium.launch(channel='msedge',headless=True);page=b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.route('**/*.mp4',lambda r:r.abort());page.route('https://w.soundcloud.com/**',lambda r:r.fulfill(body='Player'))
        sent=[]
        def mail(route):
            sent.append(json.loads(route.request.post_data));route.fulfill(json={'success':'true'})
        page.route('https://formsubmit.co/ajax/**',mail)
        page.goto(f'http://127.0.0.1:{s.server_port}/');page.evaluate('document.fonts.ready')
        assert page.title()=='Trillium — Deep & Melodic House'
        assert 'Bolus' not in page.locator('body').inner_text() and 'BOLUS' not in page.locator('body').inner_text()
        for w,h in [(320,740),(390,844),(844,390),(1440,1000)]:
            page.set_viewport_size({'width':w,'height':h})
            for selector in ['.hero h1','.booking-heading h2']:
                r=page.locator(selector).bounding_box();assert r['x']>=0 and r['x']+r['width']<=w+1,(w,selector,r)
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.locator('input[name=name]').fill('Test Person');page.locator('input[name=email]').fill('test@example.com');page.locator('textarea[name=details]').fill('Automated test, intercepted locally.')
        page.locator('.booking-form button').click();page.wait_for_function('document.querySelector(\'.form-status\').textContent.includes(\'sent\')')
        assert sent[0]['_subject'].startswith('New Trillium') and sent[0]['_cc']=='chriscbolus@gmail.com'
        assert page.locator('a[href="https://soundcloud.com/bolus"]').count()>0
        assert page.locator('a[href="https://ra.co/dj/bolus"]').count()>0
        assert not errors,errors
        b.close();print('PASS Trillium branding, 4 responsive viewports, old social URLs preserved, booking payload mocked with both recipients unchanged')
finally:s.shutdown();s.server_close()
