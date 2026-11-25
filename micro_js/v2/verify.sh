#!/bin/sh
# Optional regression and bootstrap verification. No Python, Node, or Make.
set -eu
cd "$(dirname "$0")"
gcc -std=c90 -pedantic-errors -Wall -Wextra -O2 jsvm.c -lm -o jsvm
./jsvm -c jsvm.js -o jsvm.bc
./jsvm jsvm.js -c jsvm.js -o jsvm2.bc
./jsvm -b jsvm.bc -c jsvm.js -o jsvm3.bc
cmp jsvm.bc jsvm2.bc
cmp jsvm.bc jsvm3.bc
printf '%s\n' 'All three bootstrap bytecode files are identical.'
./jsvm -c bootstrap-test.js -o bootstrap-test.bc
./jsvm jsvm.js -c bootstrap-test.js -o bootstrap-test2.bc
cmp bootstrap-test.bc bootstrap-test2.bc
./jsvm -b bootstrap-test.bc
./jsvm jsvm.js -b bootstrap-test.bc
./jsvm -b jsvm.bc -b bootstrap-test.bc
for f in test.js switch.js catch.js; do
    ./jsvm -c "$f" -o regression.bc
    ./jsvm -b regression.bc
done
