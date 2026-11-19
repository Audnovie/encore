#!/usr/bin/env python3
"""Lyrics through the usual home-server setup: nginx serving Encore and passing /rest/ to Navidrome on the same address,
signed in with the Server box left empty. Needs the test nginx on 127.0.0.1:4540 (see nginx-test in the scratchpad),
Navidrome on 4533 and the LRCLIB stand-in on 8091."""
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4540/'
results, errors = [], []
def check(name, ok, detail=''):
    results.append(ok)
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  -- {detail}'))

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 402, 'height': 874}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE)
    page.fill('#lg-user', 'tester'); page.fill('#lg-pass', 'lyrics-test-pw'); page.tap('.lg-btn')
    page.wait_for_function('window.__encore && __encore.api && document.querySelector("#login").hidden', timeout=15000)
    check('signed in with Server left empty', page.evaluate('__encore.api.server') == '')
    page.evaluate("__encore.LRCLIB.base = 'http://127.0.0.1:8091/api/'")
    page.evaluate("async () => { window.__songs = await __encore.Lib.allSongs(); }")
    def play(title):
        page.evaluate("(t) => __encore.Player.playList(__songs, __songs.findIndex(s => s.title === t), 'Test')", title)
    def lyrics():
        if not page.evaluate('__encore.NP.isOpen'): page.evaluate('__encore.NP.open()'); page.wait_for_timeout(600)
        if page.evaluate('__encore.NP.mode') != 'lyrics': page.tap('#np [data-np="lyrics"]')
        page.wait_for_function("__encore.LyView.status !== 'loading' && __encore.LyView.songId === __encore.Player.cur.id", timeout=15000)
        return page.evaluate("({ s: __encore.LyView.status, src: __encore.LyView.res && __encore.LyView.res.source, synced: !!(__encore.LyView.res && __encore.LyView.res.synced) })")
    play('Paper Lanterns'); r = lyrics()
    check('server lyrics through nginx /rest/', r == {'s': 'ok', 'src': 'server', 'synced': True}, r)
    page.wait_for_timeout(1500)
    t1 = page.evaluate('__encore.Player.time()')
    check('audio streams through nginx', page.evaluate('__encore.Player.playing') and t1 > 0.5, t1)
    page.tap('#np .npl .ll:text-is("Paper lanterns, paper lanterns")'); page.wait_for_timeout(800)
    t2 = page.evaluate('__encore.Player.time()')
    check('tap a line seeks through the proxy', 52 <= t2 <= 54, t2)
    play('Hollow Weather'); r = lyrics()
    check('LRCLIB lookup from the same-origin page', r == {'s': 'ok', 'src': 'lrclib', 'synced': True}, r)
    b.close()

check('no script errors', not errors, errors)
print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
