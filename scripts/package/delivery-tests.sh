#!/usr/bin/env bash
# Runs the delivery tests (`vitest.delivery.config.ts`, ADR-0011, ADR-0020, #2308) on the artifacts in
# $REQSEQ_DELIVERY_DIR (default: delivery/). Used by .github/workflows/release.yml.
#
# macOS and Windows (Git Bash): as the current user, without a network namespace (they have none).
# Linux: in a network namespace with loopback only, made by root without a user namespace, while the tests run as
# the calling (non-root) user, as a user runs the delivery.
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

# sudo resets PATH and HOME, so they are passed on as arguments.
exec sudo -n unshare -n sh -c '
  ip link set lo up
  cd "$1"
  exec sudo -n -u "$2" env PATH="$3" HOME="$4" REQSEQ_DELIVERY_DIR="$5" PLAYWRIGHT_BROWSERS_PATH="$6" \
    REQSEQ_DELIVERY_OFFLINE=1 ./node_modules/.bin/vitest run --config vitest.delivery.config.ts
' sh "$repo" "$(id -un)" "$PATH" "$HOME" "$delivery" "${PLAYWRIGHT_BROWSERS_PATH:-}"
