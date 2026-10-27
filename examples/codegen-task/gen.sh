#!/bin/sh
set -e
version=$(cat version.txt)
cat > "$SHARD_GEN_DIR/version.h" <<EOT
#ifndef VERSION_H
#define VERSION_H
const char *app_version(void);
#endif
EOT
cat > "$SHARD_GEN_DIR/version.c" <<EOT
#include "version.h"
const char *app_version(void) { return "$version"; }
EOT
