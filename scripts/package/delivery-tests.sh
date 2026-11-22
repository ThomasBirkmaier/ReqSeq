#!/usr/bin/env bash
# Runs the delivery tests (`vitest.delivery.config.ts`, ADR-0011, ADR-0020, #2308) on the artifacts in
# $REQSEQ_DELIVERY_DIR (default: delivery/). Used by .github/workflows/release.yml.
#
# macOS and Windows (Git Bash): as the current user, without a network namespace (they have none).
# Linux: in a network namespace with loopback only, made by root without a user namespace, while the tests run as
# the calling (non-root) user, as a user runs the delivery, on a virtual display with a session bus of their own
# for the desktop shell (SR-252 AK1). Then, as the last step, the web engine's package is removed
# (`dpkg -r --force-depends`, no network needed) and the test of SR-252 AK8 runs once more without it
# (REQSEQ_DELIVERY_NO_ENGINE=1); its results join test-results/junit-delivery.xml.
# The user needs passwordless sudo for the namespace. REQSEQ_DELIVERY_OFFLINE=1 tells the tests they run in the
# namespace: on Linux the tests without network fail without it, and check the namespace when it is set.
# PLAYWRIGHT_BROWSERS_PATH, if set, names where the browsers are.
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
delivery="${REQSEQ_DELIVERY_DIR:-$repo/delivery}"
cd "$repo"

if [ "$(uname -s)" != "Linux" ]; then
  REQSEQ_DELIVERY_DIR="$delivery" exec ./node_modules/.bin/vitest run --config vitest.delivery.config.ts
fi

if [ "$(id -u)" = "0" ]; then
  echo "delivery-tests.sh: run it as a normal user with passwordless sudo, not as root" >&2
  exit 1
fi

# Runs vitest in the namespace as this user, with REQSEQ_DELIVERY_NO_ENGINE=$1, the JUnit file $2 and the arguments
# after them; sudo resets PATH and HOME, so they are passed on as arguments.
offline() {
  sudo -n unshare -n sh -c '
    ip link set lo up
    cd "$1"
    user="$2" path="$3" home="$4" dir="$5" browsers="$6" engine="$7" junit="$8"
    shift 8
    exec sudo -n -u "$user" env PATH="$path" HOME="$home" REQSEQ_DELIVERY_DIR="$dir" PLAYWRIGHT_BROWSERS_PATH="$browsers" \
      REQSEQ_DELIVERY_OFFLINE=1 REQSEQ_DELIVERY_NO_ENGINE="$engine" REQSEQ_DELIVERY_JUNIT="$junit" \
      xvfb-run -a dbus-run-session -- ./node_modules/.bin/vitest run --config vitest.delivery.config.ts "$@"
  ' sh "$repo" "$(id -un)" "$PATH" "$HOME" "$delivery" "${PLAYWRIGHT_BROWSERS_PATH:-}" "$@"
}

status=0
offline "" test-results/junit-delivery.xml --exclude packages/shell/test/delivery/no-engine.test.ts || status=$?
sudo -n dpkg -r --force-depends libwebkit2gtk-4.1-0
offline 1 test-results/junit-delivery-no-engine.xml packages/shell/test/delivery/no-engine.test.ts || status=$?
node scripts/package/merge-junit.mjs test-results/junit-delivery.xml test-results/junit-delivery-no-engine.xml
exit "$status"
