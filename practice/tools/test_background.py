"""Native audio regression test; a real iPhone lock test is still required."""
import argparse,pathlib
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--key-file');p.add_argument('--url',default='http://127.0.0.1:4187/practice/');a=p.parse_args()
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport={'width':390,'height':844});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(a.url)
    if a.key_file:
        page.locator('#access-key').fill(pathlib.Path(a.key_file).read_text().strip())
        page.locator('#unlock-form button').click()
    page.wait_for_selector('#room',state='visible')
    page.locator('#playback-mode').select_option('background')
    assert page.locator('#preview').is_enabled()
    page.locator('#play').click()
    page.wait_for_function("document.querySelector('audio').currentTime>1",timeout=60000)
    assert page.evaluate("!!navigator.mediaSession.metadata.title")
    first=page.evaluate('navigator.mediaSession.metadata.title')
    page.locator('#play').click();assert page.evaluate("document.querySelector('audio').paused")
    page.locator('#play').click();page.wait_for_function("!document.querySelector('audio').paused")
    page.wait_for_timeout(1500)
    page.evaluate("document.querySelector('audio').currentTime=document.querySelector('audio').duration-.3")
    page.wait_for_function('(first)=>navigator.mediaSession.metadata.title!==first',arg=first,timeout=60000)
    page.wait_for_function("document.querySelector('audio').currentTime>1 && !document.querySelector('audio').paused")
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.locator('#playback-mode').select_option('mix');assert page.evaluate("document.querySelector('audio').paused && !document.querySelector('audio').getAttribute('src')")
    assert page.locator('#preview').is_enabled()
    page.locator('#playback-mode').select_option('background');page.locator('#play').click()
    page.wait_for_function("!document.querySelector('audio').paused")
    page.locator('#playback-mode').select_option('mix')
    assert page.evaluate("document.querySelector('audio').paused && !document.querySelector('audio').getAttribute('src')")
    assert not errors,errors
    print('PASS: native AAC playback, pause/resume, automatic next track, Media Session titles, mobile width, mode switching, lock cleanup. Physical iPhone not tested.')
    browser.close()
