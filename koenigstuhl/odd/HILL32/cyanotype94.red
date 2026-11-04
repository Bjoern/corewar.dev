;redcode-94
;name Cyanotype
;author Ilmari Karonen
;strategy paper
;assert CORESIZE == 8000

; Written for the Core War Tournament Weekend 2024:
; https://corewar.co.uk/tournamentweekend2024.htm
;
; I was trying to be clever here, but I think I just made a bad paper.
; Oh well, time's running out again...

        org      split

lstep   equ      2873
step    equ      4641
bpos    equ      3039
boff    equ      77
bstep   equ      boff*2

split   spl      2              ,  paper
        spl      1              , {4000
        spl      1              , {paper+step

launch  spl     @0              , <lstep
        mov     }launch         , >launch
        mov     }launch         , >launch
        mov     }boot           , >boot

paper   spl      1*step         ,  2*step
        mov      bomb           , <bptr*(1-step)
        mov     }paper          , >paper
        add     #bstep+1        ,  bptr*(1-step)
bptr    mov      bomb           , <bpos
bomb    dat     <2667           , {boff+1

boot    dat     <paper          , <paper+step

        end

