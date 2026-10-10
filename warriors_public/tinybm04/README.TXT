TINY BENCHMARK 2004
-------------------

The 25 warriors assembled here form the tiny benchmark - a carefully
balanced selection of opponents for tiny-redcoders to test and optimize
their tiny warriors against.

Included for convenience are Dos batch files which use MTS to schedule
benchmarking (documented below) and the benchmark results for all tiny
warriors published to date (xxxxxxxx.res)

The benchmark warriors are:

NAME                    STRATEGY
----                    --------
bestwar4.red            Created using RedRace.c. (evolved)
Betadine                scan w/ clear
Diamondette             stone
Digital Swarm           TinyQ^4 -> Paper
Four Winds              oneshot
Hellish Glare           incendiary bomber with airbag
livewire voodoo         qscan, paper with mirrored silk-imps
Lone Gunman             decoy maker ->  6-line oneshot
Muskrat                 decoy maker -> T.N.T. style bomber -> d-clear
Origin of Storms        unusual scanner variation
Potenza                 Replicator?
Provenance              oneshot with escape route
Seek and Destroy        Betadine with .8c and heavy optimized.
Sneaky Spike            oneshot
Snowstorm               stone/imp
Son of Darkness 2       stone/paper with imps
Table Scan              Table Scan -> Clear
Tiny BiShot 2.0         .66c BiShot Scanner
tiny Blowrag            silk and imps
Tiny Zooom...           .5 scan -> .33 scan/.33 clear -> clear
Tinyshot                oneshot .25c bomb, .5c scan
Ugly Uncle              Q^4 -> paper
Unknown                 puzzle in miniature (clear/imp)
Where's Giles?          TinyQ^4 -> Paper
Wilt ;)                 Qbomb->paper


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
