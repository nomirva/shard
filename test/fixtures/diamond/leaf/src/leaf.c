#include "leaf/leaf.h"
int leaf(void) { return 40 + leaf_nested() - 40; }
