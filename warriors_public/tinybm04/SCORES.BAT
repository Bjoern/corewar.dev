@echo off
copy *.res xxxxxxxx.xxx >nul
echo         Name                    Author                    W   L   T   Score >results.txt
echo --------------------------------------------------------------------------- >>results.txt
find "  1    " xxxxxxxx.xxx |sort /+70 /r >>results.txt
erase xxxxxxxx.xxx
type results.txt |more
