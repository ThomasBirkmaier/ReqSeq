#!/usr/bin/env bash
# Runs the delivery tests (`vitest.delivery.config.ts`, ADR-0011, ADR-0014, #324) on the artifacts in
# $REQSEQ_DELIVERY_DIR (default: delivery/). Used by .github/workflows/release.yml.
#
# macOS and Windows (Git Bash): as the current user, without a network namespace (they have none).
# Linux: in a network namespace with loopback only, made by root without a user namespace, while the tests run
# as the calling (non-root) user: `unshare -rn` would map the user to root, and Chromium starts as root only
# without its sandbox, which ReqSeq never does. The user needs passwordless sudo: for the namespace, and for
# the documented one-time admin step on `chrome-sandbox` that the app test takes where user namespaces are
# blocked. Under xvfb when it is installed (the app start needs a display; Xvfb is started inside the
# namespace, where its socket is reachable). REQSEQ_DELIVERY_OFFLINE=1 tells the tests they run in the
# namespace: on Linux the tests without network fail without it, and check the namespace when it is set.
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
xvfb=""
if command -v xvfb-run >/dev/null 2>&1; then
  xvfb="xvfb-run -a"
fi

# sudo resets PATH and HOME, so they are passed on as arguments. $6 is split on purpose ("xvfb-run -a" or empty).
exec sudo -n unshare -n sh -c '
  ip link set lo up
  cd "$1"
  exec sudo -n -u "$2" env PATH="$3" HOME="$4" REQSEQ_DELIVERY_DIR="$5" REQSEQ_DELIVERY_OFFLINE=1 $6 \
    ./node_modules/.bin/vitest run --config vitest.delivery.config.ts
' sh "$repo" "$(id -un)" "$PATH" "$HOME" "$delivery" "$xvfb"
