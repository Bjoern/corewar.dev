@rem ** THIS BATCHFILE CALLS MTS TO BENCHMARK THE WARRIOR **
@rem ** YOU CAN CHANGE THE PMARS PARAMETERS HERE (LINE 6) **
@echo off
echo f >xxxxxxxx.xxx
echo n >>xxxxxxxx.xxx
echo pmars -b -F 213 -r 500 -s 800 -p 800 -c 8000 -l 20 >>xxxxxxxx.xxx
echo y >>xxxxxxxx.xxx
echo %1.res >>xxxxxxxx.xxx
echo xxxxxxxx.xxx >>xxxxxxxx.xxx
echo %1 >>xxxxxxxx.xxx
for %%f in (*.red) do echo %%f >>xxxxxxxx.xxx
mts <xxxxxxxx.xxx
ren %1 %1.rc
erase xxxxxxxx.xxx
erase *.mts

