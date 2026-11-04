;redcode-94nop
;name kudzu
;author Christian Schmidt
;strategy stone and paper
;assert 1

pStep1  equ    552
pStep2  equ    7061
sAwa    equ    1806
dAwa    equ    1001

dStep   equ    2862
dOff    equ    4655

qb1 	equ 	1000
qb2 	equ 	2000
qb3 	equ 	3000


wGo     mov    >dLoop,          >dBoo

        spl    2,               <qb1
qtab2   spl    1,               <qb2
        spl    1,               <qb3

        mov    >dLoop,          >dBoo
        mov    <pEnd,           {pBoo
dBoo    spl    @pBoo,           wGo+sAwa
        spl    @pBoo,           >dBoo
pBoo    djn    wGo+dAwa+6,      #wGo+sAwa

dGo     spl    #2*dStep,        {2*dStep
        mov    dBmb,            *2
        add.f  -2,              1
        mov    dOff,            dOff+dStep
dLoop   jmp    -3,              dGo

        dat    0,               0

dBmb    dat    }1,              >1

        dat    0,               0
        dat    0,               0

pGo     spl    pStep1,          {3
        mov    }2,              }-1
        mov    pBmb,            >pStep2
        mov    3,               }-3
        jmz.f  -4,              *-1
pBmb    dat    <2667,           <5334
pEnd    dat    0,               0

end