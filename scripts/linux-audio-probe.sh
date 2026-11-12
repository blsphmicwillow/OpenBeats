#!/usr/bin/env bash
# Collects everything needed to explain "OpenBeats is silent" on Linux, in one
# file the tester can paste back. Read-only: it starts nothing and changes no
# setting.
#
#   ./scripts/linux-audio-probe.sh            # writes openbeats-audio-probe.txt
#   ./scripts/linux-audio-probe.sh out.txt
#
# Every command is optional. A missing tool is reported, not treated as a
# failure: the point is to see which part of the chain is missing.
set -uo pipefail

out="${1:-openbeats-audio-probe.txt}"
exec >"$out" 2>&1

say() { printf '\n=== %s ===\n' "$1"; }

say "generated"
date -Is
printf 'OpenBeats %s\n' "$(node -p "require('./package.json').version" 2>/dev/null || echo 'version unknown')"

say "/etc/os-release"
cat /etc/os-release 2>/dev/null || echo 'missing'

say "session"
printf 'XDG_RUNTIME_DIR=%s\nPULSE_SERVER=%s\nPULSE_SINK=%s\n' \
  "${XDG_RUNTIME_DIR:-}" "${PULSE_SERVER:-}" "${PULSE_SINK:-}"
id

say "pactl info"
if command -v pactl >/dev/null; then pactl info; else echo 'pactl not installed'; fi

say "sinks"
if command -v pactl >/dev/null; then
  pactl list sinks 2>/dev/null | grep -E '^(Sink|	Name|	State|	Description|	Sample Specification|	Volume|	Mute)' || true
else
  echo 'pactl not installed'
fi

say "sink-inputs (which app owns which stream)"
if command -v pactl >/dev/null; then
  pactl list sink-inputs 2>/dev/null |
    grep -E '^(Sink Input|	Sink:|	Volume:|	Mute:|	Corked:|	application\.name|	application\.process|	media\.name|	Sample Specification)' || true
else
  echo 'pactl not installed'
fi

say "card profiles"
if command -v pactl >/dev/null; then
  pactl list cards 2>/dev/null | grep -E '^(Card|	Name:|	Active Profile|	Available profile|	*)' | head -60
else
  echo 'pactl not installed'
fi

say "aplay -L (ALSA PCM names; needs alsa-utils)"
if command -v aplay >/dev/null; then aplay -L 2>&1 | head -40; else echo 'aplay not installed — install alsa-utils'; fi

say "ALSA bridge plugins present"
ls /usr/lib/x86_64-linux-gnu/alsa-lib/ 2>/dev/null || echo 'no alsa-lib plugin directory'

say "pw-top (two batches: quantum and xrun counters per node)"
if command -v pw-top >/dev/null; then timeout 6 pw-top -b -n 2 2>&1; else echo 'pw-top not installed'; fi

say "AppImage libs that shadow the host"
# The AppImage unpacks next to /tmp; look for the libva family, which is known to
# shadow the host copy and break ALSA's rate plugin.
for dir in /tmp/appimage_extracted_* /tmp/.mount_OpenBean*; do
  [ -d "$dir" ] || continue
  printf '%s:\n' "$dir"
  find "$dir" -name 'libva*' -o -name 'libdrm*' -o -name 'libgallium*' 2>/dev/null | head -20
done

say "recent journal lines mentioning pipewire/alsa (if readable)"
journalctl --user -n 60 --no-pager 2>/dev/null | grep -iE 'pipewire|wireplumber|alsa|openbeats' | tail -30 ||
  echo 'journal not readable'

say "done"
echo "Send $out back with the Stream health line and the Test tone verdict."
