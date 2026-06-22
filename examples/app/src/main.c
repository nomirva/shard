#include <stdio.h>
#include "greet.h"
#include "math_util.h"

int main(void) {
    greet("world");

    printf("2 + 3 = %d\n", add(2, 3));
    printf("4 * 5 = %d\n", mul(4, 5));

    return 0;
}
