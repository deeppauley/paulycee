"""Verify Boston-local welcome expiry, including an already-open page."""
import functools,http.server,json,pathlib,threading
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright

root=pathlib.Path(__file__).resolve().parents[1]
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        b=p.chromium.launch(channel='msedge',headless=True)
        page=b.new_page(viewport={'width':390,'height':844},timezone_id='America/Los_Angeles')
        page.clock.install(time=datetime(2026,10,24,22,59,59,tzinfo=timezone.utc))
        page.goto(f'http://127.0.0.1:{server.server_port}/QR/')
        page.wait_for_selector('#venue-welcome',state='visible')
        assert 'WELCOME TO BOSTON CITY HALL PLAZA' in page.locator('#venue-welcome').inner_text()
        page.clock.fast_forward(1100)
        assert page.locator('#venue-welcome').is_hidden()
        page.reload();assert page.locator('#venue-welcome').is_hidden()
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        event=page.locator('#harvard-night-market')
        assert event.locator('time').get_attribute('datetime')=='2026-11-07'
        assert 'TBD' in event.inner_text()
        schemas=page.locator('script[type="application/ld+json"]').all_text_contents()
        graph=json.loads(schemas[0])['@graph'];entry=next(e for e in graph if e.get('@id','').endswith('#harvard-night-market'))
        assert entry['startDate']=='2026-11-07'
        b.close()
        print('PASS welcome visible before 7 PM Boston time, expires while open and stays hidden on refresh in another timezone; Night Market visible and structured date November 7, time TBD')
finally:server.shutdown();server.server_close()
