#!/usr/bin/env zsh
# shard — C build manager
# Source in ~/.zshrc to add to PATH:
#   source /path/to/shard.sh

export PATH="$(dirname "$0"):$PATH"
bun run "$(dirname "$0")/shard.ts" "$@"
