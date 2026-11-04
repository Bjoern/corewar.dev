;redcode-94nop
;name Osiris
;author S.Fernandes
;strategy paper with microwarriors
;assert CORESIZE == 8000

warr    spl     1
        spl     1
        spl     1
        mov     {micro      ,    {mboot
mboot   djn     3275        ,    #1

        spl     1
        spl     1
        spl     1
        mov     <papera     ,    {pboot
pboot   djn.f   1996        ,    <2667

micro   spl     #8          ,    <spr
        mov.i   #1          ,    <1
spr     mov     dec         ,    5592
        add     #5166       ,    spr
        mov     micro       ,    @spr
        djn.f   @spr        ,    <1107
dec     djn     -2          ,    #2512

stepa   equ     2794
stepb   equ     2326
X	equ	2860
Y	equ	7948

papera  spl     stepa       ,    8
        mov     >papera     ,    }papera
paperb  spl     stepb       ,    <mid
        mov     >mid        ,    }paperb
        mov     bomb        ,    >X
        mov     bomb        ,    }Y
mid     djn.f   paperb      ,    >4
bomb    dat     <2667       ,    <5334

