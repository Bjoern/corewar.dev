;redcode-94nop 
;author inversed 
;name Stonewall
;strategy Stone + imp + d-clear
;assert CORESIZE==8000

; Boot
stbd    equ     3865
ilbd    equ     1595
dcbd    equ     1322
count   equ     4
x0      equ     boot

; Imp launcher
is      equ     2667
isrc    equ     6264
iofs    equ     657
scratch equ     4009
iptr0   equ     il0+iofs-2*(is+1)

; Stone
step    equ     2729
hop     equ     (step/2)
time    equ     7871
boff    equ     35

; Clear
cptr    equ     cs0-3
safe    equ     12

boot    mov       dbomb ,   x0+stbd+boff
        mov       imp   ,   x0+ilbd+isrc
ifrom   spl       1     ,   il0+4
cfrom   spl       1     ,   cs0+4
        mov     < s0    , { gost
        mov     < ifrom , { goil
        mov     < cfrom , { godc
gost    djn   x0+stbd+4 , #count
goil    spl   x0+ilbd+4
godc    jmp   x0+dcbd+4

s0      spl     # 0         ,   4
loop    mov       s0+boff   , @ 2
hit     add     # step      , @ -1
        djn.f    -2         , { -1-(step*time)
dbomb   dat     > hop+1     , > 1

il0     spl     # iofs      , { is+1
        add.x    -1         , 2 
        mov.i     il0+isrc  , }il0
        djn.f     iptr0     , scratch 
imp     mov.i   # is/2      ,  is

cs0     spl     # 0     , 0
        mov       kill  , > cptr
        djn.f    -1     , > cptr
kill    dat     < 2667  ,   safe

end boot
