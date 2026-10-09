@echo off
cd /d %~dp0
ver > stages.txt
lin32.exe cc0.elf cc_min.c wc1.elf >> stages.txt 2>&1
echo STAGE win1 EXIT %errorlevel% EXPECT 0 >> stages.txt
lin32.exe wc1.elf cc_min.c wc2.elf >> stages.txt 2>&1
echo STAGE win2 EXIT %errorlevel% EXPECT 0 >> stages.txt
lin32.exe wc2.elf cc_min.c wc3.elf >> stages.txt 2>&1
echo STAGE win3 EXIT %errorlevel% EXPECT 0 >> stages.txt
fc /b wc1.elf wc2.elf >> stages.txt
echo STAGE win12 EXIT %errorlevel% EXPECT 0 >> stages.txt
fc /b wc2.elf wc3.elf >> stages.txt
echo STAGE win23 EXIT %errorlevel% EXPECT 0 >> stages.txt
fc /b wc1.elf lc1.elf >> stages.txt
echo STAGE cross1 EXIT %errorlevel% EXPECT 0 >> stages.txt
fc /b wc2.elf lc2.elf >> stages.txt
echo STAGE cross2 EXIT %errorlevel% EXPECT 0 >> stages.txt
fc /b wc3.elf lc3.elf >> stages.txt
echo STAGE cross3 EXIT %errorlevel% EXPECT 0 >> stages.txt
lin32.exe wc3.elf cc_demo.c wdemo.elf >> stages.txt 2>&1
echo STAGE demo_compile EXIT %errorlevel% EXPECT 0 >> stages.txt
lin32.exe wdemo.elf >> stages.txt 2>&1
echo STAGE demo_run EXIT %errorlevel% EXPECT 42 >> stages.txt
fc /b wdemo.elf ldemo.elf >> stages.txt
echo STAGE demo_cross EXIT %errorlevel% EXPECT 0 >> stages.txt
lin32.exe wc3.elf growth.c wgrowth.elf >>stages.txt 2>&1
echo STAGE growth_compile EXIT %errorlevel% EXPECT 0 >>stages.txt
lin32.exe wgrowth.elf >>stages.txt 2>&1
echo STAGE growth_run EXIT %errorlevel% EXPECT 42 >>stages.txt
fc /b wgrowth.elf lgrowth.elf >>stages.txt 2>&1
echo STAGE growth_cross EXIT %errorlevel% EXPECT 0 >>stages.txt
echo WIN_SELFHOST_COMPLETE >> stages.txt
mode com1: baud=115200 parity=n data=8 stop=1 > nul
type stages.txt > com1
type stages.txt
