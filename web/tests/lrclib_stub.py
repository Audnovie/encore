#!/usr/bin/env python3
"""A stand-in for lrclib.net used by the tests (the real site can't be reached from the test machine).
It answers /api/get and /api/search in LRCLIB's JSON shape, and its CORS headers copy the ones in LRCLIB's
source (tower-http CorsLayer: any origin, any method, headers content-type, x-user-agent, lrclib-client).
All songs and words here are made up.
Control: POST /__control {"mode": "normal"|"fail500", "delay": {"hollow weather": 2.5}}, GET /__log, POST /__reset."""
import json, re, sys, time, threading, unicodedata
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

def prep(s):
    s = unicodedata.normalize('NFKD', s or '').lower()
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"['’`]", '', s)
    return re.sub(r'[^\w]+', ' ', s).strip()

def lrc(lines):
    return '\n'.join(f'[{int(t // 60):02d}:{t % 60:05.2f}]{x}' for t, x in lines)

TRACKS = [
    dict(id=101, trackName='Hollow Weather', artistName='Juniper Kites', albumName='Static Gardens', duration=84.0, instrumental=False,
         plainLyrics='Hollow weather in the hall\nCoats are hanging on the wall\nRain is knocking, let it in\nHollow weather, here again',
         syncedLyrics=lrc([(3.2, 'Hollow weather in the hall'), (7.4, 'Coats are hanging on the wall'), (11.6, 'Rain is knocking, let it in'),
                           (15.8, 'Hollow weather, here again'), (20.0, 'Kettle humming on the stove'), (24.2, 'Windows fogging from above'),
                           (28.4, 'Someone singing down the stairs'), (32.6, 'Hollow weather everywhere'), (36.8, 'Pull the blanket, dim the light'),
                           (41.0, 'Hollow weather through the night'), (45.2, 'Count the drops along the sill'), (49.4, 'Hollow weather, hold me still'),
                           (53.6, 'Morning waits behind the grey'), (57.8, 'Hollow weather, stay, just stay'), (62.0, '')])),
    dict(id=102, trackName='Glass Rivers', artistName='Juniper Kites', albumName='Glass Rivers', duration=100.4, instrumental=False,
         plainLyrics='Glass rivers under frozen light\nWe skated out past the edge of night',
         syncedLyrics=lrc([(5.0, 'Glass rivers under frozen light'), (9.5, 'We skated out past the edge of night'), (14.0, '')])),
    dict(id=103, trackName='Slow Comets', artistName='Marigold Radio', albumName='Comet Season (Deluxe)', duration=118.0, instrumental=False,
         plainLyrics=None,
         syncedLyrics=lrc([(8.0, 'Slow comets crossing the porch'), (12.0, 'Tails like a borrowed torch'), (16.0, '')])),
    dict(id=104, trackName='Quiet Engines', artistName='Dune Theory', albumName='Engines', duration=80.0, instrumental=True,
         plainLyrics=None, syncedLyrics=None),
    dict(id=105, trackName='Lucky Stations', artistName='Neon Orchard', albumName='Dial Tone', duration=90.0, instrumental=False,
         plainLyrics='Lucky stations on the dial\nTurn it up and stay a while',
         syncedLyrics=lrc([(2.0, 'Lucky stations on the dial'), (6.0, 'Turn it up and stay a while'), (10.0, '')])),
    dict(id=106, trackName='Ivory Hour', artistName='Bright Hollow', albumName='Ivory', duration=77.0, instrumental=False,
         plainLyrics='Ivory hour, keys of light\nPlay it soft into the night',
         syncedLyrics=lrc([(4.5, 'Ivory hour, keys of light'), (9.0, 'Play it soft into the night'), (13.5, '')])),
    dict(id=108, trackName='Lanterns of Home', artistName='Velvet Comet', albumName='Night Signals', duration=120.0, instrumental=False,
         plainLyrics='Lanterns of home in the window\nCalling the long way round',
         syncedLyrics=lrc([(6.0, 'Lanterns of home in the window'), (10.5, 'Calling the long way round'), (15.0, '')])),
    dict(id=111, trackName='Night Swim', artistName='Velvet Comet', albumName='Duets', duration=98.0, instrumental=False,
         plainLyrics='Night swim under the pier lights\nCold water, warm hands',
         syncedLyrics=lrc([(4.0, 'Night swim under the pier lights'), (8.5, 'Cold water, warm hands'), (13.0, '')])),
    # two different songs called "Intro" of about the same length, for the no-artist rule
    dict(id=109, trackName='Intro', artistName='Band One', albumName='First', duration=92.0, instrumental=False,
         plainLyrics='Band one intro words', syncedLyrics=lrc([(1.0, 'Band one intro words')])),
    dict(id=110, trackName='Intro', artistName='Band Two', albumName='Second', duration=92.8, instrumental=False,
         plainLyrics='Band two intro words', syncedLyrics=lrc([(1.0, 'Band two intro words')])),
    # a different song with the same name as one in the library, to check that the artist has to match too
    dict(id=107, trackName='Nowhere Postcards', artistName='Somebody Else Entirely', albumName='Other', duration=203.0, instrumental=False,
         plainLyrics='This is the wrong song', syncedLyrics=lrc([(1.0, 'This is the wrong song')])),
]

STATE = {'mode': 'normal', 'delay': {}, 'log': []}
LOCK = threading.Lock()

def out(t):
    o = dict(t); o['name'] = t['trackName']; o['hasWordSync'] = False; o['lyricsfile'] = None
    return o

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header('access-control-allow-origin', '*')
        self.send_header('access-control-expose-headers', 'retry-after')
        self.send_header('vary', 'origin, access-control-request-method, access-control-request-headers')
    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code); self.cors()
        self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def record(self, method):
        u = urlparse(self.path)
        entry = dict(method=method, path=u.path, query={k: v[0] for k, v in parse_qs(u.query).items()},
                     headers={k.lower(): v for k, v in self.headers.items()}, t=time.time())
        if not u.path.startswith('/__'):
            with LOCK: STATE['log'].append(entry)
        return u, entry['query']
    def do_OPTIONS(self):
        self.record('OPTIONS')
        # what tower-http's CorsLayer answers to a preflight with the settings in LRCLIB's router.rs
        req_h = [h.strip().lower() for h in (self.headers.get('access-control-request-headers') or '').split(',') if h.strip()]
        allowed = {'content-type', 'x-user-agent', 'lrclib-client'}
        with LOCK: strict = STATE['mode'] == 'strictcors'
        self.send_response(200)
        self.send_header('access-control-allow-origin', '*')
        self.send_header('access-control-allow-methods', '*')
        # 'strictcors' pretends a server in between refuses the header, to test Encore's retry without it
        self.send_header('access-control-allow-headers', 'content-type,x-user-agent' if strict else 'content-type,x-user-agent,lrclib-client')
        self.send_header('vary', 'origin, access-control-request-method, access-control-request-headers')
        self.send_header('content-length', '0'); self.end_headers()
        if any(h not in allowed for h in req_h):
            sys.stderr.write(f'preflight asked for a header LRCLIB does not allow: {req_h}\n')
    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get('content-length') or 0)
        body = json.loads(self.rfile.read(n) or b'{}')
        if u.path == '/__control':
            with LOCK:
                if 'mode' in body: STATE['mode'] = body['mode']
                if 'delay' in body: STATE['delay'] = body['delay']
            return self.send_json(200, {'ok': True})
        if u.path == '/__reset':
            with LOCK: STATE['log'] = []; STATE['mode'] = 'normal'; STATE['delay'] = {}
            return self.send_json(200, {'ok': True})
        self.send_json(404, {})
    def do_GET(self):
        if self.path.startswith('/__log'):
            with LOCK: return self.send_json(200, STATE['log'])
        u, q = self.record('GET')
        with LOCK: mode = STATE['mode']; delay = dict(STATE['delay'])
        key = prep(q.get('track_name') or q.get('q') or '')
        for k, secs in delay.items():
            if k in key: time.sleep(secs)
        if mode == 'fail500':
            return self.send_json(500, {'code': 500, 'name': 'UnknownError', 'message': 'test failure'})
        if u.path == '/api/get':
            tn, an = prep(q.get('track_name')), prep(q.get('artist_name'))
            if not tn or not an:
                return self.send_json(400, {'code': 400, 'name': 'ValidationError', 'message': 'missing'})
            dur = float(q['duration']) if q.get('duration') else None
            if dur is not None and not (1 <= dur <= 3600):  # LRCLIB: "must be between 1 and 3600"
                return self.send_json(400, {'code': 400, 'name': 'ValidationError', 'message': 'duration: must be between 1 and 3600'})
            alb = prep(q.get('album_name')) if q.get('album_name') else None
            for t in TRACKS:
                if prep(t['trackName']) == tn and prep(t['artistName']) == an and (alb is None or prep(t['albumName']) == alb) \
                        and (dur is None or abs(t['duration'] - dur) <= 2):
                    return self.send_json(200, out(t))
            return self.send_json(404, {'code': 404, 'name': 'TrackNotFound', 'message': 'Failed to find specified track'})
        if u.path == '/api/search':
            # like LRCLIB's search index: q = every word somewhere in song, artist or album;
            # track_name = the words in a row in the song name; artist_name = all its words in the artist; album_name = in a row
            def phrase(words, field):
                f = prep(field).split()
                return any(f[i:i + len(words)] == words for i in range(len(f) - len(words) + 1))
            if q.get('q'):
                words = prep(q['q']).split()
                hits = [t for t in TRACKS if all(w in prep(t['trackName'] + ' ' + t['artistName'] + ' ' + t['albumName']).split() for w in words)]
            elif q.get('track_name'):
                tw, aw = prep(q.get('track_name')).split(), prep(q.get('artist_name')).split()
                al = prep(q.get('album_name')).split()
                hits = [t for t in TRACKS if phrase(tw, t['trackName']) and all(w in prep(t['artistName']).split() for w in aw)
                        and (not al or phrase(al, t['albumName']))]
            else:
                hits = []
            return self.send_json(200, [out(t) for t in hits[:20]])
        self.send_json(404, {'code': 404, 'name': 'NotFound', 'message': 'no route'})

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8091
    ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
