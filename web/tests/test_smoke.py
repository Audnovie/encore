#!/usr/bin/env python3
"""Quick regression pass over the rest of Encore (demo library): library pages, playing, mini player, Now Playing,
queue, song menu, Add to Playlist with its "already in playlist" line, radio, Settings."""
import os, sys
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8084/'
SHOTS = sys.argv[1] if len(sys.argv) > 1 else 'shots'
os.makedirs(SHOTS, exist_ok=True)
results, errors = [], []
def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  -- {detail}'))

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 402, 'height': 874}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE)
    page.tap('[data-act="demo"]')
    page.wait_for_function('__encore.api && __encore.api.demo'); page.wait_for_timeout(800)
    cats = page.evaluate("Array.from(document.querySelectorAll('.cat')).map(c => c.dataset.view)")
    check('library categories', cats == ['playlists', 'artists', 'albums', 'songs', 'stats'], cats)
    page.tap('.cat[data-view="songs"]'); page.wait_for_timeout(1200)
    rows = page.query_selector_all('.page.top .srow, .srow')
    check('songs list shows rows', len(rows) > 5, len(rows))
    first = page.query_selector('.srow')
    first.tap(); page.wait_for_timeout(800)
    cur = page.evaluate('__encore.Player.cur && __encore.Player.cur.title')
    check('tapping a song plays it', bool(cur) and page.evaluate('__encore.Player.playing'), cur)
    mini = page.evaluate("document.querySelector('#mini') && document.querySelector('#mini').innerText")
    check('mini player shows the song', cur and cur in (mini or ''), mini)
    page.tap('#mini .mini-t, #mini') ; page.wait_for_timeout(800)
    check('Now Playing opens from the mini player', page.evaluate('__encore.NP.isOpen'))
    page.tap('#np [data-np="queue"]'); page.wait_for_timeout(700)
    check('queue shows songs', len(page.query_selector_all('#np .qrow')) > 3)
    page.tap('#np [data-np="queue"]'); page.wait_for_timeout(500)
    before_id = page.evaluate('__encore.Player.cur.id')
    page.tap('#np [data-np="next"]'); page.wait_for_timeout(500)
    check('next song', page.evaluate('__encore.Player.cur.id') != before_id)
    page.tap('#np [data-np="lyrics"]'); page.wait_for_timeout(1200)
    page.wait_for_function("__encore.LyView.status !== 'loading'", timeout=10000)
    demo = page.evaluate("({ s: __encore.LyView.status, src: __encore.LyView.res && __encore.LyView.res.source })")
    check('lyrics view in demo (made-up lyrics or No Lyrics, never LRCLIB)', demo['s'] == 'none' or demo['src'] == 'demo', demo)
    page.tap('#np [data-np="close"]'); page.wait_for_timeout(800)
    check('Now Playing closes', not page.evaluate('__encore.NP.isOpen'))

    # song menu -> Add to a Playlist… twice into the same playlist
    row = page.query_selector('.srow')
    song_title = row.query_selector('.t1').inner_text()
    btn = row.query_selector('[data-act="song-more"]')
    if btn: btn.tap()
    else: page.evaluate("(r) => r.dispatchEvent(new Event('contextmenu', {bubbles: true}))", row)
    page.wait_for_timeout(700)
    labels = page.evaluate("Array.from(document.querySelectorAll('.sheet button, .sheet .it')).map(x => x.innerText.trim()).filter(Boolean)")
    check('song menu opens', any('Add to a Playlist' in l for l in labels), labels)
    page.evaluate("Array.from(document.querySelectorAll('.sheet button, .sheet .it')).find(x => x.innerText.includes('Add to a Playlist')).click()")
    page.wait_for_timeout(1200)
    page.screenshot(path=f'{SHOTS}/s1-add-to-playlist.png')
    items = page.evaluate("Array.from(document.querySelectorAll('.pk-row')).map(x => x.innerText)")
    check('Add to Playlist lists playlists', len(items) >= 3, items)
    page.evaluate("document.querySelector('.pk-row').click()"); page.wait_for_timeout(1500)
    row = page.query_selector('.srow'); btn = row.query_selector('[data-act="song-more"]'); btn.tap(); page.wait_for_timeout(700)
    page.evaluate("Array.from(document.querySelectorAll('.sheet button, .sheet .it')).find(x => x.innerText.includes('Add to a Playlist')).click()")
    page.wait_for_timeout(1500)
    txt = page.evaluate("document.body.innerText")
    check('second time it says "Song already in playlist"', 'Song already in playlist' in txt, txt[-400:])
    page.keyboard.press('Escape'); page.wait_for_timeout(600)

    # radio tab
    page.tap('#dock [data-tab="radio"]'); page.wait_for_timeout(1200)
    st = page.query_selector('[data-act="station"]')
    check('radio stations listed', st is not None)
    if st:
        st.tap(); page.wait_for_timeout(900)
        page.evaluate('__encore.NP.open()'); page.wait_for_timeout(700)
        check('radio plays without a lyrics button', page.evaluate("__encore.Player.cur.isRadio && document.querySelector('#np [data-np=\"lyrics\"]').hidden"))
        page.evaluate('__encore.NP.close()'); page.wait_for_timeout(600)

    # settings
    page.tap('#dock [data-tab="library"]'); page.wait_for_timeout(800)
    page.evaluate("document.querySelector('[data-act=\"settings\"]').click()"); page.wait_for_timeout(700)
    check('settings opens', page.is_visible('.modal .m-body'))
    page.tap('.modal [data-theme-v="dark"]'); page.wait_for_timeout(300)
    check('theme switch works', page.evaluate("document.documentElement.getAttribute('data-theme')") == 'dark')
    page.tap('.modal [data-theme-v="system"]'); page.wait_for_timeout(300)
    page.tap('.modal .done'); page.wait_for_timeout(700)
    check('settings closes', not page.query_selector('.modal.in'))
    b.close()

check('no script errors', not errors, errors)
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
