#include "calc.h"

_Static_assert(sizeof(int) >= 4, "int must be at least 32-bit");

int calc_square(int x) {
    return x * x;
}
