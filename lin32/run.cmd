@echo off
cd /d %~dp0
ver > result.txt
lin32.exe --trace hello.elf > hello.out 2> hello.err
echo TEST hello EXIT %errorlevel% EXPECT 37 >> result.txt
type hello.out >> result.txt
type hello.err >> result.txt
echo. >> result.txt
lin32.exe checks.elf alpha "two words" > checks.out 2> checks.err
echo TEST checks EXIT %errorlevel% EXPECT 0 >> result.txt
type checks.out >> result.txt
type checks.err >> result.txt
echo. >> result.txt
lin32.exe stack.elf > stack.out 2> stack.err
echo TEST stack EXIT %errorlevel% EXPECT 0 >> result.txt
type stack.out >> result.txt
type stack.err >> result.txt
echo. >> result.txt
lin32.exe badmem.elf > badmem.out 2> badmem.err
echo TEST badmem EXIT %errorlevel% EXPECT 125 >> result.txt
type badmem.out >> result.txt
type badmem.err >> result.txt
echo. >> result.txt
lin32.exe illegal.elf > illegal.out 2> illegal.err
echo TEST illegal EXIT %errorlevel% EXPECT 125 >> result.txt
type illegal.out >> result.txt
type illegal.err >> result.txt
echo. >> result.txt
lin32.exe readonly.elf > readonly.out 2> readonly.err
echo TEST readonly EXIT %errorlevel% EXPECT 125 >> result.txt
type readonly.out >> result.txt
type readonly.err >> result.txt
echo. >> result.txt
lin32.exe short.elf > short.out 2> short.err
echo TEST short EXIT %errorlevel% EXPECT 125 >> result.txt
type short.out >> result.txt
type short.err >> result.txt
echo. >> result.txt
lin32.exe headers.elf > headers.out 2> headers.err
echo TEST headers EXIT %errorlevel% EXPECT 125 >> result.txt
type headers.out >> result.txt
type headers.err >> result.txt
echo. >> result.txt
lin32.exe dynamic.elf > dynamic.out 2> dynamic.err
echo TEST dynamic EXIT %errorlevel% EXPECT 125 >> result.txt
type dynamic.out >> result.txt
type dynamic.err >> result.txt
echo. >> result.txt
lin32.exe bounds.elf > bounds.out 2> bounds.err
echo TEST bounds EXIT %errorlevel% EXPECT 125 >> result.txt
type bounds.out >> result.txt
type bounds.err >> result.txt
echo. >> result.txt
lin32.exe entry.elf > entry.out 2> entry.err
echo TEST entry EXIT %errorlevel% EXPECT 125 >> result.txt
type entry.out >> result.txt
type entry.err >> result.txt
echo. >> result.txt
lin32.exe interp.elf > interp.out 2> interp.err
echo TEST interp EXIT %errorlevel% EXPECT 125 >> result.txt
type interp.out >> result.txt
type interp.err >> result.txt
echo. >> result.txt
lin32.exe fileio.elf > fileio.out 2> fileio.err
echo TEST fileio EXIT %errorlevel% EXPECT 0 >> result.txt
type fileio.out >> result.txt
type fileio.err >> result.txt
echo. >> result.txt
lin32.exe heap.elf >heap.out 2>heap.err
echo TEST heap EXIT %errorlevel% EXPECT 0 >>result.txt
type heap.out >>result.txt
type heap.err >>result.txt
echo LIN32_TESTS_COMPLETE >> result.txt
mode com1: baud=115200 parity=n data=8 stop=1 > nul
type result.txt > com1
type result.txt
