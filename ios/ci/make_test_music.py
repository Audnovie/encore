#!/usr/bin/env python3
"""The test library for the app tests on CI: short tone-only songs with made-up names, made with ffmpeg.
Songs 1-3 are 6 s (moving on by itself), 4-6 are 20 s (lock screen buttons), and one Windows Media song,
which iPhones can't play, so the app has to ask Navidrome for MP3 instead. (WMA rather than Ogg: it's made
with ffmpeg's own encoder, which every ffmpeg build has, and no iOS version has ever played it.)"""
import os, shutil, subprocess, sys

root = sys.argv[1]
shutil.rmtree(root, ignore_errors=True)

songs = [
    # (file, title, album, track, seconds, tone Hz)
    ('Encore Test/Short Songs/01 Song 1.mp3', 'Song 1', 'Short Songs', 1, 6, 330),
    ('Encore Test/Short Songs/02 Song 2.mp3', 'Song 2', 'Short Songs', 2, 6, 392),
    ('Encore Test/Short Songs/03 Song 3.mp3', 'Song 3', 'Short Songs', 3, 6, 440),
    ('Encore Test/Long Songs/01 Song 4.mp3', 'Song 4', 'Long Songs', 1, 20, 494),
    ('Encore Test/Long Songs/02 Song 5.mp3', 'Song 5', 'Long Songs', 2, 20, 523),
    ('Encore Test/Long Songs/03 Song 6.mp3', 'Song 6', 'Long Songs', 3, 20, 587),
    ('Encore Test/Other/WMA Song.wma', 'WMA Song', 'Other', 1, 6, 659),
]

for path, title, album, track, seconds, hz in songs:
    out = os.path.join(root, path)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
           '-f', 'lavfi', '-i', f'sine=frequency={hz}:duration={seconds}:sample_rate=44100',
           '-metadata', f'title={title}', '-metadata', 'artist=Encore Test', '-metadata', f'album={album}',
           '-metadata', f'track={track}', '-metadata', 'album_artist=Encore Test']
    if out.endswith('.mp3'):
        cmd += ['-c:a', 'libmp3lame', '-b:a', '128k', '-id3v2_version', '3']
    else:
        cmd += ['-c:a', 'wmav2', '-b:a', '128k']
    subprocess.run(cmd + [out], check=True)
    print('made', path)
