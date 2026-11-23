#!/usr/bin/env bash
# Runs a command that uses apt (apt-get itself, or `playwright install-deps`) with bounded attempts (#2436).
# A stalled Ubuntu mirror used to hold the step until the job's time bound cancelled the whole job. Here apt gives up
# on a silent connection after 30 seconds and retries each download, every attempt ends after APT_ATTEMPT_SECONDS
# (default 240; a normal install takes under a minute), and a failed attempt is retried twice before the step fails
# under its own name.
# Usage: .github/scripts/apt-retry.sh bash -c 'sudo apt-get update && sudo apt-get install -y <packages>'
# (the package lists in the same attempt, so a stalled list download is retried too).
set -uo pipefail

attempts=3
limit="${APT_ATTEMPT_SECONDS:-240}"

sudo tee /etc/apt/apt.conf.d/99-reqseq-ci >/dev/null <<'CONF'
Acquire::Retries "3";
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
CONF

for attempt in $(seq 1 "$attempts"); do
  timeout --kill-after=10 "$limit" "$@" && exit 0
  status=$?
  echo "::warning title=apt::Attempt $attempt of $attempts failed or exceeded ${limit} s (exit $status): $*"
  # A killed apt can leave dpkg half-configured; finish that before the next attempt.
  sudo dpkg --configure -a || true
done
echo "::error title=apt::All $attempts attempts failed: $*"
exit 1
