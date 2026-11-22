#!/bin/sh
# Command line, MCP server and web UI of the delivery (ADR-0020): runs the CLI in lib/ on the delivery's own Node in
# runtime/. NODE_OPTIONS is unset, so options from the environment cannot change the program. It follows a symbolic
# link to itself, so a link in ~/.local/bin works too.
self=$0
while [ -L "$self" ]; do
  link=$(readlink "$self")
  case $link in /*) self=$link ;; *) self=$(dirname "$self")/$link ;; esac
done
root=$(cd "$(dirname "$self")/.." && pwd -P)
unset NODE_OPTIONS
exec "$root/runtime/node" "$root/lib/dist/bin.js" "$@"
