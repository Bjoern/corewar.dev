redcode
;assert CORESIZE == 8000
;name rdrc: Forgotten Artifact
;author Dave Hillis
;strategy -   Created using RedRace.c.
;strategy -   evolved. Starts as a bomber, transitions to a sort of wipe

org START
       seq.x    #     0, >    -1
       cmp.i    $   546, <     0
START  div.f    #  2667, #    -1
       add.f    $     3, $     1
       mov.i    }  2684, {    -2
       jmz.f    $    -2, <    -1
       spl.ba   $  -298, }  -300
       spl.i    #    -9, {    -3
       spl.x    #   -10, {     9
       mov.i    @    -4, }    -4
       djn.f    $    -1, }    -5
       spl.i    #    17, { -2840
       sub.f    $    -4, {    -7
       spl.f    #    50, $    10
       djn.i    #    50, $   -10
       djn.i    #  2011, }   -11
       mov.i    #     0, $  -311
       mov.i    }     7, <   181
       mov.i    #    14, >   -15

