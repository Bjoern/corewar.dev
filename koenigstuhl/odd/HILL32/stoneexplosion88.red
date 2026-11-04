;redcode
;name stone explosion
;author Christian Schmidt
;strategy looped booting of small stone and imps
;assert 1

sOff   equ 2628
sAwa   equ 6490

iOff   equ 7542
iAwa   equ 3551

boot	spl	1
	spl	1
        spl     iBoo

sBoo    mov     <sSrc,  <sDist
sSrc    spl     @sDist, sEnd+1
        add     #sAwa,  sDist
        add     #1,     sSrc
sDist   jmp     sBoo,   sOff

iBoo    mov     <iSrc,  <iDist
iSrc    spl     @iDist, imp+1
        add     #iAwa,  iDist
        add     #1,     iSrc
iDist   jmp     iBoo,   iOff

step    equ    	82
time    equ  	2437
dd      equ	7

stone   mov 	<dd+1+(2*time), 3+(step*time)
        spl  	-1, 	<2-step
        add   	1,   	-2
sEnd    djn  	-2, 	<0-step

vortex  spl	0,	<iAwa
	add	#2667, 	launch
launch  jmp	@0, 	imp-2668
imp	mov	0, 	2667