# Encore

An Apple Music–style player for [Navidrome](https://www.navidrome.org/) (and other Subsonic servers).

- **`web/`** — Encore itself: one self-contained HTML page (vanilla JavaScript) you host next to Navidrome
  and open in Safari or add to the Home Screen.
- **`ios/`** — Encore's iPhone app: the same page in a web view, with the iPhone playing the music itself.
  Songs keep going and move on while the phone is locked, and the lock screen controls always work, which a
  Home Screen web app can't promise (iOS pauses web pages in the background).

## The page (`web/`)

`web/src/` holds the page in five parts (head, styles, body, script, tail). `python3 web/build.py` joins them
into `web/dist/encore.html`. Serve that as `index.html`, with `/rest/` passed through to Navidrome on the same
address (then the Server box can be left empty when signing in).

Tests (`web/tests/`, Playwright + a real Navidrome):

- `test_lyrics.py`, `test_smoke.py`, `test_same_origin.py` — lyrics, the rest of the app, the nginx setup
- `test_native.py` — the page's side of the iPhone app, against `native_fake.py`, a stand-in for the app that
  follows the same rules as the Swift player

## The iPhone app (`ios/`)

Generate the Xcode project with [XcodeGen](https://github.com/yonaskolb/XcodeGen): `cd ios && xcodegen generate`.

- `RootViewController` — the web view, the first screen (Encore's address), the "can't reach it" screen
- `Bridge` — messages between the page and the player
- `PlayerEngine` — AVQueuePlayer, the lock screen (Now Playing, remote commands), plays registered with the
  server, listening time
- `QueueState`, `EventLog` — the parts that don't need audio (unit-tested)
- `Diagnostics` — a record of what the app and iOS did with the sound (the app in front or behind, the audio
  session, calls and other apps taking the sound, outputs, lock screen buttons, the player and its songs), kept
  on the phone. Touch and hold the app's icon → **Copy Diagnostics** puts how things stand and the latest of it
  on the clipboard. Web and IP addresses are hidden (the music server's carry the sign-in token).

The app is unsigned; install it with a sideloading tool such as Sideloadly (a free Apple ID works; the app has
to be refreshed every 7 days).

### How the page and the app work together

The page still decides everything about the queue. It sends the app the song to play (`load`) and the coming
songs and the ones before (`upcoming`, up to 300 ahead, including future times round a repeated, shuffled list,
which the page draws in advance so both agree). The app plays through them by itself.

Whatever the app does by itself — moving on, a lock screen button, a song that won't play, a play registered
with the server, listening time — it records as numbered news (`seq`), saved on the phone until the page
confirms it (`ack`). When the page wakes up (or reloads, or the app was closed), it gets all of it in order and
replays it, so its queue, history and stats end up where the app is. Where its own next move would have gone
somewhere else, it goes where the app went (that's what was heard), without loading anything or starting playback.
Each `load` carries a number (`req`); the app stamps its news with the last one it saw, so news about an older
request is ignored.

## CI

`.github/workflows/ios.yml`, on GitHub's Mac runners:

1. builds the app and runs the unit tests (the real player with tone files, the queue, the news log)
2. starts Navidrome (with a test library of tone-only songs) and nginx serving this commit's page, then runs
   the app tests against them in the simulator (playing, moving on in the background, lock screen buttons,
   catching up after sleeping or being closed, songs that need the MP3 fallback or won't play, repeat one, the
   audio session staying the music kind, Copy Diagnostics from the Home Screen icon's menu)
3. builds the unsigned `Encore.ipa` and, when every test passed, publishes it with `encore.html` as the
   `latest` release

Logs and screenshots of each run go to the `ci-logs-ios` branch.
