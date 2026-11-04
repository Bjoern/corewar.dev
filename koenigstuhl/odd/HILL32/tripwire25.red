;redcode-94
;name Tripwire 25
;author Bjoern Guenzel
;strategy bomber with self stunning bombs
;strategy length 25 version for tournament
;strategy not great, not terrible
;assert CORESIZE == 8000
;password flkjnfijjjgggg
;ideas use spl #step, {2 against core clears

djnptr  equ (-4000)
step    equ 155 ;sequence [155, 60, 25, -10, -5]
hit1    equ (hit-step)
stund   equ 6 ;orig 3 - 6 or 7 seem best so far
bptr    equ (clptr+step+stund)
zero    equ (MAXLENGTH+MINDISTANCE/2) ;point to dat 0,0, hopefully
bdist   equ 3000
start   equ init


 
      
clptr   dat 0,bptr+2
        
        dat 0,0                        ;
        
init    mov.a #stun-bptr, bptr         ;set up bptr, hit with "work"
stun    spl #clbmb-bptr, #step+stund   
ptr     mov.i stun, @hit1
        mov.i  work, @ptr
        sub.ab #2*step, @-1
hit     djn.f ptr, <djnptr             ;bomb with spl to switch to clear
clear   mov.i *bptr, >clptr
last    djn.f clear, {clptr

        dat 0,0
        dat 0,0

work    mov.i -step, <-step            ;hit with "work"                     
        
clbmb   dat 0, last-clptr+2

        end start
