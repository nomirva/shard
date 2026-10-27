#include <stdio.h>
#include "version.h"

int main(void) {
    printf("version %s\n", app_version());
    return 0;
}
