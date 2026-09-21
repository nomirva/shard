#include <stdio.h>

int main(void) {
#if !defined(__OPTIMIZE__)
    puts("profile: debug (-O0)");
#elif defined(__OPTIMIZE_SIZE__)
    puts("profile: size (-Os/-Oz)");
#else
    puts("profile: optimized (-O2/-O3)");
#endif
    return 0;
}
