#!/bin/bash
set -euo pipefail
LABEL="nl.cube.poke-arena.sync"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/.poke-arena"
echo "Poke Arena sync verwijderd."
