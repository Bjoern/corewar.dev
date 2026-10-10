;redcode-tiny
;name Sneaky Spike
;author Roy van Rijn
;assert 1
cStep       equ     35
cOff        equ     -184
cAdd        add.f   cIncr,      cScan
cScan       sne.i   cOff,       cOff+12
            djn.f   cAdd,       @cScan
cIncr       spl.f   #-cStep,    >-cStep
            mov.i   @cBomb,     }cScan
            djn.f   -1,         <cScan
cBomb       dat     #14,        {1
            spl     #11,        {-65
            dat     0,          0
            dat     0,          0
            dat     0,          0
            dat     0,          0
            dat     0,          0
tDecoy      equ     (tStart+195)
tStart      mov     <tDecoy+0,  {tDecoy+2
            mov     <tDecoy+3,  {tDecoy+5
            mov     <tDecoy+6,  {tDecoy+8
            djn.f   cScan,      <tDecoy+10
end tStart
