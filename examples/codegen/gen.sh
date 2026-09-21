#!/bin/sh
set -e
mkdir -p src

cat > src/generated.h <<'EOF'
#ifndef GENERATED_H
#define GENERATED_H

int shard_answer(void);

#endif
EOF

cat > src/generated.c <<'EOF'
#include "generated.h"

int shard_answer(void) {
    return 42;
}
EOF
