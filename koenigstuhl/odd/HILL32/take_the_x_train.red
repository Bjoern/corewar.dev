;redcode
;name Take the X Train
;author inversed
;assert CORESIZE==8000
;strategy Freight train variant
;strategy Simpler boot, two separate imp spirals

stbd    equ     2184
c1bd    equ     7030
c2bd    equ     6439
is      equ     1143
id      equ     7993

step    equ     2778
time    equ     2088
dd      equ     10
a0      equ     dd+1+(2*time)
b0      equ     3+(step*time)

x0      equ     boot

boot    mov   db    ,   x0+stbd+dd
        mov   imp   , < imp1
        mov   imp   , < imp2
main    spl   1     ,   launch+4
imp1    spl   1     ,   x0+c1bd+2+id+1
        mov < sfrom , < gost
       
gost    spl @ 0     ,   x0+stbd+4
        mov < main  , < gol1
        mov < launch, < gol2
sfrom   spl   1     ,   stone+4
imp2    spl   2     ,   x0+c2bd+2+id+1
gol1    jmp @ 0     ,   x0+c1bd+4
gol2    jmp @ 0     ,   x0+c2bd+4

db      dat < 2667  , < 1
imp     mov   0     ,   is

stone   mov < a0    ,   b0
        spl  -1     , < 2-step
        add   1     ,  -2
        djn  -2     , <-step

launch  spl   0     ,  4
        add # is    ,  1
        jmp @ 0     ,  id-8*is

end boot
