#!/bin/bash
# The simulator plays sound through the Mac's audio output. GitHub's Mac runners usually have a
# "Null Audio Device", but sometimes start without one (actions/runner-images#13668), and then AVPlayer
# doesn't play. Check, restart Core Audio if it's missing, and as a last resort install BlackHole.
set -uo pipefail

outputs() {
  system_profiler SPAudioDataType -json 2>/dev/null | python3 -c '
import json, sys
try:
    items = json.load(sys.stdin).get("SPAudioDataType", [])
except Exception:
    items = []
names = []
for group in items:
    for dev in group.get("_items", []):
        if any(k.startswith("coreaudio_device_output") for k in dev):
            names.append(dev.get("_name", "?"))
print("\n".join(names))'
}

echo "== audio outputs"
OUT=$(outputs); echo "${OUT:-(none)}"
if [ -z "$OUT" ]; then
  echo "== no output: restarting Core Audio"
  sudo launchctl kickstart -kp system/com.apple.audio.coreaudiod || sudo killall coreaudiod || true
  sleep 5
  OUT=$(outputs); echo "${OUT:-(none)}"
fi
if [ -z "$OUT" ]; then
  echo "== still none: installing BlackHole"
  brew install --cask blackhole-2ch 2>&1 | tail -3 || true
  sudo launchctl kickstart -kp system/com.apple.audio.coreaudiod || sudo killall coreaudiod || true
  sleep 5
  OUT=$(outputs); echo "${OUT:-(none)}"
fi
[ -n "$OUT" ] && echo "AUDIO OK" || echo "AUDIO MISSING (the playback tests will probably fail)"
exit 0
