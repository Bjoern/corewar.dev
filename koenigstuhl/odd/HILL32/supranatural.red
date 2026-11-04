;redcode
;name Supranatural Flame
;author inversed
;strategy Torch-style bomber + delayed imp launcher
;assert CORESIZE==8000

; Bomber
hop     equ     15
step    equ     2*hop
time    equ     761
ofs     equ     hit-step*time-hop
wlen    equ     7
stream  equ     4910

; Imp launcher
delay   equ     73
istep   equ     2667

; Boot
bds     equ     3933
bdi     equ     3516
kofs    equ     25
bmofs   equ     kofs+1
iofs    equ     7692
x0      equ     copy

copy    mov     < bpf       ,   < gost
boot    mov     < bpf       ,   < gost
        mov     < ilfrom    ,   < goil
        mov       imp       ,   < ito
        djn       copy      ,   # 4
        mov       kill      ,     x0+bds+kofs
        mov       bm        ,     x0+bds+bmofs
gost    spl     @ 0         ,     x0+bds+7
goil    jmp     @ 0         ,     x0+bdi+4
ito     dat     # 0         ,   # x0+bdi+iofs+4

bs      spl       0         ,   < wlen+1-hop
ptr     mov       bs        ,   < ofs
        mov       bs+bmofs  ,   @ ptr
cptr    add     # step      ,     ptr
hit     jmp       ptr       ,     0
clear   mov       bs+kofs   ,   < cptr
        djn       clear     ,   < bs+stream
bpf     dat     # 0         ,   # 0
kill    dat     < wlen-hop  ,   < 2667
bm      mov       hop       ,   < hop+1

il      djn       0         ,   # delay
ilfrom  spl       0         ,     3
        add     # istep+1   ,     1
        jmp     @ 0         ,     il+iofs-istep

imp     mov       0         ,     istep

end     boot
