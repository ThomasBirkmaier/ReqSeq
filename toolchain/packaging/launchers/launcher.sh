#!/bin/sh
# Command line and MCP server of the delivery (ADR-0014): runs the CLI in resources/cli on the delivery's own
# Electron binary as plain Node (ELECTRON_RUN_AS_NODE=1). @PRODUCT@ is filled in from names.json by
# scripts/package/stage.mjs. It follows a symbolic link to itself, so a link in ~/.local/bin works too.
self=$0
while [ -L "$self" ]; do
  link=$(readlink "$self")
  case $link in /*) self=$link ;; *) self=$(dirname "$self")/$link ;; esac
done
bin=$(cd "$(dirname "$self")" && pwd -P)
case $(uname -s) in
  Darwin) electron=$bin/../../MacOS/@PRODUCT@; resources=$bin/.. ;;
  *) electron=$bin/../@PRODUCT@; resources=$bin/../resources ;;
esac
ELECTRON_RUN_AS_NODE=1 exec "$electron" "$resources/cli/dist/bin.js" "$@"
