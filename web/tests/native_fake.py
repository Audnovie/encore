#!/usr/bin/env python3
"""A stand-in for Encore's iPhone app, for testing the page's side of the hand-off in Chromium.

It follows the same rules as the Swift player (ios/Encore/QueueState.swift and PlayerEngine.swift):
it plays the song it was given, moves on through the coming songs the page sent ("upcoming") when a song
ends or a lock screen button is pressed, registers plays with the server, counts listening time, and keeps
numbered messages (seq) until the page confirms them. Time is simulated: play_for(seconds) plays that long.

frozen = the page is asleep (the phone is locked): nothing reaches it, but the app carries on.
Not simulated: AVQueuePlayer's own lining-up of the next song, audio interruptions, real network timing.
"""
import datetime, json, urllib.request

def today():
    return datetime.date.today().isoformat()

def song_info(item):
    """the details the app passes back with its news, so the page can show a song it no longer has"""
    if not item:
        return None
    return {'id': item['key'], 'title': item.get('title', ''), 'artist': item.get('artist', ''), 'album': item.get('album', ''),
            'duration': item.get('duration', 0), 'coverArt': item.get('coverArt', ''), 'artistId': item.get('artistId', ''),
            'albumId': item.get('albumId', ''), 'isRadio': bool(item.get('isRadio')), 'url': item.get('url', '')}

class FakeNative:
    BACK_LIMIT = 50

    def __init__(self, http_scrobbles=True):
        self.http_scrobbles = http_scrobbles
        self.log, self.next_seq, self.listen_pending = [], 1, {}
        self.posted, self.outbox, self.events = [], [], []
        self.logged_all = []         # every numbered message, for the tests
        self.page_ready = False
        self.frozen = False
        # news piled up while the page slept goes all together with the player's state (as Bridge.needsCatchUp);
        # tests switch this off to check the page copes when a stray piece arrives first anyway
        self.catch_up_gate = True
        self.needs_catch_up = False
        self.fail_urls = set()
        self.network_down = False    # every song fails like a dropped connection
        self.scrobbles = []          # (key, submission, server said ok)
        self.status_bar = None
        self.paste_text = ''
        self.routes = False
        self.reset_player()

    def reset_player(self):
        """the app closed before it could save its place: it starts with nothing (its news was saved)"""
        self.cur, self.ahead, self.back = None, [], []
        self.repeat_one = False
        self.last_req = 0
        self.playing = False
        self.wants_play = False
        self.own = False             # the song came from the app itself, not the page's latest load
        self.t = 0.0
        self.ready = False
        self.using_fallback = False
        self.failed = False
        self.errors_in_row = 0
        self.now_sent = self.scrobbled = False
        self.since_time = 0.0
        self.notified = None
        self.page_ready = False

    def relaunch(self):
        """iOS closed the app and it was opened again: it comes back paused where it was (it saved its place,
        with the last 20 songs for Back), with the news it hadn't delivered; the page reloads"""
        keep = (self.cur, self.ahead[:100], self.back[-20:], self.repeat_one, self.t, self.using_fallback)
        self.reset_player()
        self.cur, self.ahead, self.back, self.repeat_one, self.t, self.using_fallback = keep
        self.ready = bool(self.cur)
        self.own = bool(self.cur)
        if self.cur:
            self.mark_started_late()

    # ---------- helpers ----------
    def live(self, m):
        if self.page_ready and not self.frozen:
            self.outbox.append([m])

    def logged(self, m, send=True):
        """a numbered message: kept until the page confirms it. Whenever any are sent, all the unconfirmed
        ones go, oldest first, so the page always sees them in order (it skips numbers it already has)."""
        m = dict(m)
        m['seq'] = self.next_seq; self.next_seq += 1
        m.setdefault('req', self.last_req)
        self.log.append(m)
        self.logged_all.append(m)
        if not (self.page_ready and not self.frozen):
            self.needs_catch_up = True
        elif send and not (self.catch_up_gate and self.needs_catch_up):
            self.outbox.append([dict(e) for e in self.log])

    def dur(self):
        return float(self.cur.get('duration') or 0) if self.cur else 0.0

    def radio(self):
        return bool(self.cur and self.cur.get('isRadio'))

    def key(self):
        return self.cur['key'] if self.cur else ''

    def snapshot(self):
        return {'type': 'snapshot', 'key': self.key(), 'req': self.last_req, 'playing': self.playing, 'waiting': False,
                't': self.t, 'd': self.dur(), 'ready': self.ready, 'own': self.own, 'song': song_info(self.cur)}

    def notify(self):
        """like the Swift side's state observer: tell the page when the song or play state changes"""
        now = (self.key(), self.playing, self.last_req)
        if now != self.notified and self.cur:
            self.live({'type': 'time', 'key': self.key(), 'req': self.last_req, 't': self.t, 'd': self.dur()})
            self.live({'type': 'state', 'key': self.key(), 'req': self.last_req, 'playing': self.playing, 'waiting': False})
        self.notified = now

    def flush_listening(self, send=True):
        if self.listen_pending:
            self.logged({'type': 'listened', 'days': {k: round(v, 3) for k, v in self.listen_pending.items()}}, send)
            self.listen_pending = {}

    def catch_up(self, welcome):
        if not self.page_ready or self.frozen:
            return
        self.flush_listening(send=False)
        batch = ([{'type': 'welcome'}] if welcome else []) + [dict(e) for e in self.log] + [self.snapshot()]
        if welcome:
            batch.append({'type': 'route', 'available': self.routes})
        self.outbox.append(batch)
        self.needs_catch_up = False

    def threshold(self):
        d = self.dur()
        return min(d * 0.5, 240) if d > 0 else None

    def mark_started_late(self):
        """starting past the halfway point (a restored place): that play was already counted"""
        th = self.threshold()
        if th is not None and self.t >= th:
            self.scrobbled = True

    # ---------- messages from the page ----------
    def on_post(self, m):
        self.posted.append(m)
        t = m.get('type')
        if t == 'hello':
            self.page_ready = True
            self.catch_up(True)
        elif t == 'pull':
            self.catch_up(False)
        elif t == 'ack':
            self.log = [e for e in self.log if e['seq'] > m['seq']]
        elif t == 'load':
            self.last_req = m['req']
            if not (m.get('restore') and self.cur):
                self.ahead = []
                self.own = False
                self.start(m['item'], float(m.get('startAt') or 0), bool(m.get('autoplay')))
        elif t == 'play':
            self.play()
        elif t == 'pause':
            self.playing = self.wants_play = False
        elif t == 'seek':
            if self.cur and not self.radio():
                self.t = max(0.0, min(float(m['t']), self.dur() or float(m['t'])))
                self.live({'type': 'time', 'key': self.key(), 'req': self.last_req, 't': self.t, 'd': self.dur()})
        elif t == 'stop':
            self.cur, self.ahead, self.back, self.playing, self.wants_play, self.t = None, [], [], False, False, 0.0
            self.repeat_one = False
        elif t == 'upcoming':
            if self.cur and m.get('key') == self.cur['key'] and m.get('req') == self.last_req:
                self.ahead = list(m.get('items') or [])
                self.back = list(m.get('back') or [])[-self.BACK_LIMIT:]
                self.repeat_one = bool(m.get('repeatOne'))
        elif t == 'statusBar':
            self.status_bar = m.get('style')
        elif t == 'paste':
            self.live({'type': 'paste', 'text': self.paste_text})
        elif t in ('airplay', 'changeAddress'):
            self.events.append(t)
        self.notify()

    # ---------- playing ----------
    def start(self, item, t=0.0, play=True):
        self.cur = item
        self.t = t
        self.playing = self.wants_play = play
        self.ready = True
        self.using_fallback = False
        self.failed = False
        self.now_sent = self.scrobbled = False
        self.mark_started_late()
        self.live({'type': 'loaded', 'key': self.key(), 'req': self.last_req, 'd': self.dur()})
        self.check_fail()

    def play(self):
        if not self.cur:
            return
        self.wants_play = True
        if self.failed:
            # Play tries a song that wouldn't load again
            self.failed = False
            self.playing = True
            self.check_fail()
        else:
            self.playing = True

    def url(self):
        return self.cur['fallback'] if self.using_fallback else self.cur['url']

    def check_fail(self):
        """A song that can't be loaded. Nothing playing: stay on it quietly (Play tries again). The server can't
        be reached: stop and keep the place. Otherwise try the MP3 version, then report it and skip (3 at most)."""
        if not self.cur or (self.url() not in self.fail_urls and not self.network_down):
            return True
        if not self.wants_play:
            self.failed = True
            self.playing = False
            return False
        if self.network_down:
            self.failed = True
            self.playing = self.wants_play = False
            self.logged({'type': 'error', 'key': self.key(), 'message': 'Couldn’t reach the music server.', 'reason': 'network'})
            return False
        if not self.using_fallback and self.cur.get('fallback'):
            self.using_fallback = True
            return self.check_fail()
        self.logged({'type': 'error', 'key': self.key(), 'message': 'The song couldn’t be played.'})
        if self.radio():
            self.playing = self.wants_play = False
            return False
        self.errors_in_row += 1
        if self.errors_in_row >= 4 or not self.move('skip'):
            self.playing = self.wants_play = False
        return False

    def move(self, reason):
        frm = self.cur
        if not frm:
            return False
        if reason == 'prev':
            if not self.back:
                self.t = 0.0
                return False
            nxt = self.back.pop()
            self.ahead.insert(0, frm)
        else:
            if not self.ahead:
                if reason == 'next':
                    self.playing = self.wants_play = False; self.t = 0.0
                return False
            nxt = self.ahead.pop(0)
            if not frm.get('isRadio'):   # like the page's history, Back never goes to a station
                self.back.append(frm); self.back = self.back[-self.BACK_LIMIT:]
        play = True if reason in ('next', 'prev') else self.wants_play
        self.cur, self.t, self.ready = nxt, 0.0, True
        self.using_fallback = False
        self.failed = False
        self.own = True
        self.now_sent = self.scrobbled = False
        self.playing = self.wants_play = play
        self.logged({'type': 'advance', 'from': frm['key'], 'to': nxt['key'], 'reason': reason, 'song': song_info(nxt)})
        self.check_fail()
        return True

    def ended(self):
        if self.repeat_one and not self.radio():
            self.t = 0.0
            self.now_sent = self.scrobbled = False
            return
        if self.ahead:
            self.move('ended')
        else:
            frm = self.key()
            self.playing, self.wants_play, self.t = False, False, 0.0
            self.own = True
            self.logged({'type': 'advance', 'from': frm, 'to': None, 'reason': 'ended'})

    def scrobble(self, submission):
        item = self.cur
        ok = False
        if self.http_scrobbles and item.get('scrobble'):
            u = item['scrobble'] + ('&submission=%s&time=%d' % ('true' if submission else 'false', int(datetime.datetime.now().timestamp() * 1000)))
            try:
                r = json.load(urllib.request.urlopen(u, timeout=10))
                ok = r.get('subsonic-response', {}).get('status') == 'ok'
            except Exception:
                ok = False
        elif not self.http_scrobbles:
            ok = True
        self.scrobbles.append((item['key'], submission, ok))
        if submission and ok:
            self.logged({'type': 'scrobbled', 'key': item['key']})

    def play_for(self, sec, step=0.25):
        for _ in range(int(round(sec / step))):
            if not (self.cur and self.playing):
                continue
            self.t += step
            self.errors_in_row = 0
            self.listen_pending[today()] = self.listen_pending.get(today(), 0) + step
            if not self.radio():
                if not self.now_sent:
                    self.now_sent = True; self.scrobble(False)
                th = self.threshold()
                if not self.scrobbled and th is not None and self.t >= th:
                    self.scrobbled = True; self.scrobble(True)
                if self.dur() > 0 and self.t >= self.dur():
                    self.ended()
            self.since_time += step
            if self.since_time >= 1 and self.cur:
                self.since_time = 0.0
                self.live({'type': 'time', 'key': self.key(), 'req': self.last_req, 't': self.t, 'd': self.dur()})
            if sum(self.listen_pending.values()) >= 30 and self.page_ready and not self.frozen \
                    and not (self.catch_up_gate and self.needs_catch_up):
                self.flush_listening()
            self.notify()
        self.notify()

    # ---------- lock screen buttons ----------
    def remote_next(self):
        if not self.move('next'):
            pass
        self.notify()

    def remote_prev(self):
        if not self.cur or self.radio():
            return
        if self.t > 3 or not self.back:
            self.t = 0.0
            self.live({'type': 'time', 'key': self.key(), 'req': self.last_req, 't': 0, 'd': self.dur()})
        else:
            self.move('prev')
        self.notify()

    def remote_pause(self):
        self.playing = self.wants_play = False
        self.notify()

    def remote_play(self):
        self.play()
        self.notify()

    # ---------- the phone ----------
    def lock(self):
        self.frozen = True
        self.needs_catch_up = True

    def unlock(self):
        """the app comes back to the front: it sends everything the page missed"""
        self.frozen = False
        self.catch_up(False)

    def set_routes(self, available):
        self.routes = available
        self.live({'type': 'route', 'available': available})


INIT_SCRIPT = """
(function () {
  if (window.EncoreNative) return;
  var queue = [], handler = null;
  function deliver(b) { try { handler(b); } catch (e) { console.error(e); } }
  window.EncoreNative = Object.freeze({
    platform: 'ios', appVersion: '1.0 (test)',
    post: function (m) { window.__nativePost(JSON.parse(JSON.stringify(m))); },
    listen: function (fn) { handler = fn; var q = queue; queue = []; q.forEach(deliver); },
    _receive: function (batch) { if (handler) deliver(batch); else queue.push(batch); }
  });
})();
"""
