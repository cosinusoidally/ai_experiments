#!/bin/sh
# Optional growth regression; run after stages.sh. Builds use TCC/cc_min only.
set -eu
cd "$(dirname "$0")"
awk 'BEGIN {
    for (i=0;i<2600;i++) printf "int long_global_identifier_%05d;\n", i;
    printf "int "; for(i=0;i<5000;i++) printf "z"; print ";";
    printf "int many(";
    for(i=0;i<12;i++) printf "%sint a%d", i ? "," : "", i;
    print ") { return a11; }";
    print "int main(int argc,int argv) {";
    for(i=0;i<300;i++) printf "int local_%d;\n", i;
    print "int p; int x; x=0;";
    printf "p=(int)\""; for(i=0;i<70000;i++) printf "a"; print "\";";
    for(i=0;i<18000;i++) print "x=x+1;";
    print "if(x!=18000) return 99;";
    print "return many(0,1,2,3,4,5,6,7,8,9,10,42); }";
}' > build/share/growth.c
build/share/cc0.elf build/share/growth.c build/growth0.elf
build/share/lc3.elf build/share/growth.c build/share/lgrowth.elf
cmp build/growth0.elf build/share/lgrowth.elf
set +e
build/share/lgrowth.elf
result=$?
set -e
test "$result" -eq 42
printf '%s\n' 'GROWTH_COMPLETE: bootstrap and self-built output match; program exited 42.'
wc -c build/share/growth.c build/share/lgrowth.elf
