#!/usr/bin/env bash
# Runs a command that uses apt (apt-get itself, or `playwright install-deps`) and restarts it when it stalls (#2436).
# A stalled Ubuntu mirror used to hold the step, without output, until the job's time bound cancelled the whole job.
# A slow mirror, though, can take over 10 minutes for a green install (94 kB/s on 2026-11-23), so a fixed time limit
# would fail runs that make progress. An attempt therefore counts as stalled only when neither its output nor apt's
# partial downloads grew for APT_STALL_SECONDS (default 180); then it is stopped and retried, up to three attempts,
# before the step fails under its own name. Finished downloads stay in apt's cache for the next attempt.
# Usage: .github/scripts/apt-retry.sh bash -c 'sudo apt-get update && sudo apt-get install -y <packages>'
# (the package lists in the same attempt, so a stalled list download is retried too).
# A slow mirror that keeps moving is no stall, though: 126 MB at 124 kB/s took 16.5 minutes and the job's time bound
# cancelled the tests after it (#2473). With APT_DEB_CACHE set to a folder (kept by the workflow's cache), the .deb
# files in it go into apt's cache before the first attempt, and after a successful one the folder holds the .deb
# files of apt's cache; apt then downloads only the packages whose version changed since.
set -uo pipefail

attempts=3
stall="${APT_STALL_SECONDS:-180}"
log="$(mktemp)"
export APT_RETRY_LOG="$log"
debs="${APT_DEB_CACHE:-}"

# apt gives up on a silent connection after 30 s and retries the download itself; a later attempt waits for the
# lock a stopped one may still hold.
sudo tee /etc/apt/apt.conf.d/99-reqseq-ci >/dev/null <<'CONF'
Acquire::Retries "3";
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
DPkg::Lock::Timeout "120";
CONF

if [ -n "$debs" ]; then
  echo 'APT::Keep-Downloaded-Packages "true";' | sudo tee -a /etc/apt/apt.conf.d/99-reqseq-ci >/dev/null
  mkdir -p "$debs"
  if compgen -G "$debs/*.deb" >/dev/null; then sudo cp "$debs"/*.deb /var/cache/apt/archives/; fi
  echo "apt-retry: $(find "$debs" -maxdepth 1 -name '*.deb' | wc -l) .deb files from the cache"
fi

# After a successful attempt: the .deb files of apt's cache into APT_DEB_CACHE. autoclean first drops the versions
# the package lists no longer offer (those of an older entry that apt replaced), so the cache does not grow.
keep_debs() {
  [ -n "$debs" ] || return 0
  rm -f "$debs"/*.deb &&
    sudo apt-get autoclean -qq &&
    sudo find /var/cache/apt/archives -maxdepth 1 -name '*.deb' -exec cp -t "$debs" {} + &&
    sudo chown -R "$(id -u):$(id -g)" "$debs" || return 1
  echo "apt-retry: $(find "$debs" -maxdepth 1 -name '*.deb' | wc -l) .deb files for the cache, $(du -sh "$debs" | cut -f1)"
}

# Bytes of output plus bytes in apt's partial download folders: a stall changes neither.
progress() {
  local downloads
  downloads="$(sudo du -sb /var/lib/apt/lists/partial /var/cache/apt/archives/partial 2>/dev/null |
    awk '{ s += $1 } END { print s + 0 }')"
  echo "$(stat -c %s "$log") $downloads"
}

stop() {
  # sudo relays SIGTERM to apt; SIGKILL cannot be relayed, so the apt processes are named after a grace period.
  sudo kill -TERM -- "-$1" 2>/dev/null
  sleep 10
  sudo kill -KILL -- "-$1" 2>/dev/null
  sudo pkill -KILL -x apt-get 2>/dev/null
  sudo pkill -KILL -f '^/usr/lib/apt/methods/' 2>/dev/null
}

for attempt in $(seq 1 "$attempts"); do
  : >"$log"
  # In a process group of its own, so that the whole pipeline can be stopped.
  setsid bash -c '"$@" 2>&1 | tee -a "$APT_RETRY_LOG"; exit "${PIPESTATUS[0]}"' apt-retry "$@" &
  pid=$!
  last="" idle=0 stalled=false
  while kill -0 "$pid" 2>/dev/null; do
    sleep 10
    now="$(progress)"
    if [ "$now" = "$last" ]; then idle=$((idle + 10)); else idle=0 last="$now"; fi
    if [ "$idle" -ge "$stall" ]; then
      stalled=true
      stop "$pid"
      break
    fi
  done
  wait "$pid"
  status=$?
  if [ "$stalled" = false ] && [ "$status" -eq 0 ]; then
    # A partial folder must not become a cache entry: without the folder, the save step saves nothing.
    if ! keep_debs; then
      echo "::warning title=apt::Could not collect the .deb files for the cache"
      rm -rf "$debs"
    fi
    exit 0
  fi
  if [ "$stalled" = true ]; then
    echo "::warning title=apt::Attempt $attempt of $attempts stalled (no progress for ${stall} s): $*"
  else
    echo "::warning title=apt::Attempt $attempt of $attempts failed (exit $status): $*"
  fi
  # A stopped apt can leave dpkg half-configured; finish that before the next attempt.
  sudo dpkg --configure -a || true
done
echo "::error title=apt::All $attempts attempts failed: $*"
exit 1
