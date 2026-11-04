;redcode-94nop
;name Electra-Z
;author S.Fernandes
;strategy paper/imp
;assert CORESIZE == 8000

idist   equ     2667
sdista  equ     2000
sdistb  equ     7300
sdistc  equ     idist+1

warr    spl     1           ,    {5555
        spl     1           ,    {4444
        spl     1           ,    {3333
        mov     <papera     ,    {boot
boot    spl     silka+2500  ,    {2222
        mov     {silka      ,    {bootb
bootb   djn.f   silka+2350  ,    {1111

silka   spl     @0+8        ,    }sdista
        mov     }silka      ,    >silka
silkb   spl     @0          ,    }sdistb
        mov     }silkb      ,    >silkb
silkc   spl     @0          ,    }sdistc
        mov     }silkc      ,    >silkc
        mov.i   #sdista+sdistb,  }-sdistb
imp     mov.i   #1          ,    idist

stepa   equ     2890
stepb   equ     810
stepc   equ     410

papera  spl     stepa       ,    8
        mov     >papera     ,    }papera
paperb  spl     @0          ,    >stepb
        mov     }paperb     ,    >paperb
        mov     bomb        ,    <4662
        mov     {paperb     ,    <paperc
paperc  djn.f   @0          ,    }stepc
bomb    dat     <5334       ,    <2667
