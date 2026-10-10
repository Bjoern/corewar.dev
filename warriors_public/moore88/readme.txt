DAVID MOORE'S '88 BENCHMARK 1998
--------------------------------

The 20 warriors assembled here form the Moore '88 benchmark, created
by David Moore.

Included for convenience are DOS batch files and Bash scripts which use
MTS to schedule benchmarking (documented below).

BATCH BENCHMARK
---------------

TEST.BAT will battle all files without an extension (*.) against the
benchmark.  The benchmark warriors should be in the current directory
with the extension *.RED.  Stefan Strack's MTS is required.

If you wish to change the parameters for pMARS, edit TESTXXXX.BAT.  To
keep track of which files have been benchmarked, they are renamed to
*.RC.  Individual results are stored in *.RES.  A score summary is
displayed and saved in RESULTS.TXT.

BASH SCRIPT
-----------

TEST.SH will battle all files passed on the command line against the
benchmark.  The benchmark warriors should be in the current directory
with the extension *.red.  Stefan Strack's MTS is required.

If you wish to change the parameters for pMARS, edit TEST.SH.  To keep
track of which files have been benchmarked, they are renamed to *.rc. 
Individual results are stored in *.res.  A score summary is displayed
by SCORES.SH.

