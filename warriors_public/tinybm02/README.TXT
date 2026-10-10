TINY BENCHMARK 2002
-------------------

The 20 warriors assembled here form the tiny benchmark - a carefully
balanced selection of opponents for tiny-redcoders to test and optimize
their tiny warriors against.

Included for convenience are Dos batch files which use MTS to schedule
benchmarking (documented below) and the benchmark results for all tiny
warriors published to date (xxxxxxxx.res)

The benchmark warriors are:

NAME                    STRATEGY
----                    --------
dark skies              oneshot test
Dettol Test 487         Betadine derivative
Digital Swarm           TinyQ^4 -> Paper
Easter Egg              TinyQ^4 -> Paper
Evolving Threat         evolved
Hemulen                 decoy maker -> incendiary bomber -> clear
Hired Sword             decoy maker -> .33 scan / .33 clear -> d-clear
Killer Bees             paper
Lone Gunman             decoy maker ->  6-line oneshot
Moominpapa              TinyQ^4 -> Paper
Muskrat                 decoy maker -> T.N.T. style bomber -> d-clear
Poke v0.1               Stone
Potenza                 Replicator?
Rasp                    TinyQ^4 -> Paper
s774++                  .66c backward scanning oneshot
Snowstorm               stone/imp
Tiny BiShot 2.0         .66c BiShot Scanner
tiny Blowrag            silk and imps
Tiny Freeze             scanner
Xyzzy                   an average paper/stone


BATCH BENCHMARK
---------------

This program will battle all files without an extension in the current
directory against a benchmark.  The benchmark warriors should be in the
current directory with the extension *.RED.  Stefan Strack's MTS is
required.  Filenames should be no longer than 8 characters.

If you wish to change the parameters for pMars, edit TESTXXXX.BAT. To
keep track of which files have been benchmarked, they are renamed from
*. to *.RC.  Individual results for each benchmarked warrior are
stored in *.RES. A score summary is displayed to the screen and saved
to RESULTS.TXT.
