#!/usr/bin/env python3
"""Encore 1.5: the page's side of the iPhone app (the app plays the music; the page decides what comes next).
Runs Encore as served by the test nginx (a home server's setup, 127.0.0.1:4540, /rest/ passed to Navidrome on 4533,
test library from make_music.py) with the stand-in app from native_fake.py in place of the iPhone app.
Also checks the parts of 1.5 that run without the app (the coming-songs list, Copy Settings)."""
import datetime, json, random, sys, urllib.request
from playwright.sync_api import sync_playwright
from native_fake import FakeNative, INIT_SCRIPT, today

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4540/'
ND = 'http://127.0.0.1:4533'
SHOTS = sys.argv[2] if len(sys.argv) > 2 else None
results, errors = [], []

def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  -- {detail}'), flush=True)

def nd(endpoint, **q):
    q.update(u='tester', p='lyrics-test-pw', v='1.16.1', c='test', f='json')
    url = f'{ND}/rest/{endpoint}?' + '&'.join(f'{k}={urllib.request.quote(str(v))}' for k, v in q.items())
    return json.load(urllib.request.urlopen(url))['subsonic-response']

def play_count(song_id):
    return nd('getSong', id=song_id)['song'].get('playCount', 0)

fake = FakeNative()

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ================= in the iPhone app (stand-in) =================
    ctx = browser.new_context(viewport={'width': 402, 'height': 874}, is_mobile=True, has_touch=True, color_scheme='dark')
    ctx.add_init_script(INIT_SCRIPT)
    ctx.expose_function('__nativePost', lambda m: fake.on_post(m))
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)

    def pump(rounds=20):
        """deliver what the app has sent, until things settle"""
        for _ in range(rounds):
            page.wait_for_timeout(40)
            if not fake.outbox:
                page.wait_for_timeout(40)
                if not fake.outbox:
                    return
            batches, fake.outbox[:] = list(fake.outbox), []
            page.evaluate('(bs) => bs.forEach((b) => window.EncoreNative._receive(b))', batches)

    def js(expr, arg=None):
        return page.evaluate(expr, arg) if arg is not None else page.evaluate(expr)

    def st():
        return js("""() => { const P = __encore.Player, a = __encore.nativeAudio;
            return { cur: P.cur && P.cur.id, title: P.cur && P.cur.title, playing: P.playing, from: P.from, t: P.time(),
                     hist: P.history.map((h) => h.song.id), up: P.upNext.map((s) => s.id), req: a.req, key: a._key, seq: a.seq,
                     ahead: P._lookahead(300).map((s) => s.id) }; }""")

    def posted(kind, since=0):
        return [m for m in fake.posted[since:] if m.get('type') == kind]

    def keys(items):
        return [i['key'] for i in items]

    page.goto(BASE)
    page.wait_for_function('window.__encore', timeout=15000)
    pump()
    check('the page sees the iPhone app', js('__encore.native') is True and js('!!__encore.nativeAudio'))
    hello = posted('hello')
    check('says hello to the app with its version', len(hello) == 1 and hello[0].get('version') == '1.5', hello)
    check('status bar: light text on the dark sign-in screen', fake.status_bar == 'light', fake.status_bar)

    page.fill('#lg-user', 'tester'); page.fill('#lg-pass', 'lyrics-test-pw'); page.tap('.lg-btn')
    page.wait_for_function('__encore.api && document.querySelector("#login").hidden', timeout=15000)
    js("async () => { window.__songs = (await __encore.Lib.allSongs()).sort((a, b) => a.title.localeCompare(b.title)); }")
    songs = js('__songs.map((s) => ({ id: s.id, title: s.title, duration: s.duration }))')
    check('signed in; library of 12 songs', len(songs) == 12, len(songs))
    S = [s['id'] for s in songs]
    D = {s['id']: s['duration'] for s in songs}
    check('the player is the app', js('__encore.Player.audio === __encore.nativeAudio'))
    js("() => { window.__played = []; __encore.Player.on('played', (s) => __played.push(s.id)); }")

    # ---------- playing a list ----------
    n0 = len(fake.posted)
    js("__encore.Player.playList(__songs.slice(0, 6), 0, 'Test')")
    pump()
    loads = posted('load', n0)
    item = loads[-1]['item'] if loads else {}
    check('playing a song asks the app to load it, playing', len(loads) == 1 and item.get('key') == S[0] and loads[0]['autoplay'] is True and loads[0]['restore'] is False, loads)
    check('song address is the full stream address', item.get('url', '').startswith('http://127.0.0.1:4540/rest/stream?') and f'id={S[0]}' in item.get('url', ''), item.get('url'))
    check('Original quality: an MP3 version to fall back on', 'format=mp3' in item.get('fallback', '') and 'maxBitRate=320' in item.get('fallback', ''), item.get('fallback'))
    check('cover and scrobble addresses are full addresses', item.get('art', '').startswith('http://127.0.0.1:4540/rest/getCoverArt?')
          and item.get('scrobble', '').startswith('http://127.0.0.1:4540/rest/scrobble?') and 'submission' not in item.get('scrobble', ''), item)
    check('title, artist, album, length passed', item.get('title') == songs[0]['title'] and item.get('duration') == songs[0]['duration'] and item.get('artist'), item)
    check('the app is told the coming songs', keys(fake.ahead) == S[1:6], keys(fake.ahead))
    s = st()
    check('the page and the app agree on the coming songs', s['ahead'] == keys(fake.ahead), [s['ahead'], keys(fake.ahead)])
    check('the page shows it playing', s['playing'] and s['cur'] == S[0], s)

    # ---------- a song ends: the app moves on, the page follows ----------
    pc0 = play_count(S[0])
    n0 = len(fake.posted)
    fake.play_for(D[S[0]] + 1)
    pump()
    s = st()
    check('song ended: the app moved on by itself', fake.key() == S[1], fake.key())
    check('the page followed without loading it again', s['cur'] == S[1] and not posted('load', n0), [s, posted('load', n0)])
    check('the page sent the app the new coming songs', posted('upcoming', n0) and posted('upcoming', n0)[-1]['key'] == S[1] and keys(fake.ahead) == S[2:6], keys(fake.ahead))
    check('the finished song is in the page\'s history', s['hist'][-1:] == [S[0]], s['hist'])
    check('the app registered the play with Navidrome', (S[0], True, True) in fake.scrobbles, fake.scrobbles)
    check('Navidrome counted it', play_count(S[0]) == pc0 + 1, [pc0, play_count(S[0])])
    check('the page heard about the play (Recently Played moves it up)', js('__played') == [S[0]], js('__played'))
    check('the app\'s numbered messages were confirmed', not fake.log, fake.log)

    # ---------- listening time comes from the app ----------
    fake.catch_up(False); pump()
    before = js("(k) => (__encore.Listen.data.days[k] || 0)", today())
    fake.play_for(12); fake.catch_up(False); pump()
    after = js("(k) => (__encore.Listen.data.days[k] || 0)", today())
    check('listening time is counted by the app and added here', abs((after - before) - 12) < 0.01, [before, after])
    page.wait_for_timeout(1500)
    check('the page doesn\'t count on top of the app', js("(k) => (__encore.Listen.data.days[k] || 0)", today()) == after and st()['playing'])

    # ---------- lock screen buttons ----------
    n0 = len(fake.posted)
    fake.remote_next(); pump()
    s = st()
    check('lock screen Next: the page follows', s['cur'] == S[2] == fake.key() and not posted('load', n0), [s['cur'], fake.key()])
    fake.play_for(1)
    fake.remote_prev(); pump()
    s = st()
    check('lock screen Back near the start: the previous song, page follows', s['cur'] == S[1] == fake.key() and not posted('load', n0), [s['cur'], fake.key()])
    check('...and the song it came back from is next again', keys(fake.ahead)[:1] == [S[2]] and s['ahead'][:1] == [S[2]], [keys(fake.ahead)[:2], s['ahead'][:2]])
    fake.play_for(6)
    fake.remote_prev(); pump()
    s = st()
    check('lock screen Back later in a song: back to its start, same song', s['cur'] == S[1] == fake.key() and fake.t == 0 and s['t'] < 1, [s['cur'], fake.t, s['t']])
    fake.remote_pause(); pump()
    check('lock screen Pause: the page shows paused', st()['playing'] is False)
    fake.remote_play(); pump()
    check('lock screen Play: the page shows playing', st()['playing'] is True)

    # ---------- locked: the page sleeps, the app plays on ----------
    n0 = len(fake.posted)
    fake.lock()
    fake.play_for(D[S[1]] + D[S[2]] + 5)
    fake.remote_pause()
    played_while_locked = fake.key()
    check('while locked, the app played on through two songs', played_while_locked == S[3], played_while_locked)
    check('nothing reached the sleeping page', not fake.outbox)
    fake.unlock(); pump()
    s = st()
    check('unlocked: the page caught up to the same song', s['cur'] == S[3] == fake.key(), [s['cur'], fake.key()])
    check('...without loading anything', not posted('load', n0), posted('load', n0))
    check('...and without starting playback again', not posted('play', n0) and s['playing'] is False, [posted('play', n0), s['playing']])
    check('...with both songs in its history', s['hist'][-2:] == [S[1], S[2]], s['hist'])
    check('...at the app\'s position in the song', abs(s['t'] - fake.t) < 1, [s['t'], fake.t])
    check('...and confirmed everything', not fake.log, fake.log)
    fake.remote_play(); pump()

    # ---------- Play Next / Play Last ----------
    n0 = len(fake.posted)
    js("__encore.Player.playNext(__songs[7]); __encore.Player.playLast(__songs[8])")
    pump()
    check('Play Next / Play Last go first in the app\'s coming songs', keys(fake.ahead)[:2] == [S[7], S[8]], keys(fake.ahead)[:3])
    check('...one update for the app for changes made together', len(posted('upcoming', n0)) == 1, len(posted('upcoming', n0)))
    fake.remote_next(); pump()
    s = st()
    check('Next plays the Play Next song; page agrees', s['cur'] == S[7] == fake.key() and s['from'] == 'queue' and s['up'] == [S[8]], s)

    # ---------- the page changes songs just as the app moves on ----------
    n0 = len(fake.posted)
    fake.play_for(D[S[7]] + 1)                 # the app moves on to S[8]; the news hasn't been delivered yet
    held = list(fake.outbox); fake.outbox.clear()
    js("__encore.Player.playList(__songs.slice(9, 11), 0, 'Other')")
    fake.outbox[:0] = held                      # now the old news arrives
    pump()
    s = st()
    check('old news from the app is ignored after the page asked for another song', s['cur'] == S[9] == fake.key(), [s['cur'], fake.key()])
    check('...and the page asked once', len(posted('load', n0)) == 1, posted('load', n0))

    # ---------- shuffle + repeat all, many times round while locked ----------
    n0 = len(fake.posted)
    js("__encore.Player.clearQueue(); __encore.Player.playList(__songs.slice(0, 3), 0, 'Loop', { shuffle: true }); __encore.Player.cycleRepeat()")
    pump()
    s = st()
    check('repeat all + shuffle: the app gets 300 coming songs', len(fake.ahead) == 300 and s['ahead'] == keys(fake.ahead), len(fake.ahead))
    seq = [s['cur']] + keys(fake.ahead)
    check('a new time round never starts with the song that just played', all(seq[i] != seq[i + 1] for i in range(len(seq) - 1)), seq[:12])
    check('each time round plays all three', all(sorted(seq[i:i + 3]) == sorted(S[:3]) for i in range(0, 297, 3)), seq[:12])
    fake.lock()
    loop_len = sum(D[k] for k in S[:3])
    fake.play_for(loop_len * 3 + 10)
    locked_path = keys(fake.back[-9:])
    fake.unlock(); pump()
    s = st()
    check('after 3 times round while locked, the page is on the app\'s song', s['cur'] == fake.key(), [s['cur'], fake.key()])
    check('...having followed the same songs', s['hist'][-9:] == locked_path, [s['hist'][-9:], locked_path])
    check('...without loading any', not posted('load', n0)[1:], posted('load', n0))
    check('...and the coming songs still agree', s['ahead'] == keys(fake.ahead), [s['ahead'][:5], keys(fake.ahead)[:5]])
    js("__encore.Player.cycleRepeat(); __encore.Player.cycleRepeat()")   # all -> one -> off
    js("__encore.Player.setShuffle(false)")
    pump()

    # ---------- the app plays through every song it was told about while locked ----------
    fake.http_scrobbles = False
    js("__encore.Player.clearQueue(); __encore.Player.playList(__songs.slice(0, 3), 0, 'Long night'); __encore.Player.cycleRepeat()")
    pump()
    check('(the app is told 300 songs ahead)', len(fake.ahead) == 300, len(fake.ahead))
    n0 = len(fake.posted)
    fake.lock()
    fake.play_for(sum(D[k] for k in S[:3]) * 101 + 50)
    check('...it plays them all, then stops', not fake.playing and not fake.ahead, [fake.playing, len(fake.ahead)])
    last = fake.key()
    fake.unlock(); pump()
    s = st()
    loads = posted('load', n0)
    check('unlocked after it ran out: nothing starts playing by itself', not posted('play', n0) and s['playing'] is False and not fake.playing
          and all(x['autoplay'] is False for x in loads), [posted('play', n0), s['playing'], fake.playing, [x['autoplay'] for x in loads]])
    check('...the page moved on to the next song, ready to play, and the app has it',
          len(loads) == 1 and s['cur'] == fake.key() == loads[0]['item']['key'], [s['cur'], fake.key(), [x['item']['key'] for x in loads]])
    # ...and when Play was pressed on the lock screen after it ran out, the last song plays on
    js("__encore.Player.clearQueue(); __encore.Player.playList(__songs.slice(0, 3), 0, 'Long night 2')"); pump()
    fake.lock()
    fake.play_for(sum(D[k] for k in S[:3]) * 101 + 50)
    last = fake.key()
    fake.remote_play()
    fake.play_for(2)
    n0 = len(fake.posted)
    fake.unlock(); pump()
    s = st()
    check('ran out, then lock-screen Play: still playing that song after unlocking', fake.playing and s['playing'] and s['cur'] == last == fake.key()
          and not posted('load', n0) and not posted('pause', n0), [fake.playing, s['playing'], s['cur'], last, posted('load', n0)])
    js("__encore.Player.clearQueue(); __encore.Player.playList(__songs.slice(0, 3), 0, 'Long night 3')"); pump()
    fake.lock()
    fake.play_for(sum(D[k] for k in S[:3]) * 101 + 50)
    last = fake.key()
    fake.remote_play()
    fake.play_for(2)
    fake.catch_up_gate = False
    fake.frozen = False
    fake.play_for(31)
    n0 = len(fake.posted)
    pump()
    fake.catch_up(False); pump()
    fake.catch_up_gate = True
    s = st()
    check('ran out, then Play, with a stray piece of news first: still playing that song', fake.playing and s['playing'] and s['cur'] == last == fake.key()
          and not posted('load', n0) and not posted('pause', n0), [fake.playing, s['playing'], s['cur'], last, posted('load', n0), posted('pause', n0)])
    fake.http_scrobbles = True
    js("__encore.Player.cycleRepeat(); __encore.Player.cycleRepeat()")   # all -> one -> off
    pump()

    # ---------- the list ends while locked, then Play or Back on the lock screen ----------
    js("__encore.Player.clearQueue(); __encore.Player.playList(__songs.slice(0, 2), 0, 'Two')"); pump()
    fake.lock()
    fake.play_for(D[S[0]] + D[S[1]] + 2)
    check('(the app stopped at the end of the list)', not fake.playing and fake.key() == S[1], [fake.playing, fake.key()])
    fake.remote_play()
    fake.play_for(3)
    n0 = len(fake.posted)
    fake.unlock(); pump()
    s = st()
    check('list ended while locked, then lock-screen Play: still playing after unlocking', fake.playing and s['playing'] and s['cur'] == S[1] == fake.key()
          and not posted('pause', n0) and not posted('load', n0), [fake.playing, s['playing'], s['cur'], posted('pause', n0), posted('load', n0)])
    fake.lock()
    fake.play_for(D[S[1]] + 2)
    fake.remote_prev()
    fake.play_for(2)
    n0 = len(fake.posted)
    fake.unlock(); pump()
    s = st()
    check('list ended while locked, then lock-screen Back: the song before plays on after unlocking', fake.playing and s['playing'] and s['cur'] == S[0] == fake.key()
          and not posted('pause', n0) and not posted('load', n0), [fake.playing, s['playing'], s['cur'], fake.key(), posted('pause', n0)])
    fake.lock()
    fake.play_for(D[S[0]] + D[S[1]] + 2)
    n0 = len(fake.posted)
    fake.unlock(); pump()
    s = st()
    check('list ended while locked, nothing pressed: stopped at the start of the last song', not fake.playing and not s['playing'] and s['cur'] == S[1] and s['t'] < 0.5,
          [fake.playing, s['playing'], s['cur'], s['t']])
    js("__encore.Player.play()"); pump()
    fake.play_for(D[S[1]] + 1); pump()
    s = st()
    check('the list ending while the page is awake: stops the same way', not fake.playing and not s['playing'] and s['cur'] == S[1], [fake.playing, s['playing'], s['cur']])
    # ...Play then Pause part way through: the place is kept
    fake.lock()
    fake.play_for(1)
    fake.remote_play()
    fake.play_for(30)
    fake.remote_pause()
    fake.unlock(); pump()
    s = st()
    check('list ended, then lock-screen Play and Pause part way: the place is kept', s['cur'] == S[1] == fake.key() and not s['playing'] and 29 < s['t'] < 32
          and 29 < fake.t < 32, [s['cur'], s['playing'], s['t'], fake.t])
    # ...and when some news reaches the page before the catch-up anyway (the page asks for the app's state first)
    js("__encore.Player.play()"); pump()
    fake.lock()
    fake.play_for(D[S[1]])
    fake.remote_play()
    fake.play_for(3)
    fake.catch_up_gate = False
    fake.frozen = False
    fake.play_for(31)                    # a piece of news goes out live first (listening time)
    n0 = len(fake.posted)
    pump()
    fake.catch_up(False); pump()
    fake.catch_up_gate = True
    s = st()
    check('a stray piece of news before the catch-up: still playing, nothing stopped', fake.playing and s['playing'] and s['cur'] == S[1] == fake.key()
          and not posted('pause', n0) and not posted('load', n0), [fake.playing, s['playing'], posted('pause', n0), posted('load', n0)])

    # ---------- Back at the start of a new time round, while locked ----------
    js("__encore.Player.clearQueue(); __encore.Player.playList(__songs.slice(0, 3), 0, 'Round', { shuffle: true }); __encore.Player.cycleRepeat()")
    pump()
    L = keys(fake.ahead)
    n0 = len(fake.posted)
    fake.lock()
    fake.play_for(D[fake.key()] + D[L[0]] + D[L[1]] + 1)
    check('(the app is just into the next time round)', fake.key() == L[2] and fake.t <= 1.5, [fake.key(), L[:3], fake.t])
    fake.remote_prev()
    fake.play_for(D[L[1]] + D[L[2]] + D[L[3]] + 10)
    fake.unlock(); pump()
    s = st()
    check('Back at the start of a time round while locked: the page follows the app', s['cur'] == fake.key(), [s['cur'], fake.key()])
    check('...without loading or starting anything', not posted('load', n0) and not posted('play', n0), [posted('load', n0), posted('play', n0)])

    # ---------- the page reloads after the app went into a new time round ----------
    js("__encore.Player.save()")
    fake.lock()
    fake.play_for(sum(D[k] for k in S[:3]) * 2)
    fake.frozen = False
    n0 = len(fake.posted)
    page.reload(); page.wait_for_function('window.__encore && __encore.Player.cur', timeout=15000); pump()
    s = st()
    loads = posted('load', n0)
    check('page reloaded after a new time round (shuffled differently here): it follows the app', s['cur'] == fake.key(), [s['cur'], fake.key()])
    check('...with no request but its gentle "restore", and nothing restarted', len(loads) == 1 and loads[0]['restore'] is True and not posted('play', n0),
          [loads, posted('play', n0)])
    js("async () => { window.__songs = (await __encore.Lib.allSongs()).sort((a, b) => a.title.localeCompare(b.title)); }")
    js("__encore.Player.cycleRepeat(); __encore.Player.cycleRepeat(); __encore.Player.setShuffle(false)")   # all -> one -> off
    pump()

    # ---------- radio, Next to a Play Next song, then Back, while locked ----------
    js("__encore.Player.playRadio({ id: 'st2', name: 'Night FM', streamUrl: 'http://127.0.0.1:9/night' }); __encore.Player.playNext(__songs[5])")
    pump()
    n0 = len(fake.posted)
    fake.lock()
    fake.remote_next()
    fake.play_for(1)
    fake.remote_prev()
    fake.play_for(2)
    fake.unlock(); pump()
    s = st()
    check('radio > Next > Back while locked: page and app agree (Back never goes to a station)', s['cur'] == fake.key() != 'radio:st2', [s['cur'], fake.key()])
    check('...without loading anything', not posted('load', n0), posted('load', n0))

    # ---------- songs that won't load while nothing is playing, or when the server can't be reached ----------
    it4 = js("(id) => __encore.nativeItem(__songs.find((x) => x.id === id))", S[4])
    fake.fail_urls = {it4['url'], it4['fallback']}
    errs0 = len([m for m in fake.logged_all if m['type'] == 'error'])
    js("(id) => { const P = __encore.Player; P.pause(); P.upNext = []; P.ctx = null; P._start(__songs.find((x) => x.id === id), 'queue', false); }", S[4])
    pump()
    check('a song that won\'t load while paused: the app stays on it, quietly', fake.key() == S[4] == st()['cur'] and not fake.playing
          and len([m for m in fake.logged_all if m['type'] == 'error']) == errs0, [fake.key(), fake.playing])
    js("__encore.Player.play()"); pump()
    toast = js("document.querySelector('#toast .tx').textContent")
    check('...pressing Play tries again, then says it can\'t be played', 'Couldn’t play' in toast and fake.key() == S[4] and not fake.playing, [toast, fake.key()])
    fake.fail_urls = set()
    js("__encore.Player.playList(__songs.slice(4, 7), 0, 'Net')"); pump()
    fake.network_down = True
    fake.remote_next(); pump()
    s = st()
    check('the server can\'t be reached: the app stops on the next song instead of skipping through the list',
          fake.key() == S[5] == s['cur'] and not fake.playing and s['playing'] is False, [fake.key(), s['cur'], fake.playing, s['playing']])
    toast = js("document.querySelector('#toast .tx').textContent")
    check('...and the page says the server can\'t be reached (not that the song is broken)', toast == 'Couldn’t reach the music server', toast)
    fake.network_down = False
    js("__encore.Player.play()"); pump()
    check('...Play tries again once it\'s back', fake.playing and fake.key() == S[5] and st()['playing'], [fake.playing, fake.key()])

    # ---------- songs that won't play ----------
    page.wait_for_timeout(2000)   # let the last message go
    js("__encore.Player.clearQueue(); __encore.Player.playList(__songs.slice(4, 7), 0, 'Errors')"); pump()
    fake.fail_urls = {fake.cur['url']}
    n0 = len(fake.posted)
    js("__encore.Player.playList(__songs.slice(4, 7), 0, 'Errors')"); pump()
    check('a song in a format the phone can\'t play: the app uses the MP3 version', fake.key() == S[4] and fake.using_fallback and fake.playing, [fake.key(), fake.using_fallback])
    check('...quietly', not js("document.querySelector('#toast').classList.contains('in')"))
    item5 = [i for i in fake.ahead if i['key'] == S[5]][0]
    fake.fail_urls = {item5['url'], item5['fallback']}
    fake.remote_next(); pump()
    s = st()
    toast = js("document.querySelector('#toast .tx').textContent")
    check('a song that can\'t play at all: the page says so', 'Couldn’t play' in toast and songs[5]['title'] in toast, toast)
    check('...and the app skipped to the next song, page following', s['cur'] == S[6] == fake.key() and not posted('load', n0)[1:], [s['cur'], fake.key()])
    fake.fail_urls = set()

    # ---------- repeat one ----------
    js("__encore.Player.playList(__songs.slice(0, 2), 0, 'One'); __encore.Player.cycleRepeat(); __encore.Player.cycleRepeat()")
    pump()
    check('repeat one is passed to the app', fake.repeat_one is True and js('__encore.Player.repeat') == 'one')
    now_before = len([x for x in fake.scrobbles if x[0] == S[0] and not x[1]])
    fake.play_for(D[S[0]] + 5); pump()
    s = st()
    check('repeat one: the app starts the song again, page stays on it', fake.key() == S[0] == s['cur'] and 4 < fake.t < 6, [fake.key(), fake.t])
    check('...and each time round counts', len([x for x in fake.scrobbles if x[0] == S[0] and not x[1]]) == now_before + 2, fake.scrobbles[-4:])
    js("__encore.Player.cycleRepeat()"); pump()
    check('repeat off is passed to the app', fake.repeat_one is False)

    # ---------- the end of the list ----------
    js("__encore.Player.playList([__songs[1]], 0, 'Last')"); pump()
    fake.play_for(D[S[1]] + 1); pump()
    s = st()
    check('after the last song: stopped at its start, page agrees', s['cur'] == S[1] and s['playing'] is False and s['t'] < 0.5 and not fake.playing, s)

    # ---------- the page reloads while the app plays on ----------
    js("__encore.Player.playList(__songs.slice(0, 6), 0, 'Reload')"); pump()
    fake.play_for(5); pump(); js("__encore.Player.save()")
    fake.lock()
    fake.play_for(D[S[0]] + D[S[1]] + 3)
    app_song = fake.key()
    fake.frozen = False
    n0 = len(fake.posted)
    page.reload(); page.wait_for_function('window.__encore && __encore.Player.cur', timeout=15000); pump()
    s = st()
    loads = posted('load', n0)
    check('page reloaded: it catches up with the song the app is playing', s['cur'] == app_song == fake.key() == S[2], [s['cur'], app_song])
    check('...its only request was the gentle "restore" one, which the app ignored', len(loads) == 1 and loads[0]['restore'] is True and fake.key() == S[2], loads)
    check('...and it shows it playing', s['playing'] is True)
    js("async () => { window.__songs = (await __encore.Lib.allSongs()).sort((a, b) => a.title.localeCompare(b.title)); }")

    # ---------- the app was closed and opened again: it kept its place and its news ----------
    js("__encore.Player.playList(__songs.slice(0, 6), 0, 'Relaunch')"); pump()
    fake.play_for(4); pump(); js("__encore.Player.save()")
    fake.lock()
    fake.play_for(D[S[0]] + 3)          # moves on to S[1] while locked
    fake.remote_pause()
    fake.relaunch(); fake.frozen = False
    n0 = len(fake.posted)
    page.reload(); page.wait_for_function('window.__encore && __encore.Player.cur', timeout=15000); pump()
    s = st()
    loads = posted('load', n0)
    check('app reopened: the page replays what the app did before it closed', s['cur'] == S[1] == fake.key(), [s['cur'], fake.key()])
    check('...the app kept its song, paused; the page only sent its "restore"', not fake.playing and len(loads) == 1 and loads[0]['restore'] is True, loads)
    check('...and the page shows it paused', s['playing'] is False)
    js("async () => { window.__songs = (await __encore.Lib.allSongs()).sort((a, b) => a.title.localeCompare(b.title)); }")

    # ---------- ...or it had nothing saved (closed before it could save): the page's song is loaded ----------
    js("__encore.Player.playList(__songs.slice(0, 6), 0, 'Relaunch2')"); pump()
    fake.play_for(4); pump(); js("__encore.Player.save()")
    fake.lock()
    fake.play_for(D[S[0]] + 3)
    fake.remote_pause()
    fake.reset_player(); fake.frozen = False
    page.reload(); page.wait_for_function('window.__encore && __encore.Player.cur', timeout=15000); pump()
    s = st()
    check('nothing saved: the page replays the app\'s news', s['cur'] == S[1], s['cur'])
    check('...and the app loads that song, paused', fake.key() == S[1] and not fake.playing, [fake.key(), fake.playing])
    js("async () => { window.__songs = (await __encore.Lib.allSongs()).sort((a, b) => a.title.localeCompare(b.title)); }")

    # ---------- radio ----------
    n0 = len(fake.posted)
    js("__encore.Player.playRadio({ id: 'st1', name: 'Test FM', streamUrl: 'http://127.0.0.1:9/live' })"); pump()
    loads = posted('load', n0)
    check('radio: the app gets the station address', loads and loads[-1]['item']['isRadio'] is True and loads[-1]['item']['url'] == 'http://127.0.0.1:9/live', loads)
    fake.remote_prev(); pump()
    check('radio: Back does nothing', fake.key() == 'radio:st1' and st()['cur'] == 'radio:st1')

    # ---------- status bar ----------
    js("__encore.Player.playList(__songs.slice(0, 3), 0, 'Bar')"); pump()
    js("__encore.NP.open()"); page.wait_for_timeout(500)
    check('status bar: light text over Now Playing', fake.status_bar == 'light', fake.status_bar)
    js("__encore.Settings.set('theme', 'light'); __encore.Settings.apply()")
    check('...still light over Now Playing in the light theme', fake.status_bar == 'light', fake.status_bar)
    js("__encore.NP.close()"); page.wait_for_timeout(500)
    check('...dark text on the light theme', fake.status_bar == 'dark', fake.status_bar)
    js("__encore.Settings.set('theme', 'system'); __encore.Settings.apply()")
    page.emulate_media(color_scheme='light'); page.wait_for_timeout(200)
    check('...system theme follows the phone (light)', fake.status_bar == 'dark', fake.status_bar)
    page.emulate_media(color_scheme='dark'); page.wait_for_timeout(200)
    check('...system theme follows the phone (dark)', fake.status_bar == 'light', fake.status_bar)

    # ---------- AirPlay ----------
    js("__encore.NP.open()"); page.wait_for_timeout(500)
    check('AirPlay button hidden with nothing nearby', js("document.querySelector('#np [data-np=\"airplay\"]').hidden"))
    fake.set_routes(True); pump()
    check('AirPlay button shows when the app finds a speaker or TV', not js("document.querySelector('#np [data-np=\"airplay\"]').hidden"))
    page.tap('#np [data-np="airplay"]'); page.wait_for_timeout(200)
    check('tapping it opens the app\'s AirPlay list', fake.events.count('airplay') == 1, fake.events)
    js("__encore.NP.close()"); page.wait_for_timeout(500)

    # ---------- Settings: the iPhone App group ----------
    def open_settings():
        js("document.querySelector('[data-act=\"settings\"]').click()"); page.wait_for_timeout(700)
    def close_settings():
        page.tap('.modal .done'); page.wait_for_timeout(700)
    open_settings()
    body = js("document.querySelector('.modal .m-body').innerText")
    check('Settings has an iPhone App group with the address', 'iPhone App' in body and 'Encore’s Address' in body and '127.0.0.1:4540' in body and 'Bring Over Settings' in body, body[-500:])
    check('...and no Copy Settings button (that\'s for the Home Screen version)', not js("!!document.querySelector('.modal [data-s=\"native-export\"]')"))
    check('footer shows both versions', 'Encore 1.5 · iPhone app 1.0 (test)' in body, body[-200:])
    if SHOTS:
        page.screenshot(path=f'{SHOTS}/native-settings.png')
    y = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    fake.paste_text = json.dumps({'encore': 'settings', 'v': 1, 'version': '1.5',
                                  'settings': {'accent': '#30d158', 'theme': 'dark', 'glow': True, 'quality': 7},
                                  'listen': {'v': 1, 'since': '2025-01-02T00:00:00.000Z', 'total': 5000, 'days': {y: 1200, '2026-01-05': 3800}},
                                  'lyricsHidden': ['hidden-1', 'hidden-2']})
    t0 = js("__encore.Listen.data.total")
    page.click('.modal [data-s="native-import"]'); page.wait_for_timeout(300); pump(); page.wait_for_timeout(300)
    toast = js("document.querySelector('#toast .tx').textContent")
    check('Bring Over Settings: the app is asked for the clipboard', len(posted('paste')) == 1)
    check('...settings, listening time and hidden lyrics brought over', toast == 'Brought over settings, listening time and hidden lyrics', toast)
    check('...the accent colour and theme are applied', js("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()") == '#30d158' and js("__encore.Settings.get('theme')") == 'dark')
    check('...a value of the wrong kind is left alone', js("__encore.Settings.get('quality')") != 7, js("__encore.Settings.get('quality')"))
    check('...listening days added', js(f"__encore.Listen.data.days['{y}']") == 1200 and abs(js("__encore.Listen.data.total") - (t0 + 5000)) < 0.01, [js("__encore.Listen.data.total"), t0])
    check('...earliest date kept', js("__encore.Listen.data.since") == '2025-01-02T00:00:00.000Z')
    check('...hidden lyrics added', js("__encore.LyHidden.list().includes('hidden-1')") if js("!!__encore.LyHidden") else True)
    page.click('.modal [data-s="native-import"]'); page.wait_for_timeout(300); pump(); page.wait_for_timeout(300)
    check('bringing the same over again doesn\'t count it twice', abs(js("__encore.Listen.data.total") - (t0 + 5000)) < 0.01, js("__encore.Listen.data.total"))
    fake.paste_text = 'hello there'
    page.wait_for_timeout(2000)
    page.click('.modal [data-s="native-import"]'); page.wait_for_timeout(300); pump(); page.wait_for_timeout(300)
    check('other clipboard text: says it isn\'t from Encore', js("document.querySelector('#toast .tx').textContent") == 'That isn’t from Encore')
    page.click('.modal [data-s="native-address"]'); page.wait_for_timeout(600)
    page.wait_for_timeout(400)
    page.click('.alert.in .al-btn:has-text("Change")'); page.wait_for_timeout(400)
    check('Change Encore\'s Address asks first, then tells the app', fake.events.count('changeAddress') == 1, fake.events)
    js("__encore.Settings.set('theme', 'system'); __encore.Settings.set('accent', ''); __encore.Settings.set('glow', false); __encore.Settings.apply()")
    page.keyboard.press('Escape'); page.wait_for_timeout(600)
    if js("!!document.querySelector('.modal.in')"):
        close_settings()

    # ---------- signing out stops the app's player ----------
    n0 = len(fake.posted)
    js("__encore.App.signOut()"); pump()
    check('sign out: the app stops playing', posted('stop', n0) and fake.cur is None, posted('stop', n0))
    page.tap('[data-act="demo"]'); page.wait_for_function('__encore.api && __encore.api.demo'); page.wait_for_timeout(500)
    n0 = len(fake.posted)
    page.tap('.cat[data-view="songs"]'); page.wait_for_timeout(1000)
    page.tap('.srow'); page.wait_for_timeout(600)
    check('the demo library in the app plays silently, without the app\'s player', js("__encore.Player.playing && __encore.Player.audio !== __encore.nativeAudio") and not posted('load', n0))
    open_settings()
    fake.paste_text = 'hello there'
    page.click('.modal [data-s="native-import"]'); page.wait_for_timeout(300); pump(); page.wait_for_timeout(300)
    check('Bring Over Settings answers in the demo library too', js("document.querySelector('#toast .tx').textContent") == 'That isn’t from Encore')
    page.keyboard.press('Escape'); page.wait_for_timeout(600)
    js("__encore.App.signOut()"); page.wait_for_timeout(300)
    pulls = len(posted('pull'))
    page.fill('#lg-user', 'tester'); page.fill('#lg-pass', 'lyrics-test-pw'); page.tap('.lg-btn')
    page.wait_for_function('__encore.api && document.querySelector("#login").hidden', timeout=15000); pump()
    check('signing in asks the app what it\'s playing', len(posted('pull')) == pulls + 1, len(posted('pull')) - pulls)
    js("__encore.App.signOut()"); page.wait_for_timeout(300)
    ctx.close()

    # ================= in Safari / the Home Screen (no app) =================
    ctx2 = browser.new_context(viewport={'width': 402, 'height': 874}, is_mobile=True, has_touch=True)
    ctx2.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE.rstrip('/'))
    page = ctx2.new_page()
    page.on('pageerror', lambda e: errors.append('web pageerror: ' + str(e)))
    page.goto(BASE)
    page.wait_for_function('window.__encore', timeout=15000)
    check('without the app, the page uses its own player', page.evaluate('__encore.native') is False and page.evaluate('__encore.nativeAudio') is None)
    page.tap('[data-act="demo"]'); page.wait_for_function('__encore.api && __encore.api.demo'); page.wait_for_timeout(600)

    # the coming-songs list must match what Next really plays, whatever the queue looks like
    bad = page.evaluate("""(seed) => {
        let x = seed; const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
        const P = __encore.Player, all = __encore.Lib.cache.get('songs') ? __encore.Lib.cache.get('songs').v : null;
        return (async () => {
          const songs = all || await __encore.Lib.allSongs();
          const out = [];
          for (let round = 0; round < 60; round++) {
            const n = 1 + Math.floor(rnd() * 7), start = Math.floor(rnd() * Math.max(1, songs.length - n));
            P.playList(songs.slice(start, start + n), Math.floor(rnd() * n), 'R', { shuffle: rnd() < 0.5 });
            P.repeat = ['off', 'all', 'all'][Math.floor(rnd() * 3)];
            for (let step = 0; step < 12; step++) {
              const op = rnd();
              if (op < 0.15) P.playNext(songs[Math.floor(rnd() * songs.length)]);
              else if (op < 0.25) P.playLast(songs[Math.floor(rnd() * songs.length)]);
              else if (op < 0.35 && P.upcomingCount() > 0) P.removeCtx(Math.floor(rnd() * Math.min(5, P.upcomingCount())));
              else if (op < 0.45 && P.upcomingCount() > 1) P.moveCtx(0, 1);
              else if (op < 0.52) P.setShuffle(!P.shuffle);
              else if (op < 0.6) P.prev(true);
              const L = P._lookahead(40).map((s) => s.id);
              const k = 1 + Math.floor(rnd() * 15);
              for (let i = 0; i < k; i++) {
                if (!P.next(false)) { if (i < L.length) out.push({ round, step, i, why: 'next() stopped early', L: L.slice(0, 5) }); break; }
                if (P.cur.id !== L[i]) { out.push({ round, step, i, why: 'different song', got: P.cur.id, want: L[i], shuffle: P.shuffle, repeat: P.repeat }); break; }
              }
            }
          }
          return out;
        })();
    }""", 12345)
    check('coming songs = what Next plays (60 random queues: shuffle, repeat, Play Next/Last, remove, move, back)', not bad, bad[:3])
    page.evaluate("__encore.Player.pause()")

    # each time round in repeat one counts as a play (also without the app)
    rs = page.evaluate("""() => { const P = __encore.Player, calls = [], orig = __encore.api.scrobble;
        __encore.api.scrobble = (id, sub) => { calls.push(sub); return Promise.resolve(); };
        P.repeat = 'one'; P.scrobbled = true; P.nowSent = true; P._onEnded();
        const r = [P.scrobbled, calls]; P.repeat = 'off'; P.pause(); __encore.api.scrobble = orig; return r; }""")
    check('repeat one: each time round counts as a play', rs == [False, [False]], rs)

    page.evaluate("document.querySelector('[data-act=\"settings\"]').click()"); page.wait_for_timeout(700)
    check('demo library: no iPhone App group', 'iPhone App' not in page.evaluate("document.querySelector('.modal .m-body').innerText"))
    page.evaluate("__encore.App.signOut()"); page.wait_for_timeout(500)
    page.fill('#lg-user', 'tester'); page.fill('#lg-pass', 'lyrics-test-pw'); page.tap('.lg-btn')
    page.wait_for_function('__encore.api && document.querySelector("#login").hidden', timeout=15000)
    page.evaluate("__encore.Settings.set('accent', '#bf5af2'); __encore.Settings.apply(); __encore.Listen.add(321, '2026-02-03'); __encore.Listen.save(); __encore.LyHidden.set('web-hidden', true)")
    page.evaluate("document.querySelector('[data-act=\"settings\"]').click()"); page.wait_for_timeout(700)
    body = page.evaluate("document.querySelector('.modal .m-body').innerText")
    check('Home Screen version: Copy Settings for the iPhone App', 'Copy Settings for the iPhone App' in body and 'Encore’s Address' not in body, body[-400:])
    page.click('.modal [data-s="native-export"]'); page.wait_for_timeout(400)
    toast = page.evaluate("document.querySelector('#toast .tx').textContent")
    clip = page.evaluate("navigator.clipboard.readText()")
    try:
        packed = json.loads(clip)
    except Exception:
        packed = {}
    check('...copies them', toast == 'Copied. Now open the iPhone app.' and packed.get('encore') == 'settings' and packed.get('v') == 1, [toast, clip[:80]])
    check('...settings, listening time and hidden lyrics included', packed.get('settings', {}).get('accent') == '#bf5af2'
          and packed.get('listen', {}).get('days', {}).get('2026-02-03', 0) >= 321 and 'web-hidden' in packed.get('lyricsHidden', []), packed.get('settings'))
    ctx2.close()
    browser.close()

for e in errors:
    print('ERROR', e)
print(f"\n{sum(1 for _, ok in results if ok)}/{len(results)} passed" + (f", {len(errors)} script errors" if errors else ''))
sys.exit(0 if all(ok for _, ok in results) and not errors else 1)
