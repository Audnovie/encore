#!/usr/bin/env python3
"""End-to-end tests for Encore's lyrics, run against a real Navidrome 0.63.2 (test library from make_music.py)
and the LRCLIB stand-in (lrclib_stub.py). iPhone-sized Chromium. Writes screenshots to SHOTS."""
import json, os, sys, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8084/'
ND = 'http://127.0.0.1:4533'
STUB = 'http://127.0.0.1:8091'
SHOTS = sys.argv[1] if len(sys.argv) > 1 else 'shots'
os.makedirs(SHOTS, exist_ok=True)

results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  -- {detail}'))

def stub_post(path, body=None):
    req = urllib.request.Request(STUB + path, data=json.dumps(body or {}).encode(), method='POST', headers={'content-type': 'application/json'})
    urllib.request.urlopen(req).read()
def stub_log():
    return json.load(urllib.request.urlopen(STUB + '/__log'))
def gets(log):
    return [e for e in log if e['method'] == 'GET']

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 402, 'height': 874}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    cdp = ctx.new_cdp_session(page)
    def touch(kind, x=200, y=520):
        cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [] if kind in ('touchEnd', 'touchCancel') else [{'x': x, 'y': y}]})
    def finger_scroll(dy, x=200, y=320, steps=12):
        # a real touch drag (touchstart, touchmoves, touchend) that scrolls the lyrics; positive dy shows earlier lines
        touch('touchStart', x, y)
        for k in range(1, steps + 1):
            touch('touchMove', x, y + dy * k / steps); page.wait_for_timeout(16)
        touch('touchEnd')
    def lit_offset():
        return page.evaluate("""() => { const box = document.querySelector('#np .npl'), on = box.querySelector('.ll.on');
            if (!on) return null; const r = on.getBoundingClientRect(), b = box.getBoundingClientRect();
            return { off: Math.round(r.top - b.top), h: box.clientHeight, st: Math.round(box.scrollTop) }; }""")
    # 404/500 answers from the LRCLIB stand-in are expected and logged by Chromium; anything else counts
    page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text
            and 'is not allowed by Access-Control-Allow-Headers' not in m.text else None)  # the second one is the deliberate header-refusal test
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.goto(BASE)
    page.fill('#lg-server', ND); page.fill('#lg-user', 'tester'); page.fill('#lg-pass', 'lyrics-test-pw')
    page.tap('.lg-btn')
    page.wait_for_function('window.__encore && __encore.api && !__encore.api.demo && document.querySelector("#login").hidden', timeout=15000)
    page.evaluate("__encore.LRCLIB.base = 'http://127.0.0.1:8091/api/'")
    page.evaluate("async () => { window.__songs = await __encore.Lib.allSongs(); }")
    titles = page.evaluate("__songs.map(s => s.title)")
    check('library loaded from Navidrome', len(titles) == 12, titles)

    def play(title, at=0):
        page.evaluate("""([t, at]) => { const i = __songs.findIndex(s => s.title === t);
            __encore.Player.playList(__songs, i, 'Test'); if (at) __encore.Player.seek(at); }""", [title, at])
    def open_np():
        if not page.evaluate('__encore.NP.isOpen'):
            page.evaluate('__encore.NP.open()'); page.wait_for_timeout(700)
    def lyrics_on():
        open_np()
        if page.evaluate('__encore.NP.mode') != 'lyrics':
            page.tap('#np [data-np="lyrics"]')
        page.wait_for_function("__encore.LyView.status !== 'loading' && __encore.LyView.songId === __encore.Player.cur.id", timeout=15000)
        page.wait_for_timeout(250)
    def state():
        return page.evaluate("""() => { const v = __encore.LyView, r = v.res;
            const on = document.querySelector('#np .npl .ll.on');
            return { status: v.status, source: r && r.source, synced: !!(r && r.synced), instrumental: !!(r && r.instrumental),
                     n: v.lines.length, lines: v.lines.map(l => [l.t, l.text]),
                     on: on ? (on.classList.contains('gap') ? '<gap>' : on.textContent) : null,
                     msg: (document.querySelector('#np .ly-msg') || {}).innerText || '',
                     src: (document.querySelector('#np .ly-src') || {}).textContent || '',
                     plain: !!document.querySelector('#np .ly-lines.plain'),
                     plainText: Array.from(document.querySelectorAll('#np .ly-lines.plain .ll')).map(x => x.textContent) }; }""")
    def seek_wait(t, ms=400):
        page.evaluate(f'__encore.Player.seek({t})'); page.wait_for_timeout(ms)

    # ---- 1. lyrics from an .lrc file next to the song (Navidrome) ----
    stub_post('/__reset')
    play('Paper Lanterns'); page.wait_for_timeout(600)
    open_np()
    page.screenshot(path=f'{SHOTS}/01-player-with-lyrics-button.png')
    btns = page.evaluate("Array.from(document.querySelectorAll('#np .np-bottom button')).filter(b => !b.hidden).map(b => b.dataset.np)")
    check('bottom row: lyrics, shuffle, queue', btns == ['lyrics', 'shuffle', 'queue'], btns)
    lyrics_on()
    st = state()
    check('sidecar .lrc: synced lyrics from the server', st['status'] == 'ok' and st['source'] == 'server' and st['synced'], st)
    check('sidecar .lrc: intro dots + 11 lines + 3 breaks', st['n'] == 15 and st['lines'][0] == [0, ''] and st['lines'][1][0] == 4, st['lines'])
    check('lyrics button shows as on', page.evaluate("document.querySelector('#np [data-np=\"lyrics\"]').classList.contains('on')"))
    seek_wait(30, 1300)
    st = state()
    check('at 0:30 the lit line is "Hold the light until it\'s morning"', st['on'] == "Hold the light until it's morning", st['on'])
    pos = page.evaluate("""() => { const box = document.querySelector('#np .npl'), on = box.querySelector('.ll.on');
        return { off: on.getBoundingClientRect().top - box.getBoundingClientRect().top, h: box.clientHeight, st: box.scrollTop }; }""")
    check('lit line scrolled to about a third of the way down', abs(pos['off'] - 0.3 * pos['h']) < 30 and pos['st'] > 0, pos)
    page.screenshot(path=f'{SHOTS}/02-synced-lyrics.png')
    check('no LRCLIB lookups for a song the server has timed lyrics for', len(gets(stub_log())) == 0, stub_log())
    seek_wait(19, 500)
    check('in a long break the dots are lit', state()['on'] == '<gap>', state()['on'])
    page.screenshot(path=f'{SHOTS}/03-break-dots.png')
    # lines advance by themselves while playing
    seek_wait(57, 300)
    a = state()['on']; page.wait_for_timeout(4500); b2 = state()['on']
    check('the lit line moves on as the song plays', a == 'Floating out across the water' and b2 == 'Paper lanterns, paper lanterns', [a, b2])

    # tap a line to jump there
    page.evaluate("document.querySelector('#np .npl').scrollTop = 0"); page.wait_for_timeout(200)
    page.evaluate("__encore.Player.pause()"); page.wait_for_timeout(200)
    page.evaluate("""() => { const el = Array.from(document.querySelectorAll('#np .npl .ll')).find(x => x.textContent === 'Every lantern needs a fire'); el.scrollIntoView({block: 'center'}); }""")
    page.wait_for_timeout(300)
    page.tap('#np .npl .ll:text-is("Every lantern needs a fire")')
    page.wait_for_timeout(700)
    t = page.evaluate('__encore.Player.time()'); pl = page.evaluate('__encore.Player.playing')
    check('tapping a line jumps to it and plays', 32.4 <= t <= 34 and pl and state()['on'] == 'Every lantern needs a fire', [t, pl, state()['on']])

    # scrolling by hand (a real finger drag) pauses the following, then it snaps back
    page.wait_for_timeout(1200)
    before = page.evaluate("document.querySelector('#np .npl').scrollTop")
    finger_scroll(600); page.wait_for_timeout(300)
    held = page.evaluate("document.querySelector('#np .npl').scrollTop")
    page.wait_for_timeout(1800)
    held_b = page.evaluate("document.querySelector('#np .npl').scrollTop")
    page.wait_for_timeout(2600)
    back = lit_offset()
    check('a finger drag holds the view, then it returns to the lit line',
          held < before - 100 and abs(held_b - held) < 3 and back and abs(back['off'] - 0.3 * back['h']) < 40, [before, held, held_b, back])
    # a tap on a line that isn't followed by scrolling doesn't pause anything (it seeks)
    check('the lit line is marked for screen readers', page.evaluate("document.querySelector('#np .npl .ll.on').getAttribute('aria-current')") == 'true')
    check('the Lyrics button says it is on', page.evaluate("document.querySelector('#np [data-np=\"lyrics\"]').getAttribute('aria-pressed')") == 'true')
    page.mouse.move(200, 400); page.mouse.wheel(0, -400); page.wait_for_timeout(900)
    held2 = page.evaluate("document.querySelector('#np .npl').scrollTop")
    page.wait_for_timeout(3600)
    back2 = page.evaluate("document.querySelector('#np .npl').scrollTop")
    check('a mouse wheel holds it too', back2 > held2 + 30, [held2, back2])

    # ---- 2. timed lyrics stored inside the file, with an [offset:+1000] tag ----
    play('Borrowed Hours'); lyrics_on()
    st = state()
    check('embedded LRC: synced from the server', st['source'] == 'server' and st['synced'], st)
    check('offset applied (6.0 s stamp shows at 5.0 s)', st['lines'][1] == [5, 'Borrowed hours on a borrowed clock'], st['lines'][:3])
    page.evaluate('__encore.Player.pause()'); page.wait_for_timeout(200)
    seek_wait(4.5); a = state()['on']; seek_wait(4.85); b2 = state()['on']
    page.evaluate('__encore.Player.play()')
    check('lit from 4.8 s (0.2 s early), dots before', a == '<gap>' and b2 == 'Borrowed hours on a borrowed clock', [a, b2])

    # ---- 3. server has untimed lyrics, LRCLIB has timed ones -> LRCLIB's ----
    stub_post('/__reset')
    play('Lucky Stations'); lyrics_on()
    st = state(); log = stub_log()
    check('untimed on server + timed on LRCLIB: LRCLIB wins', st['source'] == 'lrclib' and st['synced'], st)
    g = gets(log)
    check('one exact LRCLIB lookup with title, artist, length', len(g) == 1 and g[0]['path'] == '/api/get'
          and g[0]['query'] == {'track_name': 'Lucky Stations', 'artist_name': 'Neon Orchard', 'duration': '90'}, g)
    h = g[0]['headers'] if g else {}
    ver = page.evaluate('__encore.version')
    check(f'sends Lrclib-Client: Encore {ver}', h.get('lrclib-client') == f'Encore {ver} (self-hosted music player)', h)
    check('sends no Referer, no cookies', 'referer' not in h and 'cookie' not in h, h)
    check('the only address sent is the page\'s own Origin (browsers always add it)', h.get('origin') == 'http://127.0.0.1:8084', h.get('origin'))
    pre = [e for e in log if e['method'] == 'OPTIONS']
    check('CORS preflight only asks for the Lrclib-Client header', pre and all(e['headers'].get('access-control-request-headers', '').lower() == 'lrclib-client' for e in pre), pre)

    # ---- 4. server has untimed lyrics, LRCLIB has nothing ----
    stub_post('/__reset')
    play('Northern Signals'); lyrics_on()
    st = state()
    check('untimed server lyrics shown when LRCLIB has none', st['source'] == 'server' and not st['synced'] and st['plain'], st)
    check('plain lyrics keep their lines', st['plainText'][:2] == ['Radio towers blinking red', 'Counting signals in my head'], st['plainText'])
    check('source line says server, not timed', st['src'] == 'Lyrics from your server · not timed to the song', st['src'])
    check('LRCLIB asked at most 3 times', len(gets(stub_log())) == 3, [e['path'] + str(e['query']) for e in gets(stub_log())])
    page.screenshot(path=f'{SHOTS}/04-plain-lyrics.png')

    # ---- 5. LRCLIB exact match ----
    stub_post('/__reset')
    play('Hollow Weather'); lyrics_on()
    st = state()
    check('LRCLIB exact match gives timed lyrics', st['source'] == 'lrclib' and st['synced'] and st['lines'][0] == [3.2, 'Hollow weather in the hall'], st)
    check('source line says LRCLIB, with Wrong lyrics?', st['src'] == 'Lyrics from LRCLIB · Wrong lyrics?', st['src'])

    # ---- 6. a video-style file name ----
    stub_post('/__reset')
    play('Juniper Kites - Glass Rivers (Official Video)'); lyrics_on()
    st = state(); g = gets(stub_log())
    check('"Artist - Song (Official Video)" by "...VEVO" is matched', st['source'] == 'lrclib' and st['synced'] and st['lines'][1][1] == 'Glass rivers under frozen light', st)
    check('…on the cleaned names', g and g[-1]['path'] == '/api/search' and g[-1]['query'] == {'track_name': 'Glass Rivers', 'artist_name': 'Juniper Kites'}, g)

    # ---- 7. LRCLIB's version is 23 s longer -> words without timings ----
    stub_post('/__reset')
    play('Slow Comets'); lyrics_on()
    st = state()
    check('different-length version: shown untimed', st['source'] == 'lrclib' and not st['synced'] and st['plainText'][:2] == ['Slow comets crossing the porch', 'Tails like a borrowed torch'], st)

    # ---- 8. instrumental ----
    play('Quiet Engines'); lyrics_on()
    st = state()
    check('instrumental', st['instrumental'] and st['msg'].startswith('Instrumental'), st)
    page.screenshot(path=f'{SHOTS}/05-instrumental.png')

    # ---- 9. nothing anywhere (and a same-name song by someone else is ignored) ----
    stub_post('/__reset')
    play('Nowhere Postcards'); lyrics_on()
    st = state(); g = gets(stub_log())
    check('no lyrics anywhere -> "No Lyrics"', st['status'] == 'none' and st['msg'].startswith('No Lyrics'), st)
    check('…after 3 requests (exact, search, free text)', [e['path'] for e in g] == ['/api/get', '/api/search', '/api/search'] and g[2]['query'].get('q'), g)
    page.screenshot(path=f'{SHOTS}/06-no-lyrics.png')

    # ---- 10. no artist tag ----
    stub_post('/__reset')
    play('Ivory Hour'); lyrics_on()
    st = state(); g = gets(stub_log())
    check('[Unknown Artist]: free-text search, same length -> timed', st['source'] == 'lrclib' and st['synced'], st)
    check('…one request, without the made-up artist name', len(g) == 1 and g[0]['query'] == {'q': 'Ivory Hour'}, g)

    # ---- 11. a slow answer for an old song must not replace the new song's lyrics ----
    page.evaluate('__encore.Lyrics.clear()')
    stub_post('/__reset'); stub_post('/__control', {'delay': {'hollow weather': 2.5}})
    play('Hollow Weather'); page.wait_for_timeout(300)
    check('shows loading while looking up', page.evaluate('__encore.LyView.status') == 'loading')
    play('Paper Lanterns'); page.wait_for_timeout(1300)
    a = state(); page.wait_for_timeout(2500); b2 = state()
    check('late answer for the previous song is ignored', a['source'] == 'server' and b2['source'] == 'server' and b2['lines'][1][1] == 'Paper lanterns over Mercer Street', [a['lines'][1:2], b2['lines'][1:2]])
    stub_post('/__reset')
    play('Hollow Weather'); lyrics_on()
    check('…and the previous song still gets its own lyrics after', state()['lines'][0][1] == 'Hollow weather in the hall', state()['lines'][:2])

    # ---- 12. errors and Try Again ----
    page.evaluate('__encore.Lyrics.clear()')
    stub_post('/__control', {'mode': 'fail500'})
    play('Juniper Kites - Glass Rivers (Official Video)'); lyrics_on()
    st = state()
    check('LRCLIB error -> "Couldn\'t Load Lyrics" with Try Again', st['status'] == 'error' and 'error 500' in st['msg'] and page.is_visible('#np [data-ly="retry"]'), st)
    page.screenshot(path=f'{SHOTS}/07-error.png')
    stub_post('/__control', {'mode': 'normal'})
    page.tap('#np [data-ly="retry"]')
    page.wait_for_function("__encore.LyView.status !== 'loading'"); page.wait_for_timeout(200)
    check('Try Again works', state()['synced'], state())
    page.evaluate('__encore.Lyrics.clear()')
    page.evaluate("__encore.LRCLIB.base = 'http://127.0.0.1:8099/api/'")
    play('Hollow Weather'); lyrics_on()
    st = state()
    check('LRCLIB unreachable -> friendly message', st['status'] == 'error' and 'Couldn’t reach LRCLIB' in st['msg'], st)
    page.evaluate("__encore.LRCLIB.base = 'http://127.0.0.1:8091/api/'")
    page.evaluate('__encore.Lyrics.clear()')
    play('Northern Signals'); lyrics_on()  # leave the bad state behind
    # if the browser can't send the Lrclib-Client header, Encore asks again without it
    page.evaluate('__encore.Lyrics.clear()')
    stub_post('/__reset'); stub_post('/__control', {'mode': 'strictcors'})
    page.wait_for_timeout(5500); play('Lucky Stations'); lyrics_on()
    g = gets(stub_log())
    check('header refused -> asked again without it, lyrics found', state()['synced'] and g and 'lrclib-client' not in g[-1]['headers']
          and page.evaluate('__encore.LRCLIB.bare'), [state()['status'], [e['headers'].get('lrclib-client') for e in g]])
    stub_post('/__reset'); page.evaluate('__encore.LRCLIB.bare = false; __encore.Lyrics.clear()')

    # ---- 12b. review fixes: touches across a redraw, Try Again position, quick skipping, long tracks ----
    # a finger that lands on the spinner and lifts after the lyrics appear must not stop the following for good
    stub_post('/__reset'); stub_post('/__control', {'delay': {'hollow weather': 2.0}})
    page.evaluate('__encore.Lyrics.clear()'); page.wait_for_timeout(1600)
    play('Hollow Weather'); page.wait_for_timeout(500)
    check('(spinner showing)', page.evaluate('__encore.LyView.status') == 'loading')
    touch('touchStart'); touch('touchMove', 200, 470)
    page.wait_for_function("__encore.LyView.status === 'ok'", timeout=10000); page.wait_for_timeout(200)
    touch('touchEnd')
    seek_wait(50, 3600)  # the finger moved, so following waits 3 s after it lifts
    o = lit_offset()
    check('a touch that spans the redraw doesn\'t freeze the following', o and abs(o['off'] - 0.3 * o['h']) < 40 and o['st'] > 100, o)
    stub_post('/__reset')

    # after Try Again the lit line is brought into view
    page.evaluate('__encore.Lyrics.clear()'); stub_post('/__control', {'mode': 'fail500'})
    page.evaluate('__encore.NP.close()'); page.wait_for_timeout(700)
    play('Hollow Weather'); page.wait_for_timeout(600); page.evaluate('__encore.Player.seek(46)'); page.wait_for_timeout(300)
    lyrics_on()
    check('(error showing)', state()['status'] == 'error', state()['status'])
    stub_post('/__control', {'mode': 'normal'})
    page.tap('#np [data-ly="retry"]')
    page.wait_for_function("__encore.LyView.status === 'ok'"); page.wait_for_timeout(900)
    o = lit_offset()
    check('after Try Again the lit line is in view', o and abs(o['off'] - 0.3 * o['h']) < 40, o)

    # skipping quickly through songs only looks up the one you stop on
    page.evaluate('__encore.Lyrics.clear()'); stub_post('/__reset'); page.wait_for_timeout(1700)
    play('Slow Comets'); page.wait_for_timeout(250); play('Hollow Weather'); page.wait_for_timeout(250); play('Lucky Stations'); page.wait_for_timeout(250); play('Quiet Engines')
    page.wait_for_function("__encore.LyView.status !== 'loading' && __encore.Player.cur.title === 'Quiet Engines'", timeout=15000)
    asked = sorted({e['query'].get('track_name') or e['query'].get('q') for e in gets(stub_log())})
    check('quick skipping: from the second quick change on, songs passed over aren\'t looked up', 'Lucky Stations' not in asked and 'Quiet Engines' in asked and state()['instrumental'], asked)

    # tracks over an hour: LRCLIB only takes lengths up to 3600 s, so none is sent (and nothing errors)
    stub_post('/__reset')
    lr = page.evaluate("async () => { try { const r = await __encore.LRCLIB.find({ title: 'Hollow Weather', artist: 'Juniper Kites', duration: 3700 }); return { ok: true, synced: r && r.synced, n: r && r.lines.length }; } catch (e) { return { ok: false, e: e.message }; } }")
    g = gets(stub_log())
    check('a 61-minute track: no length sent, words shown untimed', lr.get('ok') and lr.get('synced') is False and g and 'duration' not in g[0]['query'], [lr, g[:1]])
    try:
        urllib.request.urlopen(STUB + '/api/get?track_name=x&artist_name=y&duration=3700', timeout=5); code = 200
    except urllib.error.HTTPError as e:
        code = e.code
    check('(the stand-in refuses lengths over 3600 s like LRCLIB)', code == 400, code)

    # "Song - Artist" uploads are found by trying the names the other way round
    stub_post('/__reset')
    sw = page.evaluate("async () => { const r = await __encore.LRCLIB.find({ title: 'Lanterns of Home - Velvet Comet', artist: 'Some Channel', duration: 120 }); return r && { synced: r.synced, first: r.lines[0].text }; }")
    check('"Song - Artist" title from a channel is matched', sw == {'synced': True, 'first': 'Lanterns of home in the window'}, sw)
    # no artist and two different "Intro"s of about the same length: nothing is shown rather than a guess
    amb = page.evaluate("async () => [await __encore.LRCLIB.find({ title: 'Intro', artist: '[Unknown Artist]', duration: 92 }), await __encore.LRCLIB.find({ title: 'Intro', artist: '[Unknown Artist]', duration: 95 })]")
    check('no artist + two same-length "Intro"s -> no guess', amb == [None, None], amb)

    # a hiccup on the server isn't remembered as "no lyrics": once it answers again, its lyrics show
    stub_post('/__reset')
    hic = page.evaluate("""async () => {
        const L = __encore.Lyrics, a = __encore.api, real = a.get.bind(a);
        L.clear();
        const s = __songs.find((x) => x.title === 'Paper Lanterns');
        a.get = (ep, p, o) => (ep === 'getLyricsBySongId' ? Promise.reject(Object.assign(new Error('The music server answered with error 502.'), { code: 'http' })) : real(ep, p, o));
        const first = await L.get(s);
        a.get = real;
        const second = await L.get(s);
        return [first && first.source, second && second.source]; }""")
    check('a server error isn\'t cached: the server\'s own lyrics show once it answers', hic == [None, 'server'], hic)

    # ---- 12c. second review: duet tags, instrumental versions, a finger held across a redraw, cached skips, hiding ----
    # "A, B" in one artist tag (Navidrome keeps it whole): searched by the first artist, accepted for either
    page.evaluate('__encore.Lyrics.clear()'); stub_post('/__reset'); page.wait_for_timeout(1600)
    play('Night Swim'); lyrics_on()
    st = state(); g = gets(stub_log())
    check('"Velvet Comet, Aster Lane" finds LRCLIB\'s "Velvet Comet" entry', st['source'] == 'lrclib' and st['synced'] and st['lines'][1][1] == 'Night swim under the pier lights', [st['status'], [e['query'] for e in g]])
    check('…by searching for the first artist', any(e['query'].get('artist_name') == 'Velvet Comet' for e in g), [e['query'] for e in g])
    # a song named as an instrumental version isn't looked up (LRCLIB would give the sung version, same length)
    stub_post('/__reset'); page.wait_for_timeout(1600)
    play('Hollow Weather - Instrumental'); lyrics_on()
    st = state()
    check('"Song - Instrumental": no online lookup, no sung words', st['status'] == 'none' and 'without the singing' in st['msg'] and not gets(stub_log()), [st['msg'], gets(stub_log())])

    # a finger resting on the lyrics while they're drawn keeps holding them; lifting it without scrolling catches up at once
    page.evaluate('__encore.Lyrics.clear()'); stub_post('/__reset'); stub_post('/__control', {'delay': {'hollow weather': 2.0}})
    page.wait_for_timeout(1600)
    play('Hollow Weather'); page.wait_for_timeout(500)
    touch('touchStart', 200, 400)
    page.wait_for_function("__encore.LyView.status === 'ok'", timeout=10000); page.wait_for_timeout(200)
    seek_wait(50, 1200)
    held = page.evaluate("document.querySelector('#np .npl').scrollTop")
    touch('touchEnd'); page.wait_for_timeout(1200)
    o = lit_offset()
    check('a finger held across the redraw holds the lyrics, and they catch up when it lifts', held < 5 and o and abs(o['off'] - 0.3 * o['h']) < 40, [held, o])
    stub_post('/__reset')

    # quick skipping: a song that was already looked up shows straight away, even mid-burst
    page.evaluate('__encore.Lyrics.clear()'); page.wait_for_timeout(1600)
    play('Paper Lanterns'); lyrics_on()
    play('Borrowed Hours'); lyrics_on(); page.wait_for_timeout(1600)
    t0 = time.time()
    play('Slow Comets'); page.wait_for_timeout(200); play('Quiet Engines'); page.wait_for_timeout(200); play('Paper Lanterns')
    page.wait_for_function("__encore.LyView.status === 'ok' && __encore.Player.cur.title === 'Paper Lanterns'", timeout=10000)
    dt = time.time() - t0 - 0.4
    check('a song already looked up isn\'t held back while skipping', dt < 0.35, round(dt, 3))

    # Wrong lyrics? hides LRCLIB's lyrics for that song (remembered on this device) and can be undone
    stub_post('/__reset')
    play('Hollow Weather'); lyrics_on(); page.wait_for_timeout(300)
    check('LRCLIB lyrics offer "Wrong lyrics?"', page.is_visible('#np [data-ly="hide"]'))
    page.evaluate("document.querySelector('#np [data-ly=\"hide\"]').scrollIntoView({block: 'center'})"); page.wait_for_timeout(300)
    page.tap('#np [data-ly="hide"]'); page.wait_for_timeout(700)
    page.screenshot(path=f'{SHOTS}/10-hide-confirm.png')
    page.evaluate("Array.from(document.querySelectorAll('.al-btn')).find((b) => b.textContent.trim() === 'Hide').click()")
    page.wait_for_function("__encore.LyView.status !== 'loading'"); page.wait_for_timeout(300)
    st = state()
    check('after hiding: "You hid LRCLIB\'s lyrics" with Show Them Again', st['status'] == 'none' and 'You hid' in st['msg'] and page.is_visible('#np [data-ly="unhide"]'), st['msg'])
    check('…remembered on this device', page.evaluate("JSON.parse(localStorage.getItem('encore.lyricsHidden') || '[]').includes(__encore.Player.cur.id)"))
    page.screenshot(path=f'{SHOTS}/11-hidden.png')
    n_before = len(gets(stub_log()))
    page.tap('#np [data-ly="unhide"]')
    page.wait_for_function("__encore.LyView.status === 'ok'"); page.wait_for_timeout(300)
    check('Show Them Again brings them back (no new lookup needed)', state()['synced'] and len(gets(stub_log())) == n_before and not page.evaluate("JSON.parse(localStorage.getItem('encore.lyricsHidden') || '[]').length"), [state()['status'], len(gets(stub_log())), n_before])

    # ---- 12d. third review: labels, readings, paused reading, lost touches, the "…" menu, hiding edge cases ----
    w = page.evaluate("""() => { const L = __encore.lyricsUtil;
        return {
          nowords: ['Hollow Weather - Inst.', 'Hollow Weather (Inst.)', 'Hollow Weather - Backing Track', 'Hollow Weather - MR', 'Hollow Weather (Off Vocal)',
                    'Hollow Weather (Karaoke Version)', 'Karaoke', 'Karaoke Queen', 'Instrumental Love', 'Mr. Brightside', 'Six Ft. Under'].map(L.lyNoWords),
          reprise: L.lyReadings('Hollow Weather - Reprise', 'Juniper Kites'),
          versionUntagged: L.lyReadings('Ivory Hour - Remastered 2011', ''),
          karaoke: L.lyReadings('Hollow Weather (Karaoke Version)', 'Juniper Kites')[0],
          heyJude: L.lyReadings('Hey Jude - Remastered 2015', 'The Beatles'),
        }; }""")
    check('no-singing labels only count in brackets or after " - "; karaoke versions still get lyrics',
          w['nowords'] == [True, True, True, True, True, False, False, False, False, False, False], w['nowords'])
    check('"Song - Reprise" isn\'t searched as the song itself', w['reprise'] == [{'track': 'Reprise', 'artist': 'Hollow Weather'}], w['reprise'])
    check('a version ending is dropped without a junk second reading', w['versionUntagged'] == [{'track': 'Ivory Hour', 'artist': ''}]
          and w['heyJude'] == [{'track': 'Hey Jude', 'artist': 'The Beatles'}], [w['versionUntagged'], w['heyJude']])
    check('"(Karaoke Version)" is searched as the song', w['karaoke'] == {'track': 'Hollow Weather', 'artist': 'Juniper Kites'}, w['karaoke'])
    stub_post('/__reset')
    iv = page.evaluate("async () => { const r = await __encore.LRCLIB.find({ title: 'Ivory Hour - Remastered 2011', artist: '[Unknown Artist]', duration: 77 }); return r && r.synced; }")
    check('untagged "Song - Remastered 2011" is still found', iv is True, iv)

    # while paused, a hand-scrolled view stays put (so you can read ahead or reach "Wrong lyrics?"); playing again catches up
    page.evaluate('__encore.Lyrics.clear()'); stub_post('/__reset')
    play('Hollow Weather'); lyrics_on(); seek_wait(50, 1200)
    page.evaluate('__encore.Player.pause()'); page.wait_for_timeout(300)
    finger_scroll(900); page.wait_for_timeout(4200)
    top_paused = page.evaluate("document.querySelector('#np .npl').scrollTop")
    page.evaluate('__encore.Player.play()'); page.wait_for_timeout(1200)
    o = lit_offset()
    check('paused: no snapping back; playing again: back to the lit line', top_paused < 5 and o and abs(o['off'] - 0.3 * o['h']) < 40, [top_paused, o])

    # a touch whose end never arrives is forgotten at the next touch, and when Encore goes to the background
    page.evaluate("""() => { const b = document.querySelector('#np .npl .ll');
        const t = new Touch({ identifier: 9001, target: b, clientX: 200, clientY: 300 });
        b.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t], targetTouches: [t], changedTouches: [t] })); }""")
    stuck = page.evaluate('[__encore.LyView.hold, __encore.LyView.fingers.size]')
    touch('touchStart', 200, 400); touch('touchEnd'); page.wait_for_timeout(300)
    healed = page.evaluate('[__encore.LyView.hold, __encore.LyView.fingers.size]')
    page.evaluate("""() => { const b = document.querySelector('#np .npl .ll');
        const t = new Touch({ identifier: 9002, target: b, clientX: 200, clientY: 300 });
        b.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
        window.dispatchEvent(new Event('pagehide')); }""")
    healed2 = page.evaluate('[__encore.LyView.hold, __encore.LyView.fingers.size]')
    check('a lost touch end doesn\'t freeze the lyrics', stuck == [True, 1] and healed == [False, 0] and healed2 == [False, 0], [stuck, healed, healed2])

    # the "…" menu offers the same hide / show-again in a fixed place
    page.tap('#np .np-qhead [data-np="more"]'); page.wait_for_timeout(700)
    labels = page.evaluate("Array.from(document.querySelectorAll('.sheet button, .sheet .it')).map(x => x.innerText.trim()).filter(Boolean)")
    check('"…" menu: Wrong Lyrics? Hide Them', any('Wrong Lyrics? Hide Them' in l for l in labels), labels)
    page.evaluate("Array.from(document.querySelectorAll('.sheet button, .sheet .it')).find(x => x.innerText.includes('Wrong Lyrics? Hide Them')).click()")
    page.wait_for_timeout(800)
    page.evaluate("Array.from(document.querySelectorAll('.al-btn')).find((b) => b.textContent.trim() === 'Hide').click()")
    page.wait_for_function("__encore.LyView.status !== 'loading'"); page.wait_for_timeout(400)
    page.tap('#np .np-qhead [data-np="more"]'); page.wait_for_timeout(700)
    labels = page.evaluate("Array.from(document.querySelectorAll('.sheet button, .sheet .it')).map(x => x.innerText.trim()).filter(Boolean)")
    check('…and then Show LRCLIB\'s Lyrics Again', any('Show LRCLIB’s Lyrics Again' in l for l in labels), labels)
    page.evaluate("Array.from(document.querySelectorAll('.sheet button, .sheet .it')).find(x => x.innerText.includes('Show LRCLIB’s Lyrics Again')).click()")
    page.wait_for_function("__encore.LyView.status === 'ok'"); page.wait_for_timeout(300)
    check('…which brings them back', state()['source'] == 'lrclib' and state()['synced'], state()['status'])

    # hiding applies to the song you were looking at, even if the next one started while the question was open
    shown_id = page.evaluate('__encore.Player.cur.id')
    page.wait_for_timeout(600)  # taps are ignored for 350 ms after a menu closes (1.3.1's double-tap guard)
    page.evaluate("document.querySelector('#np [data-ly=\"hide\"]').click()"); page.wait_for_timeout(700)
    play('Paper Lanterns'); page.wait_for_timeout(500)
    page.evaluate("Array.from(document.querySelectorAll('.al-btn')).find((b) => b.textContent.trim() === 'Hide').click()"); page.wait_for_timeout(600)
    lyrics_on()
    hid = page.evaluate("(id) => [__encore.LyHidden.has(id), __encore.LyHidden.has(__encore.Player.cur.id), __encore.LyView.res && __encore.LyView.res.source]", shown_id)
    check('hide answered after the song changed still hides the song you were looking at', hid == [True, False, 'server'], hid)
    page.evaluate("(id) => __encore.LyHidden.set(id, false)", shown_id)

    # if the device can't save it, it still applies for now and says so
    page.evaluate("() => { window.__realSet = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); }; }")
    play('Hollow Weather'); lyrics_on()
    page.evaluate("document.querySelector('#np [data-ly=\"hide\"]').click()"); page.wait_for_timeout(700)
    page.evaluate("Array.from(document.querySelectorAll('.al-btn')).find((b) => b.textContent.trim() === 'Hide').click()")
    page.wait_for_timeout(500)
    toast_txt = page.evaluate("(document.querySelector('#toast') || {}).innerText || ''")
    page.wait_for_function("__encore.LyView.status !== 'loading'"); page.wait_for_timeout(200)
    st = state()
    page.evaluate("() => { Storage.prototype.setItem = window.__realSet; }")
    check('storage full: hidden for now, and a note says it wasn\'t saved', st['status'] == 'none' and 'couldn’t save' in toast_txt, [st['status'], toast_txt])
    page.evaluate("__encore.LyHidden.set(__encore.Player.cur.id, false)")

    # LRCLIB's "instrumental" answer can be overruled too
    play('Quiet Engines'); lyrics_on()
    check('"Instrumental" offers Not Instrumental?', page.is_visible('#np [data-ly="hide"]'))

    # ---- 13. the Settings switch ----
    page.evaluate('__encore.NP.close()'); page.wait_for_timeout(600)
    page.evaluate("document.querySelector('[data-act=\"settings\"]') ? document.querySelector('[data-act=\"settings\"]').click() : null")
    page.wait_for_timeout(700)
    sw = page.query_selector('.modal [data-s="lyricsOnline"]')
    check('Settings has "Look Up Lyrics Online", on by default', sw and sw.get_attribute('aria-checked') == 'true')
    foot = page.evaluate("Array.from(document.querySelectorAll('.modal .g-f')).map(x => x.textContent).join(' | ')")
    check(f'Settings shows Encore {page.evaluate("__encore.version")}', f'Encore {page.evaluate("__encore.version")}' in foot, foot)
    page.evaluate("document.querySelector('.modal [data-s=\"lyricsOnline\"]').scrollIntoView({block: 'center'})"); page.wait_for_timeout(300)
    page.screenshot(path=f'{SHOTS}/08-settings.png')
    page.tap('.modal [data-s="lyricsOnline"]'); page.wait_for_timeout(300)
    check('switch turns off', page.get_attribute('.modal [data-s="lyricsOnline"]', 'aria-checked') == 'false')
    page.tap('.modal .done'); page.wait_for_timeout(700)
    stub_post('/__reset')
    play('Hollow Weather'); lyrics_on()
    st = state()
    check('online off: no LRCLIB requests', len(stub_log()) == 0, stub_log())
    check('online off: message points to the setting', st['status'] == 'none' and 'Look Up Lyrics Online' in st['msg'], st['msg'])
    page.evaluate('__encore.NP.close()'); page.wait_for_timeout(600)
    page.evaluate("document.querySelector('[data-act=\"settings\"]').click()"); page.wait_for_timeout(700)
    page.tap('.modal [data-s="lyricsOnline"]'); page.wait_for_timeout(200); page.tap('.modal .done'); page.wait_for_timeout(700)
    open_np(); page.wait_for_function("__encore.LyView.status !== 'loading'"); page.wait_for_timeout(250)
    check('turning it back on finds lyrics for the same song (no stale "No Lyrics")', state()['synced'] and state()['source'] == 'lrclib', state())

    # ---- 14. modes: lyrics stay up after closing, queue does not; queue still works ----
    check('reopened in lyrics view', page.evaluate("__encore.NP.mode === 'lyrics' && document.querySelector('#np').classList.contains('ly')"))
    page.tap('#np [data-np="queue"]'); page.wait_for_timeout(600)
    vis = page.evaluate("""() => ({ q: getComputedStyle(document.querySelector('#np .npq')).opacity, l: getComputedStyle(document.querySelector('#np .npl')).opacity,
        qOn: document.querySelector('#np [data-np="queue"]').classList.contains('on'), lOn: document.querySelector('#np [data-np="lyrics"]').classList.contains('on') })""")
    check('queue button swaps lyrics for the queue', vis == {'q': '1', 'l': '0', 'qOn': True, 'lOn': False}, vis)
    page.evaluate('__encore.NP.close()'); page.wait_for_timeout(700); open_np()
    check('queue closes with the player (as before)', page.evaluate("__encore.NP.mode") == 'player')
    art = page.evaluate("document.querySelector('#np .np-art').getBoundingClientRect().width")
    check('big artwork in player view', art > 250, art)
    page.tap('#np [data-np="lyrics"]'); page.wait_for_timeout(600)
    page.tap('#np [data-np="lyrics"]'); page.wait_for_timeout(600)
    check('lyrics button toggles back to the player', page.evaluate("__encore.NP.mode") == 'player')

    # ---- 15. parsing details ----
    u = page.evaluate("""() => { const L = __encore.lyricsUtil;
        return {
          multi: L.parseLRC('[00:01.00][00:09.50]Echo\\n[00:05:20]Colon stamp\\n[ar:Someone]\\n[00:07.00]<00:07.00>Word <00:07.50>timed'),
          neg: L.parseLRC('[offset:-500]\\n[00:02.00]Late'),
          clean: [L.lyReadings('Velvet Comet - Paper Lanterns (Official Music Video) | Live Session', 'Some Channel'),
                  L.lyReadings('Paper Lanterns - Remastered 2011', 'Velvet Comet'),
                  L.lyReadings('Paper Lanterns (feat. Aster Lane) [Lyrics]', 'Velvet Comet - Topic'),
                  L.lyReadings('Paper Lanterns ft. Aster Lane', 'Velvet Comet, Aster Lane'),
                  L.lyReadings('Paper Lanterns', 'Velvet Comet • Aster Lane')].map((r) => r[0]),
          tm: [L.lyTitleMatch('Paper Lanterns', 'paper lanterns (2011 remaster)'), L.lyTitleMatch('Hello', 'Hello from the Other Side'), L.lyTitleMatch('Café del Mar', 'Cafe Del Mar')],
          am: [L.lyArtistMatch('Velvet Comet & Aster Lane', 'Aster Lane'), L.lyArtistMatch('VelvetComet', 'Velvet Comet'), L.lyArtistMatch('Simon', 'Garfunkel'), L.lyArtistMatch('Velvet Comet • Aster Lane', 'Aster Lane')],
          tidy: L.tidySynced([{t: 1, text: 'a'}, {t: 2, text: ''}, {t: 3, text: 'b'}, {t: 4, text: ''}, {t: 4.5, text: ''}, {t: 20, text: 'c'}], 30) }; }""")
    check('LRC: several stamps on one line, [mm:ss:xx], word timings, tags ignored',
          u['multi'] == [{'t': 1, 'text': 'Echo'}, {'t': 5.2, 'text': 'Colon stamp'}, {'t': 7, 'text': 'Word timed'}, {'t': 9.5, 'text': 'Echo'}], u['multi'])
    check('LRC: negative offset makes words later', u['neg'] == [{'t': 2.5, 'text': 'Late'}], u['neg'])
    check('name cleaning', u['clean'] == [{'track': 'Paper Lanterns', 'artist': 'Velvet Comet'}] * 5, u['clean'])
    check('title matching', u['tm'] == [True, False, True], u['tm'])
    check('artist matching', u['am'] == [True, True, False, True], u['am'])
    check('short breaks dropped, long breaks kept once', u['tidy'] == [{'t': 1, 'text': 'a'}, {'t': 3, 'text': 'b'}, {'t': 4, 'text': ''}, {'t': 20, 'text': 'c'}], u['tidy'])
    v = page.evaluate("""() => { const L = __encore.lyricsUtil, F = __encore.Lyrics;
        const sl = (lines) => ({ lyricsList: { structuredLyrics: [{ synced: true, line: lines }] } });
        return {
          order: L.tidySynced(F.fromServer(sl([{ start: 5000, value: 'b' }, { start: 1000, value: 'a' }, { start: 9000, value: 'c' }])).lines, 20),
          same: L.tidySynced([{ t: 5, text: 'x' }, { t: 5, text: 'y' }, { t: 9, text: 'z' }], 20),
          gapSame: L.tidySynced([{ t: 1, text: 'x' }, { t: 1, text: '' }, { t: 9, text: 'z' }], 20),
          zeros: F.fromServer(sl([{ start: 0, value: 'one' }, { start: 0, value: 'two' }])),
          names: [L.lyReadings('Earfquake', 'Tyler, The Creator'),
                  L.lyReadings('Let It Go - From "Frozen"/Soundtrack Version', 'Idina Menzel - Topic'),
                  L.lyReadings('Paper Lanterns - Original Mix', 'Velvet Comet - Topic'),
                  L.lyReadings('Paper Lanterns - feat. Aster Lane', 'Velvet Comet'),
                  L.lyReadings('Paper Lanterns（feat. Aster Lane）', 'Velvet Comet'),
                  L.lyReadings('Oasis - Live Forever', 'Oasis'),
                  L.lyReadings('Hozier - From Eden', 'Lyrics Channel'),
                  L.lyReadings('Velvet Comet - Paper Lanterns - Remastered 2011', 'Velvet Comet'),
                  L.lyReadings('Eminem ft. Rihanna - Love The Way You Lie (Official Video)', 'EminemVEVO'),
                  L.lyReadings('Linkin Park - From the Inside', 'Some Channel'),
                  L.lyReadings('Taylor Swift - Clean', 'Some Channel'),
                  L.lyReadings('Gym Class Heroes - Stereo Hearts', 'Some Channel'),
                  L.lyReadings('Oasis - Live Forever', 'Some Channel'),
                  L.lyReadings('Paper Lanterns - Live', 'Velvet Comet')].map((r) => r[0]),
          second: L.lyReadings('Velvet Comet - Paper Lanterns', 'Some Channel')[1],
          queries: L.lyQueries({ title: 'Earfquake', artist: 'Tyler, The Creator', primaryArtist: 'Tyler, The Creator' }),
          artists: [L.lyArtistMatch('Aster Lane', 'Aster'), L.lyArtistMatch('Bonnie Tyler', 'Tyler, The Creator'), L.lyArtistMatch('The Weeknd', 'Weeknd'),
                    L.lyArtistMatch('Aster Lane & Velvet Comet', 'Aster Lane')],
          pickStrict: L.lrclibPick([{ trackName: 'Holding On', artistName: 'Aster Lane', duration: 200, syncedLyrics: '[00:01.00]x\\n[00:02.00]y' }], 'Holding On', ['Aster'], 200),
          pickOne: !!L.lrclibPick([{ trackName: 'Intro', artistName: 'Band One', duration: 92.4, syncedLyrics: '[00:01.00]x\\n[00:02.00]y' }], 'Intro', [], 92),
          pickFar: L.lrclibPick([{ trackName: 'Intro', artistName: 'Band One', duration: 94, syncedLyrics: '[00:01.00]x\\n[00:02.00]y' }], 'Intro', [], 92),
        }; }""")
    check('server lines out of order are put in time order', [l['text'] for l in v['order']] == ['a', 'b', 'c'], v['order'])
    check('lines sharing a time light together', v['same'] == [{'t': 0, 'text': ''}, {'t': 5, 'text': 'x\ny'}, {'t': 9, 'text': 'z'}], v['same'])
    check('a break stamped at the same time as a line doesn\'t hide it', v['gapSame'] == [{'t': 1, 'text': 'x'}, {'t': 9, 'text': 'z'}], v['gapSame'])
    check('"timed" lyrics with every time at 0 are shown as plain text', v['zeros'] and v['zeros']['synced'] is False, v['zeros'])
    check('name cleaning, harder cases', v['names'] == [
        {'track': 'Earfquake', 'artist': 'Tyler'}, {'track': 'Let It Go', 'artist': 'Idina Menzel'},
        {'track': 'Paper Lanterns', 'artist': 'Velvet Comet'}, {'track': 'Paper Lanterns', 'artist': 'Velvet Comet'},
        {'track': 'Paper Lanterns', 'artist': 'Velvet Comet'}, {'track': 'Live Forever', 'artist': 'Oasis'},
        {'track': 'From Eden', 'artist': 'Hozier'}, {'track': 'Paper Lanterns', 'artist': 'Velvet Comet'},
        {'track': 'Love The Way You Lie', 'artist': 'Eminem'}, {'track': 'From the Inside', 'artist': 'Linkin Park'},
        {'track': 'Clean', 'artist': 'Taylor Swift'}, {'track': 'Stereo Hearts', 'artist': 'Gym Class Heroes'},
        {'track': 'Live Forever', 'artist': 'Oasis'}, {'track': 'Paper Lanterns', 'artist': 'Velvet Comet'}], v['names'])
    check('an ambiguous title also gets its other reading', v['second'] == {'track': 'Velvet Comet', 'artist': 'Some Channel'}, v['second'])
    check('the as-tagged names are tried first, then the first artist', v['queries'] == [{'track': 'Earfquake', 'artist': 'Tyler, The Creator'}, {'track': 'Earfquake', 'artist': 'Tyler'}], v['queries'])
    check('artists compared whole', v['artists'] == [False, False, True, True], v['artists'])
    check('a song by a different artist with a longer name is refused', v['pickStrict'] is None, v['pickStrict'])
    check('no artist: one same-length match is used, a 2 s difference is not', v['pickOne'] and v['pickFar'] is None, [v['pickOne'], v['pickFar']])

    # ---- 16. demo library: made-up lyrics, no LRCLIB, radio has no lyrics button ----
    stub_post('/__reset')
    page.evaluate('__encore.NP.close()'); page.wait_for_timeout(600)
    page.evaluate("__encore.App.signOut()"); page.wait_for_timeout(400)
    page.tap('[data-act="demo"]')
    page.wait_for_function('__encore.api && __encore.api.demo'); page.wait_for_timeout(500)
    page.evaluate("async () => { window.__songs = await __encore.Lib.allSongs(); }")
    pick = page.evaluate("""async () => { for (const s of __songs) { const r = await __encore.api.get('getLyricsBySongId', { id: s.id });
        const l = r.lyricsList.structuredLyrics; if (l && l[0].synced) return s.title; } return null; }""")
    play(pick); page.wait_for_timeout(300); page.evaluate('__encore.Player.seek(40)'); lyrics_on(); page.wait_for_timeout(1300)
    st = state()
    check('demo song shows made-up timed lyrics', st['source'] == 'demo' and st['synced'] and st['src'] == 'Made-up demo lyrics', st)
    page.screenshot(path=f'{SHOTS}/09-demo-lyrics.png')
    kinds = page.evaluate("""async () => { const c = { none: 0, plain: 0, synced: 0 };
        for (const s of __songs) { const r = await __encore.api.get('getLyricsBySongId', { id: s.id }); const l = r.lyricsList.structuredLyrics;
          if (!l) c.none++; else if (l[0].synced) c.synced++; else c.plain++; } return c; }""")
    check('demo has songs of all three kinds', kinds['none'] > 0 and kinds['plain'] > 0 and kinds['synced'] > 0, kinds)
    st2 = page.evaluate("async () => (await __encore.api.get('getInternetRadioStations')).internetRadioStations.internetRadioStation[0]")
    page.evaluate("(st) => __encore.Player.playRadio(st)", st2); page.wait_for_timeout(500)
    check('radio: no lyrics button and back to the player view', page.evaluate("document.querySelector('#np [data-np=\"lyrics\"]').hidden && __encore.NP.mode === 'player'"))
    check('demo made no LRCLIB requests', len(stub_log()) == 0, stub_log())

    b.close()

check('no script errors', not errors, errors)
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
