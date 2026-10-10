@echo off
copy %1*.res xxxxxxxx.yyy >nul
echo         Name                    Author                    W   L   T   Score >results.txt
echo --------------------------------------------------------------------------- >>results.txt
find "  1    " xxxxxxxx.yyy |sort /+70 /r >>results.txt
erase xxxxxxxx.yyy
type results.txt |more
