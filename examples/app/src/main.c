#include <stdio.h>
#if defined(GREET)
#include "greet.h"
#elif defined(MATH)
#include "math_util.h"
#endif

int main(void) {
#if defined(GREET)
    greet("shard");
    return 0;
#elif defined(MATH)
    printf("2 + 3 = %d\n", add(2, 3));
    printf("4 * 5 = %d\n", mul(4, 5));
    return 0;
#else
#error "No variant selected. Build with: --def GREET | --def MATH"
#endif
}
