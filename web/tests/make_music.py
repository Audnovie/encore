#!/usr/bin/env python3
"""Builds a small test library for Navidrome: tone-only MP3s with tags, some with lyrics
(an .lrc file next to the song, plain lyrics in the file, or timed LRC text in the file).
All names and words are made up for testing."""
import os, subprocess, sys, shutil
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TRCK, TPE2, USLT

root = sys.argv[1]
shutil.rmtree(root, ignore_errors=True)

PAPER = """[ti:Paper Lanterns]
[ar:Velvet Comet]
[00:04.00]Paper lanterns over Mercer Street
[00:08.50]We hung them up with borrowed string
[00:13.00]The wind came in and we let it sing
[00:17.50]
[00:24.00]Hold the light a little higher
[00:28.00]Hold the light until it's morning
[00:32.50]Every lantern needs a fire
[00:37.00]Every fire needs a warning
[00:41.50]
[00:52.00]Paper lanterns, paper lanterns
[00:56.00]Floating out across the water
[01:00.50]Paper lanterns, paper lanterns
[01:05.00]Brighter than we ever thought of
[01:10.00]
"""
NORTHERN = """Radio towers blinking red
Counting signals in my head


Northern signals, northern signals
Calling out across the snow"""
BORROWED = """[offset:+1000]
[00:06.00]Borrowed hours on a borrowed clock
[00:10.00]Winding back the hands we stopped
[00:14.00]Keep the change and keep the time
[00:18.00]Every minute here is mine
"""
LUCKY_PLAIN = """Lucky stations on the dial
(untimed copy stored in the file)"""

songs = [
    # (artist folder, album, track, title, artist tag or None, seconds, lrc sidecar, embedded lyrics)
    ('Velvet Comet', 'Night Signals', 1, 'Paper Lanterns', 'Velvet Comet', 92, PAPER, None),
    ('Aster Lane', 'Harbor Lights', 1, 'Northern Signals', 'Aster Lane', 70, None, NORTHERN),
    ('Juniper Kites', 'Static Gardens', 1, 'Hollow Weather', 'Juniper Kites', 84, None, None),
    ('JuniperKitesVEVO', 'Uploads', 1, 'Juniper Kites - Glass Rivers (Official Video)', 'JuniperKitesVEVO', 101, None, None),
    ('Marigold Radio', 'Comet Season', 1, 'Slow Comets', 'Marigold Radio', 95, None, None),
    ('Dune Theory', 'Engines', 1, 'Quiet Engines', 'Dune Theory', 80, None, None),
    ('Tidal Postcards', 'Postcards', 1, 'Nowhere Postcards', 'Tidal Postcards', 75, None, None),
    ('Saffron Skies', 'Clockwork', 1, 'Borrowed Hours', 'Saffron Skies', 88, None, BORROWED),
    ('Neon Orchard', 'Dial Tone', 1, 'Lucky Stations', 'Neon Orchard', 90, None, LUCKY_PLAIN),
    ('No Artist', 'Loose Files', 1, 'Ivory Hour', None, 77, None, None),
    # two artists in one tag (Navidrome keeps "A, B" as one artist name)
    ('Velvet Comet, Aster Lane', 'Duets', 1, 'Night Swim', 'Velvet Comet, Aster Lane', 98, None, None),
    # an instrumental version named as one, same length as the sung version on LRCLIB
    ('Juniper Kites', 'Static Gardens (Instrumentals)', 1, 'Hollow Weather - Instrumental', 'Juniper Kites', 84, None, None),
]
for folder, album, track, title, artist, secs, lrc, emb in songs:
    d = os.path.join(root, folder, album)
    os.makedirs(d, exist_ok=True)
    safe = title.replace('/', '_')
    path = os.path.join(d, f'{track:02d} - {safe}.mp3')
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
                    f'sine=frequency={220 + 30 * track}:sample_rate=22050:duration={secs}', '-af', 'volume=0.03',
                    '-ac', '1', '-b:a', '48k', path], check=True)
    tags = ID3()
    tags.add(TIT2(encoding=3, text=title))
    if artist:
        tags.add(TPE1(encoding=3, text=artist))
        tags.add(TPE2(encoding=3, text=artist))
    tags.add(TALB(encoding=3, text=album))
    tags.add(TRCK(encoding=3, text=str(track)))
    if emb:
        tags.add(USLT(encoding=3, lang='eng', desc='', text=emb))
    tags.save(path)
    if lrc:
        with open(path[:-4] + '.lrc', 'w', encoding='utf-8') as f:
            f.write(lrc)
    print('made', path)
