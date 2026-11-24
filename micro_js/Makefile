CC ?= cc
CFLAGS ?= -O2 -std=c90 -pedantic-errors -Wall -Wextra
LDLIBS ?= -lm

all: jsvm

jsvm: js.c js.h main.c
	$(CC) $(CFLAGS) js.c main.c -o $@ $(LDLIBS)

host_test: js.c js.h host_test.c
	$(CC) $(CFLAGS) js.c host_test.c -o $@ $(LDLIBS)

check: jsvm host_test
	./jsvm test.js switch.js catch.js
	./host_test
	python3 generate_stress.py > stress.generated.js
	./jsvm stress.generated.js

clean:
	rm -f jsvm host_test stress.generated.js
