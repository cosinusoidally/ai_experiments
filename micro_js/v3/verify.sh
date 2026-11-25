#!/bin/sh
# The shell script is optional: the VM builds with one GCC invocation.
set -ex
cd "$(dirname "$0")"
gcc -std=c90 -pedantic-errors -Wall -Wextra -O2 jsvm.c -lm -o jsvm
./jsvm -c jsvm.js -o jsvm.bc
./jsvm jsvm.js -c jsvm.js -o jsvm2.bc
./jsvm -b jsvm.bc -c jsvm.js -o jsvm3.bc
./jsvm jsvm.js jsvm.js -c jsvm.js -o jsvm4.bc
cmp jsvm.bc jsvm2.bc
cmp jsvm.bc jsvm3.bc
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
for f in test.js switch.js catch.js optimizer-test.js io-test.js dense-test.js reference-test.js; do
    ./jsvm -c "$f" -o regression.bc
    ./jsvm -b regression.bc
    ./jsvm jsvm.js -b regression.bc
done
