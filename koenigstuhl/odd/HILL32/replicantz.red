;redcode
;name Replicant-Z
;author S.Fernandes
;strategy paper with alt constants for Tournament Weekend
;assert CORESIZE == 8000

pstep   equ    5139
ipos    equ    7207
spos    equ    3064

paper   mov    #28          ,   11
loop    mov    <paper       ,   <pboot
        mov    <ipos        ,   <spos
        add    -1           ,   @1
        mov    bomb         ,   <loop+1
        jmn    loop         ,   paper
        spl    @paper       ,   <-2667
pboot   jmz    @0           ,   pstep
bomb    dat    <2667        ,   <5335

        end    loop

