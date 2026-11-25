#!/bin/sh
# Optional full bootstrap and regression verification. No Python, Node or Make.
set -ex
cd "$(dirname "$0")"
gcc -std=c90 -pedantic-errors -Wall -Wextra -O2 jsvm.c -lm -o jsvm
./jsvm -c jsvm.js -o jsvm.bc
./jsvm jsvm.js -c jsvm.js -o jsvm2.bc
./jsvm -b jsvm.bc -c jsvm.js -o jsvm3.bc
cmp jsvm.bc jsvm2.bc
cmp jsvm.bc jsvm3.bc
./jsvm jsvm.js jsvm.js -c jsvm.js -o jsvm4.bc
cmp jsvm.bc jsvm4.bc
printf '%s\n' 'All four bootstrap bytecode files are identical.'
./jsvm -c bootstrap-test.js -o bootstrap-test.bc
./jsvm jsvm.js -c bootstrap-test.js -o bootstrap-test2.bc
./jsvm jsvm.js jsvm.js -c bootstrap-test.js -o bootstrap-test4.bc
cmp bootstrap-test.bc bootstrap-test2.bc
cmp bootstrap-test.bc bootstrap-test4.bc
./jsvm -b bootstrap-test.bc
./jsvm jsvm.js -b bootstrap-test.bc
./jsvm -b jsvm.bc -b bootstrap-test.bc
./jsvm jsvm.js jsvm.js -b bootstrap-test.bc
for f in test.js switch.js catch.js optimizer-test.js io-test.js; do
    ./jsvm -c "$f" -o regression.bc
    ./jsvm -b regression.bc
done
for f in optimizer-test.js io-test.js; do
    ./jsvm -c "$f" -o regression.bc
    ./jsvm jsvm.js -b regression.bc
    ./jsvm -b jsvm.bc -b regression.bc
    ./jsvm jsvm.js jsvm.js -b regression.bc
done
