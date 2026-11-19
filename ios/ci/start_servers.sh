#!/bin/bash
# Starts what the app tests talk to, set up the way the home server is:
#   Navidrome 0.63.2 on 127.0.0.1:4533 with a test library (make_test_music.py), user tester / encore-test-pw
#   nginx on 127.0.0.1:4540 serving this commit's Encore page, with /rest/ passed to Navidrome
# Needs ffmpeg and nginx (brew). Logs go to $WORK.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="${RUNNER_TEMP:-/tmp}/encore-ci"
ND_VERSION=0.63.2
USER_NAME=tester
PASSWORD=encore-test-pw
mkdir -p "$WORK"

echo "== Encore page"
python3 "$ROOT/web/build.py" encore.html
mkdir -p "$WORK/www"
cp "$ROOT/web/dist/encore.html" "$WORK/www/index.html"
grep -o "const APP_VERSION = '[^']*'" "$WORK/www/index.html"

echo "== test library"
python3 "$HERE/make_test_music.py" "$WORK/music"

echo "== Navidrome $ND_VERSION"
ARCH=$(uname -m); [ "$ARCH" = "x86_64" ] && ARCH=amd64
curl -fsSL -o "$WORK/nd.tgz" "https://github.com/navidrome/navidrome/releases/download/v$ND_VERSION/navidrome_${ND_VERSION}_darwin_${ARCH}.tar.gz"
mkdir -p "$WORK/nd" "$WORK/nd-data"
tar -xzf "$WORK/nd.tgz" -C "$WORK/nd"
(
  export ND_MUSICFOLDER="$WORK/music" ND_DATAFOLDER="$WORK/nd-data" ND_PORT=4533 ND_ADDRESS=127.0.0.1 ND_LOGLEVEL=info
  export ND_ENABLEINSIGHTSCOLLECTOR=false ND_ENABLEEXTERNALSERVICES=false ND_LASTFM_ENABLED=false ND_LISTENBRAINZ_ENABLED=false
  nohup "$WORK/nd/navidrome" > "$WORK/navidrome.log" 2>&1 &
)
for i in $(seq 1 60); do curl -fs -o /dev/null http://127.0.0.1:4533/ping && break; sleep 1; done
curl -fsS -X POST -H 'Content-Type: application/json' -d "{\"username\":\"$USER_NAME\",\"password\":\"$PASSWORD\"}" \
  http://127.0.0.1:4533/auth/createAdmin > /dev/null
API="u=$USER_NAME&p=$PASSWORD&v=1.16.1&c=ci&f=json"
curl -fsS "http://127.0.0.1:4533/rest/startScan?$API" > /dev/null
for i in $(seq 1 60); do
  N=$(curl -fsS "http://127.0.0.1:4533/rest/search3?$API&query=&songCount=50" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["subsonic-response"].get("searchResult3",{}).get("song",[])))')
  [ "$N" -ge 7 ] && break
  sleep 1
done
echo "songs in Navidrome: $N"
[ "$N" -ge 7 ]

echo "== nginx"
MIME="$(brew --prefix)/etc/nginx/mime.types"
mkdir -p "$WORK/nginx"
sed -e "s|@WORK@|$WORK|g" -e "s|@MIME@|$MIME|g" "$HERE/nginx.conf" > "$WORK/nginx/nginx.conf"
nginx -c "$WORK/nginx/nginx.conf"
for i in $(seq 1 20); do curl -fs -o /dev/null http://127.0.0.1:4540/ && break; sleep 0.5; done
curl -fsS "http://127.0.0.1:4540/rest/ping?$API"; echo
curl -fsS -o /dev/null -w "Encore page: HTTP %{http_code}, %{size_download} bytes\n" http://127.0.0.1:4540/
